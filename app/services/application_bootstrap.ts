import logger from '@adonisjs/core/services/logger'
import { getCentralRedisManager } from '#services/central_redis_manager'
import { getScreenshotQueueWorker } from '#services/screenshot_queue_worker'
import { getBatchQueueWorker } from '#services/batch_queue_worker'
import jobSchedulerService from '#services/job_scheduler_service'
import { browserService } from '#services/browser_service'
import cacheService from '#services/cache_service'
import fileStorageService from '#services/file_storage_service'
import imgProxyService from '#services/imgproxy_service'
import queueService from '#services/queue_service'
import webhookService from '#services/webhook_service'

/**
 * Application Bootstrap Service
 *
 * This service is responsible for initializing and wiring together all the
 * services required for the screenshot system to function properly.
 */
export class ApplicationBootstrap {
  private static instance: ApplicationBootstrap
  private isInitialized = false
  private isShuttingDown = false

  /**
   * Get singleton instance
   */
  public static getInstance(): ApplicationBootstrap {
    if (!ApplicationBootstrap.instance) {
      ApplicationBootstrap.instance = new ApplicationBootstrap()
    }
    return ApplicationBootstrap.instance
  }

  /**
   * Initialize all services in the correct order
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Application bootstrap already initialized')
      return
    }

    logger.info('Starting application bootstrap initialization')

    try {
      // Step 1: Initialize Redis connection manager
      logger.info('Initializing Redis connection manager')
      const redisManager = getCentralRedisManager()
      await redisManager.healthCheck()
      logger.info('Redis connection manager initialized successfully')

      // Step 2: Initialize cache service
      logger.info('Initializing cache service')
      await cacheService.healthCheck()
      logger.info('Cache service initialized successfully')

      // Step 3: Initialize file storage service
      logger.info('Initializing file storage service')
      await fileStorageService.initialize()
      logger.info('File storage service initialized successfully')

      // Step 4: Initialize ImgProxy service
      logger.info('Initializing ImgProxy service')
      const imgProxyConfigured = imgProxyService.isAvailable()
      if (imgProxyConfigured) {
        logger.info('ImgProxy service configured and ready')
      } else {
        logger.warn('ImgProxy service not configured - will use direct storage URLs')
      }

      // Step 5: Initialize browser service
      logger.info('Initializing browser service')
      // Browser service is initialized on first use, just perform health check
      try {
        const browserHealth = await browserService.healthCheck()
        if (!browserHealth.healthy) {
          logger.warn('Browser service health check failed, but continuing startup', {
            details: browserHealth.details,
          })
          // Don't throw error - allow application to start and retry later
        } else {
          logger.info('Browser service initialized successfully')
        }
      } catch (error) {
        logger.warn('Browser service health check threw error, but continuing startup', {
          error: error.message,
        })
        // Don't throw error - allow application to start and retry later
      }

      // Step 6: Initialize queue service
      logger.info('Initializing queue service')
      // Queue service is already initialized via its constructor
      const screenshotMetrics = await queueService.getQueueMetrics('screenshot')
      const batchMetrics = await queueService.getQueueMetrics('batch')
      logger.info('Queue service initialized successfully', {
        screenshotQueue: screenshotMetrics,
        batchQueue: batchMetrics,
      })

      // Step 7: Initialize job scheduler service
      logger.info('Initializing job scheduler service')
      await jobSchedulerService.initialize()
      logger.info('Job scheduler service initialized successfully')

      // Step 8: Initialize queue workers
      logger.info('Initializing queue workers')
      const screenshotWorker = getScreenshotQueueWorker()
      const batchWorker = getBatchQueueWorker()

      await screenshotWorker.start()
      await batchWorker.start()
      logger.info('Queue workers initialized successfully')

      // Step 9: Set up graceful shutdown handlers
      this.setupGracefulShutdown()

      this.isInitialized = true
      logger.info('Application bootstrap initialization completed successfully')
    } catch (error) {
      logger.error('Application bootstrap initialization failed', {
        error: error.message,
        stack: error.stack,
      })
      throw error
    }
  }

  /**
   * Perform health check on all services
   */
  async healthCheck(): Promise<{
    healthy: boolean
    services: Record<string, any>
    timestamp: string
  }> {
    const timestamp = new Date().toISOString()
    const services: Record<string, any> = {}
    let overallHealthy = true

    try {
      // Check Redis
      try {
        const redisManager = getCentralRedisManager()
        services.redis = await redisManager.healthCheck()
        if (!services.redis.healthy) overallHealthy = false
      } catch (error) {
        services.redis = { healthy: false, error: error.message }
        overallHealthy = false
      }

      // Check Cache Service
      try {
        services.cache = await cacheService.healthCheck()
        if (!services.cache.healthy) overallHealthy = false
      } catch (error) {
        services.cache = { healthy: false, error: error.message }
        overallHealthy = false
      }

      // Check File Storage
      try {
        services.fileStorage = await fileStorageService.healthCheck()
        if (!services.fileStorage.healthy) overallHealthy = false
      } catch (error) {
        services.fileStorage = { healthy: false, error: error.message }
        overallHealthy = false
      }

      // Check ImgProxy
      try {
        services.imgProxy = {
          healthy: true,
          configured: imgProxyService.isAvailable(),
          timestamp,
        }
      } catch (error) {
        services.imgProxy = { healthy: false, error: error.message }
        overallHealthy = false
      }

      // Check Browser Service
      try {
        services.browser = await browserService.healthCheck()
        if (!services.browser.healthy) overallHealthy = false
      } catch (error) {
        services.browser = { healthy: false, error: error.message }
        overallHealthy = false
      }

      // Check Queue Service
      try {
        const screenshotMetrics = await queueService.getQueueMetrics('screenshot')
        const batchMetrics = await queueService.getQueueMetrics('batch')
        services.queue = {
          healthy: true,
          screenshot: screenshotMetrics,
          batch: batchMetrics,
          timestamp,
        }
      } catch (error) {
        services.queue = { healthy: false, error: error.message }
        overallHealthy = false
      }

      // Check Workers
      try {
        const screenshotWorker = getScreenshotQueueWorker()
        const batchWorker = getBatchQueueWorker()

        services.workers = {
          healthy: true,
          screenshot: {
            running: screenshotWorker.getWorker().isRunning(),
            paused: screenshotWorker.getWorker().isPaused(),
          },
          batch: {
            running: batchWorker.getWorker().isRunning(),
            paused: batchWorker.getWorker().isPaused(),
          },
          timestamp,
        }
      } catch (error) {
        services.workers = { healthy: false, error: error.message }
        overallHealthy = false
      }

      return {
        healthy: overallHealthy,
        services,
        timestamp,
      }
    } catch (error) {
      logger.error('Health check failed', { error: error.message })
      return {
        healthy: false,
        services: {
          error: error.message,
        },
        timestamp,
      }
    }
  }

  /**
   * Get system metrics and status
   */
  async getSystemMetrics(): Promise<{
    queues: {
      screenshot: any
      batch: any
    }
    scheduledJobs: any[]
    cache: any
    browser: any
    timestamp: string
  }> {
    try {
      const [screenshotMetrics, batchMetrics, scheduledJobs, cacheStats, browserHealth] =
        await Promise.all([
          queueService.getQueueMetrics('screenshot'),
          queueService.getQueueMetrics('batch'),
          jobSchedulerService.listScheduledJobs(),
          cacheService.getStats(),
          browserService.healthCheck(),
        ])

      return {
        queues: {
          screenshot: screenshotMetrics,
          batch: batchMetrics,
        },
        scheduledJobs: scheduledJobs.map((job) => ({
          id: job.id,
          type: job.type,
          status: job.status.status,
          nextRun: job.status.nextRun,
          runCount: job.status.runCount,
        })),
        cache: cacheStats,
        browser: browserHealth,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      logger.error('Failed to get system metrics', { error: error.message })
      throw error
    }
  }

  /**
   * Test complete workflow from API request to ImgProxy URL response
   */
  async testCompleteWorkflow(testUrl: string = 'https://example.com'): Promise<{
    success: boolean
    steps: Array<{
      step: string
      success: boolean
      duration: number
      result?: any
      error?: string
    }>
    totalDuration: number
  }> {
    const startTime = Date.now()
    const steps: Array<{
      step: string
      success: boolean
      duration: number
      result?: any
      error?: string
    }> = []

    logger.info('Starting complete workflow test', { testUrl })

    // Step 1: URL Transformation
    let stepStart = Date.now()
    try {
      const { urlTransformationService } = await import('#services/url_transformation_service')
      const urlResult = await urlTransformationService.processUrl(testUrl, true)
      steps.push({
        step: 'URL Transformation',
        success: true,
        duration: Date.now() - stepStart,
        result: urlResult,
      })
    } catch (error) {
      steps.push({
        step: 'URL Transformation',
        success: false,
        duration: Date.now() - stepStart,
        error: error.message,
      })
    }

    // Step 2: Cache Check
    stepStart = Date.now()
    try {
      const cacheKey = cacheService.generateCacheKey(testUrl, {
        format: 'png',
        width: 1280,
        height: 720,
      })
      const cachedResult = await cacheService.get(cacheKey)
      steps.push({
        step: 'Cache Check',
        success: true,
        duration: Date.now() - stepStart,
        result: { cacheKey: cacheKey.substring(0, 16) + '...', cached: !!cachedResult },
      })
    } catch (error) {
      steps.push({
        step: 'Cache Check',
        success: false,
        duration: Date.now() - stepStart,
        error: error.message,
      })
    }

    // Step 3: Screenshot Capture
    stepStart = Date.now()
    try {
      const { screenshotWorkerService } = await import('#services/screenshot_worker_service')
      const screenshotResult = await screenshotWorkerService.processScreenshotJob({
        url: testUrl,
        options: {
          format: 'png',
          width: 1280,
          height: 720,
          timeout: 30000,
        },
      })
      steps.push({
        step: 'Screenshot Capture',
        success: true,
        duration: Date.now() - stepStart,
        result: {
          format: screenshotResult.format,
          size: screenshotResult.buffer.length,
          processingTime: screenshotResult.processingTime,
        },
      })
    } catch (error) {
      steps.push({
        step: 'Screenshot Capture',
        success: false,
        duration: Date.now() - stepStart,
        error: error.message,
      })
    }

    // Step 4: File Storage
    stepStart = Date.now()
    try {
      const testBuffer = Buffer.from('test-screenshot-data')
      const filename = `test-${Date.now()}.png`
      const storagePath = await fileStorageService.saveFile(testBuffer, filename, 'screenshots')
      const directUrl = fileStorageService.getFileUrl(storagePath)

      steps.push({
        step: 'File Storage',
        success: true,
        duration: Date.now() - stepStart,
        result: { storagePath, directUrl: directUrl.substring(0, 50) + '...' },
      })

      // Clean up test file
      await fileStorageService.deleteFile(storagePath).catch(() => {})
    } catch (error) {
      steps.push({
        step: 'File Storage',
        success: false,
        duration: Date.now() - stepStart,
        error: error.message,
      })
    }

    // Step 5: ImgProxy URL Generation
    stepStart = Date.now()
    try {
      const testImagePath = '/test/image.png'
      const imgProxyUrl = imgProxyService.generateUrlWithFallback(testImagePath, {
        format: 'png',
        width: 1280,
        height: 720,
      })
      steps.push({
        step: 'ImgProxy URL Generation',
        success: true,
        duration: Date.now() - stepStart,
        result: {
          configured: imgProxyService.isAvailable(),
          url: imgProxyUrl.substring(0, 50) + '...',
        },
      })
    } catch (error) {
      steps.push({
        step: 'ImgProxy URL Generation',
        success: false,
        duration: Date.now() - stepStart,
        error: error.message,
      })
    }

    const totalDuration = Date.now() - startTime
    const success = steps.every((step) => step.success)

    logger.info('Complete workflow test finished', {
      success,
      totalDuration,
      stepCount: steps.length,
      failedSteps: steps.filter((s) => !s.success).length,
    })

    return {
      success,
      steps,
      totalDuration,
    }
  }

  /**
   * Test webhook delivery for batch job completions
   */
  async testWebhookDelivery(
    webhookUrl: string,
    testJobId: string = 'test-job-123'
  ): Promise<{
    success: boolean
    result: any
    duration: number
  }> {
    const startTime = Date.now()

    logger.info('Testing webhook delivery', { webhookUrl, testJobId })

    try {
      // Create test webhook payload
      const testPayload = webhookService.createBatchCompletionPayload(
        testJobId,
        'completed',
        5,
        4,
        1,
        new Date(Date.now() - 60000), // 1 minute ago
        new Date(),
        [
          {
            itemId: 'item-1',
            status: 'success',
            url: 'https://example.com/image1.png',
            cached: false,
          },
          {
            itemId: 'item-2',
            status: 'success',
            url: 'https://example.com/image2.png',
            cached: true,
          },
          {
            itemId: 'item-3',
            status: 'success',
            url: 'https://example.com/image3.png',
            cached: false,
          },
          {
            itemId: 'item-4',
            status: 'success',
            url: 'https://example.com/image4.png',
            cached: false,
          },
          { itemId: 'item-5', status: 'error', error: 'Failed to capture screenshot' },
        ]
      )

      // Send webhook
      const result = await webhookService.sendWebhook(webhookUrl, testPayload)

      const duration = Date.now() - startTime

      logger.info('Webhook delivery test completed', {
        success: result.success,
        statusCode: result.statusCode,
        duration,
      })

      return {
        success: result.success,
        result,
        duration,
      }
    } catch (error) {
      const duration = Date.now() - startTime

      logger.error('Webhook delivery test failed', {
        error: error.message,
        duration,
      })

      return {
        success: false,
        result: { error: error.message },
        duration,
      }
    }
  }

  /**
   * Test scheduled and recurring job execution
   */
  async testScheduledJobExecution(): Promise<{
    success: boolean
    results: {
      oneTimeJob: any
      recurringJob: any
    }
    duration: number
  }> {
    const startTime = Date.now()

    logger.info('Testing scheduled job execution')

    try {
      // Test one-time scheduled job
      const oneTimeJobId = `test-onetime-${Date.now()}`
      const executeAt = new Date(Date.now() + 5000) // 5 seconds from now

      const oneTimeResult = await jobSchedulerService.scheduleOnceJob(
        {
          id: oneTimeJobId,
          type: 'screenshot',
          data: {
            url: 'https://example.com',
            format: 'png',
            width: 1280,
            height: 720,
            timeout: 30000,
            cacheKey: '',
            apiKeyId: 'test-api-key',
          },
          schedule: {
            type: 'once',
            executeAt,
          },
          metadata: {
            createdAt: new Date(),
            createdBy: 'system-test',
            description: 'Test one-time scheduled job',
          },
        },
        executeAt
      )

      // Test recurring job (every minute, max 2 runs)
      const recurringJobId = `test-recurring-${Date.now()}`
      const recurringResult = await jobSchedulerService.scheduleRecurringJob(
        {
          id: recurringJobId,
          type: 'screenshot',
          data: {
            url: 'https://example.com',
            format: 'png',
            width: 1280,
            height: 720,
            timeout: 30000,
            cacheKey: '',
            apiKeyId: 'test-api-key',
          },
          schedule: {
            type: 'recurring',
            cronExpression: '*/1 * * * *', // Every minute
          },
          metadata: {
            createdAt: new Date(),
            createdBy: 'system-test',
            description: 'Test recurring job',
          },
        },
        '*/1 * * * *',
        { maxRuns: 2 }
      )

      // Wait a moment then check status
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const oneTimeStatus = await jobSchedulerService.getScheduledJobStatus(oneTimeJobId)
      const recurringStatus = await jobSchedulerService.getScheduledJobStatus(recurringJobId)

      // Clean up test jobs
      await jobSchedulerService.cancelScheduledJob(oneTimeJobId)
      await jobSchedulerService.cancelScheduledJob(recurringJobId)

      const duration = Date.now() - startTime

      logger.info('Scheduled job execution test completed', {
        oneTimeJob: oneTimeStatus,
        recurringJob: recurringStatus,
        duration,
      })

      return {
        success: true,
        results: {
          oneTimeJob: { ...oneTimeResult, status: oneTimeStatus },
          recurringJob: { ...recurringResult, status: recurringStatus },
        },
        duration,
      }
    } catch (error) {
      const duration = Date.now() - startTime

      logger.error('Scheduled job execution test failed', {
        error: error.message,
        duration,
      })

      return {
        success: false,
        results: {
          oneTimeJob: { error: error.message },
          recurringJob: { error: error.message },
        },
        duration,
      }
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const gracefulShutdown = async (signal: string) => {
      if (this.isShuttingDown) {
        logger.warn('Shutdown already in progress, ignoring signal', { signal })
        return
      }

      this.isShuttingDown = true
      logger.info('Received shutdown signal, starting graceful shutdown', { signal })

      try {
        await this.shutdown()
        logger.info('Graceful shutdown completed')
        process.exit(0)
      } catch (error) {
        logger.error('Error during graceful shutdown', { error: error.message })
        process.exit(1)
      }
    }

    // Handle various shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
    process.on('SIGINT', () => gracefulShutdown('SIGINT'))
    process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')) // PM2 reload

    // Handle uncaught exceptions and unhandled rejections
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack })
      gracefulShutdown('uncaughtException')
    })

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', { reason, promise })
      gracefulShutdown('unhandledRejection')
    })
  }

  /**
   * Gracefully shutdown all services
   */
  async shutdown(): Promise<void> {
    logger.info('Starting application shutdown')

    try {
      // Step 1: Stop accepting new jobs
      logger.info('Pausing queue workers')
      const screenshotWorker = getScreenshotQueueWorker()
      const batchWorker = getBatchQueueWorker()

      await screenshotWorker.pause()
      await batchWorker.pause()

      // Step 2: Wait for active jobs to complete (with timeout)
      logger.info('Waiting for active jobs to complete')
      const shutdownTimeout = 30000 // 30 seconds
      const startTime = Date.now()

      while (Date.now() - startTime < shutdownTimeout) {
        const screenshotMetrics = await queueService.getQueueMetrics('screenshot')
        const batchMetrics = await queueService.getQueueMetrics('batch')

        if (screenshotMetrics.active === 0 && batchMetrics.active === 0) {
          logger.info('All active jobs completed')
          break
        }

        logger.info('Waiting for active jobs to complete', {
          screenshot: screenshotMetrics.active,
          batch: batchMetrics.active,
        })

        await new Promise((resolve) => setTimeout(resolve, 1000))
      }

      // Step 3: Stop workers
      logger.info('Stopping queue workers')
      await screenshotWorker.stop()
      await batchWorker.stop()

      // Step 4: Shutdown job scheduler
      logger.info('Shutting down job scheduler')
      await jobSchedulerService.shutdown()

      // Step 5: Close queue service
      logger.info('Closing queue service')
      await queueService.close()

      // Step 6: Close browser service
      logger.info('Closing browser service')
      await browserService.shutdown()

      // Step 7: Close Redis connections (handled by CentralRedisManager)
      logger.info('Closing Redis connections')
      const redisManager = getCentralRedisManager()
      await redisManager.shutdown()

      logger.info('Application shutdown completed successfully')
    } catch (error) {
      logger.error('Error during application shutdown', {
        error: error.message,
        stack: error.stack,
      })
      throw error
    }
  }

  /**
   * Check if application is initialized
   */
  isReady(): boolean {
    return this.isInitialized && !this.isShuttingDown
  }
}

// Export singleton instance
export default ApplicationBootstrap.getInstance()
