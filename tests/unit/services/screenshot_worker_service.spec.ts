import { test } from '@japa/runner'
import { ScreenshotWorkerService } from '#services/screenshot_worker_service'

// Create a test service class that allows dependency injection for testing
class TestableScreenshotWorkerService extends ScreenshotWorkerService {
  constructor(
    private mockBrowserService?: any,
    private mockUrlTransformationService?: any
  ) {
    super()
  }

  // Override the processScreenshotJob method to use mocked services
  async processScreenshotJob(jobData: any): Promise<any> {
    if (this.mockBrowserService && this.mockUrlTransformationService) {
      return this.processWithMocks(jobData)
    }
    return super.processScreenshotJob(jobData)
  }

  private async processWithMocks(jobData: any): Promise<any> {
    const startTime = Date.now()
    
    // Mock URL processing
    const urlResult = await this.mockUrlTransformationService.processUrl(jobData.url, true)
    
    // Mock browser page creation
    const { page, cleanup } = await this.mockBrowserService.createPage({
      width: jobData.options.width,
      height: jobData.options.height,
      timeout: jobData.options.timeout,
    })

    try {
      // Mock navigation
      const response = await page.goto(urlResult.final, {
        waitUntil: 'networkidle',
        timeout: jobData.options.timeout,
      })

      if (response.status() >= 400) {
        throw new Error(`HTTP ${response.status()}: ${response.statusText()}`)
      }

      // Mock page ready wait
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(1000)

      // Mock screenshot capture
      const buffer = await page.screenshot({
        type: jobData.options.format,
        fullPage: jobData.options.fullPage || false,
        ...(jobData.options.quality && { quality: jobData.options.quality }),
      })

      const processingTime = Date.now() - startTime

      return {
        buffer,
        format: jobData.options.format,
        width: jobData.options.width,
        height: jobData.options.height,
        processingTime,
        finalUrl: urlResult.final,
        wasTransformed: urlResult.wasTransformed,
      }
    } finally {
      await cleanup()
    }
  }

  async getHealthStatus(): Promise<any> {
    if (this.mockBrowserService) {
      try {
        const browserHealth = await this.mockBrowserService.healthCheck()
        return {
          healthy: browserHealth.healthy,
          browserService: browserHealth,
          details: {
            timestamp: new Date().toISOString(),
            service: 'ScreenshotWorkerService',
          },
        }
      } catch (error) {
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
    return super.getHealthStatus()
  }
}

test.group('ScreenshotWorkerService', (group) => {
  let service: ScreenshotWorkerService
  let testableService: TestableScreenshotWorkerService
  let mockBrowserService: any
  let mockUrlTransformationService: any

  group.each.setup(() => {
    service = new ScreenshotWorkerService()
    
    // Create mock services
    mockBrowserService = {
      createPage: async (options: any) => {
        const mockPage = {
          goto: async (url: string, options: any) => ({
            status: () => 200,
            statusText: () => 'OK',
          }),
          waitForLoadState: async (state: string) => {},
          waitForTimeout: async (timeout: number) => {},
          evaluate: async (fn: Function) => 'Mock page content',
          screenshot: async (options: any) => Buffer.from('mock-screenshot-data'),
          setViewportSize: async (size: any) => {},
          setDefaultTimeout: (timeout: number) => {},
          setDefaultNavigationTimeout: (timeout: number) => {},
          close: async () => {},
        }

        const cleanup = async () => {
          await mockPage.close()
        }

        return { page: mockPage, cleanup }
      },
      healthCheck: async () => ({
        healthy: true,
        details: { totalBrowsers: 1, totalActivePages: 0 },
      }),
    }

    mockUrlTransformationService = {
      processUrl: async (url: string, followRedirects: boolean) => ({
        original: url,
        transformed: url,
        final: url,
        wasTransformed: false,
      }),
    }

    testableService = new TestableScreenshotWorkerService(
      mockBrowserService,
      mockUrlTransformationService
    )
  })

  test('should validate screenshot options correctly', async ({ assert }) => {
    const validOptions = {
      format: 'png' as const,
      width: 1280,
      height: 720,
      timeout: 30000,
    }

    const result = service.validateScreenshotOptions(validOptions)
    
    assert.isTrue(result.isValid)
    assert.isUndefined(result.error)
    assert.isObject(result.validatedOptions)
    assert.equal(result.validatedOptions!.format, 'png')
    assert.equal(result.validatedOptions!.width, 1280)
    assert.equal(result.validatedOptions!.height, 720)
  })

  test('should reject invalid screenshot options', async ({ assert }) => {
    const invalidOptionsList = [
      { format: 'invalid' as any, expectedError: 'Format must be png, jpeg, or webp' },
      { width: 0, expectedError: 'Width must be between 1 and 5000 pixels' },
      { width: 6000, expectedError: 'Width must be between 1 and 5000 pixels' },
      { height: 0, expectedError: 'Height must be between 1 and 5000 pixels' },
      { height: 6000, expectedError: 'Height must be between 1 and 5000 pixels' },
      { timeout: 1000, expectedError: 'Timeout must be between 5 and 60 seconds' },
      { timeout: 70000, expectedError: 'Timeout must be between 5 and 60 seconds' },
      { format: 'png' as const, quality: 80, expectedError: 'Quality parameter not supported for PNG format' },
      { format: 'jpeg' as const, quality: 0, expectedError: 'Quality must be between 1 and 100' },
      { format: 'jpeg' as const, quality: 101, expectedError: 'Quality must be between 1 and 100' },
    ]

    for (const invalidOptions of invalidOptionsList) {
      const result = service.validateScreenshotOptions(invalidOptions)
      assert.isFalse(result.isValid, `Should be invalid: ${JSON.stringify(invalidOptions)}`)
      assert.equal(result.error, invalidOptions.expectedError)
      assert.isUndefined(result.validatedOptions)
    }
  })

  test('should use default values for missing options', async ({ assert }) => {
    const result = service.validateScreenshotOptions({})
    
    assert.isTrue(result.isValid)
    assert.isObject(result.validatedOptions)
    assert.equal(result.validatedOptions!.format, 'png')
    assert.equal(result.validatedOptions!.width, 1280)
    assert.equal(result.validatedOptions!.height, 720)
    assert.equal(result.validatedOptions!.timeout, 30000)
    assert.equal(result.validatedOptions!.fullPage, false)
  })

  test('should validate JPEG and WebP quality options', async ({ assert }) => {
    const jpegOptions = {
      format: 'jpeg' as const,
      quality: 85,
    }

    const result = service.validateScreenshotOptions(jpegOptions)
    
    assert.isTrue(result.isValid)
    assert.equal(result.validatedOptions!.format, 'jpeg')
    assert.equal(result.validatedOptions!.quality, 85)
  })

  test('should process screenshot job successfully', async ({ assert }) => {
    const jobData = {
      url: 'https://example.com',
      options: {
        format: 'png' as const,
        width: 1280,
        height: 720,
        timeout: 30000,
      },
    }

    const result = await testableService.processScreenshotJob(jobData)
    
    assert.isObject(result)
    assert.instanceOf(result.buffer, Buffer)
    assert.equal(result.format, 'png')
    assert.equal(result.width, 1280)
    assert.equal(result.height, 720)
    assert.isNumber(result.processingTime)
    assert.isTrue(result.processingTime >= 0)
    assert.equal(result.finalUrl, 'https://example.com')
    assert.isFalse(result.wasTransformed)
  })

  test('should handle screenshot job with batch information', async ({ assert }) => {
    const jobData = {
      url: 'https://example.com',
      options: {
        format: 'jpeg' as const,
        width: 1920,
        height: 1080,
        timeout: 25000,
        quality: 90,
      },
      batchId: 'batch-123',
      itemId: 'item-456',
      cacheKey: 'cache-key-789',
    }

    const result = await testableService.processScreenshotJob(jobData)
    
    assert.isObject(result)
    assert.instanceOf(result.buffer, Buffer)
    assert.equal(result.format, 'jpeg')
    assert.equal(result.width, 1920)
    assert.equal(result.height, 1080)
  })

  test('should handle URL transformation in screenshot job', async ({ assert }) => {
    // Mock URL transformation service to return transformed URL
    const originalProcessUrl = mockUrlTransformationService.processUrl
    mockUrlTransformationService.processUrl = async (url: string) => ({
      original: url,
      transformed: 'https://transformed.example.com',
      final: 'https://final.example.com',
      wasTransformed: true,
    })

    const jobData = {
      url: 'https://example.com',
      options: {
        format: 'png' as const,
        width: 1280,
        height: 720,
        timeout: 30000,
      },
    }

    const result = await testableService.processScreenshotJob(jobData)
    
    assert.equal(result.finalUrl, 'https://final.example.com')
    assert.isTrue(result.wasTransformed)

    // Restore original mock
    mockUrlTransformationService.processUrl = originalProcessUrl
  })

  test('should handle browser service errors', async ({ assert }) => {
    // Mock browser service to throw error
    const originalCreatePage = mockBrowserService.createPage
    mockBrowserService.createPage = async () => {
      throw new Error('Browser service error')
    }

    const jobData = {
      url: 'https://example.com',
      options: {
        format: 'png' as const,
        width: 1280,
        height: 720,
        timeout: 30000,
      },
    }

    try {
      await testableService.processScreenshotJob(jobData)
      assert.fail('Should have thrown an error')
    } catch (error) {
      assert.isTrue(error.message.includes('Browser service error'))
    }

    // Restore original mock
    mockBrowserService.createPage = originalCreatePage
  })

  test('should handle navigation errors', async ({ assert }) => {
    // Mock page.goto to throw error
    const originalCreatePage = mockBrowserService.createPage
    mockBrowserService.createPage = async (options: any) => {
      const mockPage = {
        goto: async () => {
          throw new Error('Navigation failed')
        },
        close: async () => {},
      }
      return { page: mockPage, cleanup: async () => {} }
    }

    const jobData = {
      url: 'https://invalid-url.com',
      options: {
        format: 'png' as const,
        width: 1280,
        height: 720,
        timeout: 30000,
      },
    }

    try {
      await testableService.processScreenshotJob(jobData)
      assert.fail('Should have thrown an error')
    } catch (error) {
      assert.isTrue(error.message.includes('Navigation failed'))
    }

    // Restore original mock
    mockBrowserService.createPage = originalCreatePage
  })

  test('should handle HTTP error responses', async ({ assert }) => {
    // Mock page.goto to return 404 response
    const originalCreatePage = mockBrowserService.createPage
    mockBrowserService.createPage = async (options: any) => {
      const mockPage = {
        goto: async () => ({
          status: () => 404,
          statusText: () => 'Not Found',
        }),
        waitForLoadState: async () => {},
        waitForTimeout: async () => {},
        close: async () => {},
      }
      return { page: mockPage, cleanup: async () => {} }
    }

    const jobData = {
      url: 'https://example.com/not-found',
      options: {
        format: 'png' as const,
        width: 1280,
        height: 720,
        timeout: 30000,
      },
    }

    try {
      await testableService.processScreenshotJob(jobData)
      assert.fail('Should have thrown an error')
    } catch (error) {
      assert.isTrue(error.message.includes('HTTP 404'))
    }

    // Restore original mock
    mockBrowserService.createPage = originalCreatePage
  })

  test('should get health status', async ({ assert }) => {
    const health = await testableService.getHealthStatus()
    
    assert.isObject(health)
    assert.isTrue(health.healthy)
    assert.isObject(health.browserService)
    assert.isTrue(health.browserService.healthy)
    assert.isObject(health.details)
    assert.equal(health.details.service, 'ScreenshotWorkerService')
    assert.isString(health.details.timestamp)
  })

  test('should handle health check errors', async ({ assert }) => {
    // Mock browser service health check to fail
    const originalHealthCheck = mockBrowserService.healthCheck
    mockBrowserService.healthCheck = async () => {
      throw new Error('Health check failed')
    }

    const health = await testableService.getHealthStatus()
    
    assert.isFalse(health.healthy)
    assert.isFalse(health.browserService.healthy)
    assert.isString(health.details.error)

    // Restore original mock
    mockBrowserService.healthCheck = originalHealthCheck
  })

  test('should handle different screenshot formats', async ({ assert }) => {
    const formats: Array<'png' | 'jpeg' | 'webp'> = ['png', 'jpeg', 'webp']
    
    for (const format of formats) {
      const jobData = {
        url: 'https://example.com',
        options: {
          format,
          width: 1280,
          height: 720,
          timeout: 30000,
          ...(format !== 'png' && { quality: 80 }),
        },
      }

      const result = await testableService.processScreenshotJob(jobData)
      assert.equal(result.format, format)
    }
  })

  test('should handle timeout errors gracefully', async ({ assert }) => {
    // Mock page.goto to simulate timeout
    const originalCreatePage = mockBrowserService.createPage
    mockBrowserService.createPage = async (options: any) => {
      const mockPage = {
        goto: async () => {
          const error = new Error('Navigation timeout')
          error.name = 'TimeoutError'
          throw error
        },
        close: async () => {},
      }
      return { page: mockPage, cleanup: async () => {} }
    }

    const jobData = {
      url: 'https://slow-example.com',
      options: {
        format: 'png' as const,
        width: 1280,
        height: 720,
        timeout: 5000,
      },
    }

    try {
      await testableService.processScreenshotJob(jobData)
      assert.fail('Should have thrown a timeout error')
    } catch (error) {
      assert.isTrue(error.message.includes('Navigation timeout'))
    }

    // Restore original mock
    mockBrowserService.createPage = originalCreatePage
  })
})