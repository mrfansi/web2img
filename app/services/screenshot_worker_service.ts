import { Page } from 'playwright'
import logger from '@adonisjs/core/services/logger'
import { browserService, PageOptions } from '#services/browser_service'
import { urlTransformationService } from '#services/url_transformation_service'

export interface ScreenshotOptions {
  format: 'png' | 'jpeg' | 'webp'
  quality?: number
  width: number
  height: number
  timeout: number
  fullPage?: boolean
}

export interface ScreenshotResult {
  buffer: Buffer
  format: string
  width: number
  height: number
  processingTime: number
  finalUrl: string
  wasTransformed: boolean
}

export interface ScreenshotJobData {
  url: string
  options: ScreenshotOptions
  cacheKey?: string
  batchId?: string
  itemId?: string
}

export class ScreenshotWorkerService {
  /**
   * Process a screenshot job
   */
  async processScreenshotJob(jobData: ScreenshotJobData): Promise<ScreenshotResult> {
    const startTime = Date.now()

    try {
      logger.info('Starting screenshot capture', {
        url: jobData.url,
        options: jobData.options,
        batchId: jobData.batchId,
        itemId: jobData.itemId,
      })

      // Step 1: Process URL (transform and validate)
      const urlResult = await urlTransformationService.processUrl(jobData.url, true)

      logger.debug('URL processing completed', {
        original: urlResult.original,
        final: urlResult.final,
        wasTransformed: urlResult.wasTransformed,
      })

      // Step 2: Create browser page
      const pageOptions: PageOptions = {
        width: jobData.options.width,
        height: jobData.options.height,
        timeout: jobData.options.timeout,
      }

      const { page, cleanup } = await browserService.createPage(pageOptions)

      try {
        // Step 3: Capture screenshot
        const result = await this.captureScreenshot(page, urlResult.final, jobData.options)

        const processingTime = Date.now() - startTime

        logger.info('Screenshot capture completed', {
          url: jobData.url,
          finalUrl: urlResult.final,
          processingTime,
          format: result.format,
          size: result.buffer.length,
        })

        return {
          ...result,
          processingTime,
          finalUrl: urlResult.final,
          wasTransformed: urlResult.wasTransformed,
        }
      } finally {
        await cleanup()
      }
    } catch (error) {
      const processingTime = Date.now() - startTime

      logger.error('Screenshot capture failed', {
        url: jobData.url,
        error: error.message,
        processingTime,
        batchId: jobData.batchId,
        itemId: jobData.itemId,
      })

      throw new Error(`Screenshot capture failed: ${error.message}`)
    }
  }

  /**
   * Capture screenshot of a page
   */
  private async captureScreenshot(
    page: Page,
    url: string,
    options: ScreenshotOptions
  ): Promise<Omit<ScreenshotResult, 'processingTime' | 'finalUrl' | 'wasTransformed'>> {
    try {
      // Navigate to the URL
      await this.navigateToUrl(page, url, options.timeout)

      // Wait for page to be ready
      await this.waitForPageReady(page)

      // Capture screenshot
      const buffer = await this.takeScreenshot(page, options)

      return {
        buffer,
        format: options.format,
        width: options.width,
        height: options.height,
      }
    } catch (error) {
      logger.error('Failed to capture screenshot', { url, error })
      throw new Error(`Failed to capture screenshot: ${error.message}`)
    }
  }

  /**
   * Navigate to URL with proper error handling
   */
  private async navigateToUrl(page: Page, url: string, timeout: number): Promise<void> {
    try {
      logger.debug('Navigating to URL', { url, timeout })

      const response = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout,
      })

      if (!response) {
        throw new Error('Failed to navigate to URL - no response received')
      }

      const status = response.status()
      if (status >= 400) {
        throw new Error(`HTTP ${status}: ${response.statusText()}`)
      }

      logger.debug('Navigation completed', { url, status })
    } catch (error) {
      if (error.name === 'TimeoutError') {
        throw new Error(`Navigation timeout after ${timeout}ms`)
      }
      throw error
    }
  }

  /**
   * Wait for page to be ready for screenshot
   */
  private async waitForPageReady(page: Page): Promise<void> {
    try {
      // Wait for DOM to be ready
      await page.waitForLoadState('domcontentloaded')

      // Wait for images to load (with timeout)
      await Promise.race([
        page.waitForLoadState('networkidle'),
        new Promise(resolve => setTimeout(resolve, 5000)), // Max 5 seconds for images
      ])

      // Wait for any JavaScript to execute
      await page.waitForTimeout(1000)

      // Check if page has any content
      const bodyContent = await page.evaluate(() => {
        // This code runs in the browser context where document is available
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (globalThis as any).document?.body?.innerText?.trim() || ''
      })
      if (!bodyContent) {
        logger.warn('Page appears to have no content')
      }

      logger.debug('Page ready for screenshot')
    } catch (error) {
      logger.warn('Error waiting for page ready, proceeding anyway', { error: error.message })
      // Don't throw here, proceed with screenshot anyway
    }
  }

  /**
   * Take the actual screenshot
   */
  private async takeScreenshot(page: Page, options: ScreenshotOptions): Promise<Buffer> {
    try {
      const screenshotOptions: any = {
        type: options.format,
        fullPage: options.fullPage || false,
      }

      // Add quality for JPEG and WebP
      if (options.format === 'jpeg' || options.format === 'webp') {
        screenshotOptions.quality = options.quality || 80
      }

      logger.debug('Taking screenshot', { options: screenshotOptions })

      const buffer = await page.screenshot(screenshotOptions)

      if (!buffer || buffer.length === 0) {
        throw new Error('Screenshot buffer is empty')
      }

      logger.debug('Screenshot captured', { size: buffer.length })
      return buffer
    } catch (error) {
      logger.error('Failed to take screenshot', { error })
      throw new Error(`Failed to take screenshot: ${error.message}`)
    }
  }

  /**
   * Validate screenshot options
   */
  validateScreenshotOptions(options: Partial<ScreenshotOptions>): {
    isValid: boolean
    error?: string
    validatedOptions?: ScreenshotOptions
  } {
    try {
      // Default values
      const defaults: ScreenshotOptions = {
        format: 'png',
        width: 1280,
        height: 720,
        timeout: 30000,
        fullPage: false,
      }

      const validated: ScreenshotOptions = { ...defaults, ...options }

      // Validate format
      if (!['png', 'jpeg', 'webp'].includes(validated.format)) {
        return { isValid: false, error: 'Format must be png, jpeg, or webp' }
      }

      // Validate dimensions
      if (validated.width < 1 || validated.width > 5000) {
        return { isValid: false, error: 'Width must be between 1 and 5000 pixels' }
      }

      if (validated.height < 1 || validated.height > 5000) {
        return { isValid: false, error: 'Height must be between 1 and 5000 pixels' }
      }

      // Validate timeout
      if (validated.timeout < 5000 || validated.timeout > 60000) {
        return { isValid: false, error: 'Timeout must be between 5 and 60 seconds' }
      }

      // Validate quality for JPEG/WebP
      if (validated.quality !== undefined) {
        if (validated.format === 'png') {
          return { isValid: false, error: 'Quality parameter not supported for PNG format' }
        }
        if (validated.quality < 1 || validated.quality > 100) {
          return { isValid: false, error: 'Quality must be between 1 and 100' }
        }
      }

      return { isValid: true, validatedOptions: validated }
    } catch (error) {
      return { isValid: false, error: `Validation error: ${error.message}` }
    }
  }

  /**
   * Get service health status
   */
  async getHealthStatus(): Promise<{
    healthy: boolean
    browserService: any
    details: any
  }> {
    try {
      const browserHealth = await browserService.healthCheck()

      return {
        healthy: browserHealth.healthy,
        browserService: browserHealth,
        details: {
          timestamp: new Date().toISOString(),
          service: 'ScreenshotWorkerService',
        },
      }
    } catch (error) {
      logger.error('Health check failed', { error })
      return {
        healthy: false,
        browserService: { healthy: false, error: error.message },
        details: {
          timestamp: new Date().toISOString(),
          service: 'ScreenshotWorkerService',
          error: error.message,
        },
      }
    }
  }

  /**
   * Process multiple screenshots in batch (for testing)
   */
  async processBatch(jobs: ScreenshotJobData[]): Promise<{
    results: (ScreenshotResult | { error: string })[]
    totalTime: number
    successCount: number
    failureCount: number
  }> {
    const startTime = Date.now()
    const results: (ScreenshotResult | { error: string })[] = []
    let successCount = 0
    let failureCount = 0

    logger.info('Starting batch screenshot processing', { jobCount: jobs.length })

    for (const job of jobs) {
      try {
        const result = await this.processScreenshotJob(job)
        results.push(result)
        successCount++
      } catch (error) {
        results.push({ error: error.message })
        failureCount++
      }
    }

    const totalTime = Date.now() - startTime

    logger.info('Batch screenshot processing completed', {
      totalJobs: jobs.length,
      successCount,
      failureCount,
      totalTime,
    })

    return {
      results,
      totalTime,
      successCount,
      failureCount,
    }
  }
}

// Create singleton instance
export const screenshotWorkerService = new ScreenshotWorkerService()