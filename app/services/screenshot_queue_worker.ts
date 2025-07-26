import { Worker, Job, WorkerOptions } from 'bullmq'
import { Redis } from 'ioredis'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import cacheService from '#services/cache_service'
import type { ScreenshotJobData, JobResult } from '#services/queue_service'
import { getCentralRedisManager } from '#services/central_redis_manager'

export class ScreenshotQueueWorker {
  private worker: Worker<ScreenshotJobData, JobResult>
  private redisConnection: Redis

  constructor() {
    // Get Redis connection from CentralRedisManager
    // BullMQ recommends a dedicated connection, so we use duplicate()
    this.redisConnection = getCentralRedisManager().duplicateForBullMQ()

    // Override maxRetriesPerRequest for BullMQ worker requirement
    this.redisConnection.options.maxRetriesPerRequest = null

    // Worker options
    const workerOptions: WorkerOptions = {
      connection: this.redisConnection,
      prefix: 'web2img:queue',
      concurrency: env.get('SCREENSHOT_QUEUE_CONCURRENCY', 5),
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
      stalledInterval: 30 * 1000, // 30 seconds
      maxStalledCount: 1,
    }

    // Create worker
    this.worker = new Worker<ScreenshotJobData, JobResult>(
      'screenshot',
      this.processScreenshotJob.bind(this),
      workerOptions
    )

    this.setupEventListeners()
  }

  /**
   * Process a screenshot job
   */
  private async processScreenshotJob(job: Job<ScreenshotJobData>): Promise<JobResult> {
    const startTime = Date.now()
    const { url, format, width, height, cacheKey, batchId, itemId } = job.data

    logger.info('Processing screenshot job', {
      jobId: job.id,
      url,
      format,
      width,
      height,
      batchId,
      itemId,
    })

    try {
      // Update job progress
      await job.updateProgress(10)

      // Check cache first if cacheKey is provided
      let cachedResult: string | null = null
      if (cacheKey) {
        cachedResult = await cacheService.get(cacheKey)
        if (cachedResult) {
          logger.info('Screenshot found in cache', {
            jobId: job.id,
            url,
            cacheKey,
          })

          await job.updateProgress(100)

          return {
            success: true,
            imageUrl: cachedResult,
            cached: true,
            processingTime: Date.now() - startTime,
          }
        }
      }

      await job.updateProgress(20)

      // Generate screenshot using the worker service

      await job.updateProgress(80)

      await job.updateProgress(90)

      // Store the screenshot and generate URL (this would typically involve file storage and imgproxy)
      // For now, we'll create a mock URL - this should be replaced with actual storage logic
      const imageUrl = `https://storage.example.com/screenshots/${Date.now()}.${format}`

      // Cache the result if cacheKey is provided
      if (cacheKey) {
        await cacheService.set(
          cacheKey,
          imageUrl,
          env.get('SCREENSHOT_CACHE_TTL', 3600)
        )
      }

      await job.updateProgress(100)

      logger.info('Screenshot job completed successfully', {
        jobId: job.id,
        url,
        imageUrl,
        processingTime: Date.now() - startTime,
      })

      return {
        success: true,
        imageUrl,
        cached: false,
        processingTime: Date.now() - startTime,
      }
    } catch (error) {
      const processingTime = Date.now() - startTime

      logger.error('Screenshot job failed', {
        jobId: job.id,
        url,
        error: error.message,
        processingTime,
        attempt: job.attemptsMade,
      })

      // Update progress to indicate failure
      await job.updateProgress(0)

      return {
        success: false,
        error: error.message,
        processingTime,
      }
    }
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    logger.info('Starting screenshot queue worker', {
      concurrency: this.worker.opts.concurrency,
    })
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    logger.info('Stopping screenshot queue worker')
    await this.worker.close()
    await this.redisConnection.quit()
  }

  /**
   * Pause the worker
   */
  async pause(): Promise<void> {
    await this.worker.pause()
    logger.info('Screenshot queue worker paused')
  }

  /**
   * Resume the worker
   */
  async resume(): Promise<void> {
    await this.worker.resume()
    logger.info('Screenshot queue worker resumed')
  }

  /**
   * Get worker instance for external use
   */
  getWorker(): Worker<ScreenshotJobData, JobResult> {
    return this.worker
  }

  /**
   * Set up event listeners for monitoring
   */
  private setupEventListeners(): void {
    this.worker.on('ready', () => {
      logger.info('Screenshot queue worker is ready')
    })

    this.worker.on('active', (job: Job<ScreenshotJobData>) => {
      logger.debug('Screenshot job started processing', {
        jobId: job.id,
        url: job.data.url,
      })
    })

    this.worker.on('completed', (job: Job<ScreenshotJobData>, result: JobResult) => {
      logger.debug('Screenshot job completed in worker', {
        jobId: job.id,
        url: job.data.url,
        success: result.success,
        cached: result.cached,
      })
    })

    this.worker.on('failed', (job: Job<ScreenshotJobData> | undefined, error: Error) => {
      logger.error('Screenshot job failed in worker', {
        jobId: job?.id,
        url: job?.data?.url,
        error: error.message,
        attempts: job?.attemptsMade,
      })
    })

    this.worker.on('stalled', (jobId: string) => {
      logger.warn('Screenshot job stalled in worker', { jobId })
    })

    this.worker.on('error', (error: Error) => {
      logger.error('Screenshot worker error', { error: error.message })
    })

    // Note: Redis connection event logging is already handled by CentralRedisManager
  }
}

// Factory function to create a ScreenshotQueueWorker instance
let singletonInstance: ScreenshotQueueWorker | null = null;

export function getScreenshotQueueWorker(): ScreenshotQueueWorker {
  if (!singletonInstance) {
    singletonInstance = new ScreenshotQueueWorker();
  }
  return singletonInstance;
}

export function resetScreenshotQueueWorker(): void {
  singletonInstance = null;
}
