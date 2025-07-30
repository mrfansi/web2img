import { Worker, Job, WorkerOptions } from 'bullmq'
import type { Redis } from 'ioredis'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import queueService from '#services/queue_service'
import type { BatchJobData, ScreenshotJobData, JobResult } from '#services/queue_service'
import { getCentralRedisManager } from '#services/central_redis_manager'
import BatchJob from '#models/batch_job'

export interface BatchResult {
  batchId: string
  totalItems: number
  completedItems: number
  failedItems: number
  results: Array<{
    itemId: string
    success: boolean
    imageUrl?: string
    error?: string
    processingTime?: number
  }>
  totalProcessingTime: number
  webhookSent?: boolean
}

export class BatchQueueWorker {
  private worker: Worker<BatchJobData, BatchResult>
  private redisConnection: Redis

  constructor() {
    // Get Redis connection from CentralRedisManager
    // BullMQ recommends a dedicated connection, so we use duplicate()
    this.redisConnection = getCentralRedisManager().duplicateForBullMQ()

    // Worker options
    const workerOptions: WorkerOptions = {
      connection: this.redisConnection,
      prefix: 'web2img:queue',
      concurrency: 2, // Lower concurrency for batch jobs since they spawn multiple screenshot jobs
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 25 },
      stalledInterval: 60 * 1000, // 60 seconds
      maxStalledCount: 1,
    }

    // Create worker
    this.worker = new Worker<BatchJobData, BatchResult>(
      'batch',
      this.processBatchJob.bind(this),
      workerOptions
    )

    this.setupEventListeners()
  }

  /**
   * Process a batch job
   */
  private async processBatchJob(job: Job<BatchJobData>): Promise<BatchResult> {
    const startTime = Date.now()
    const { id: batchId, items, config, apiKeyId } = job.data

    logger.info('Processing batch job', {
      jobId: job.id,
      batchId,
      itemCount: items.length,
      config,
    })

    // Find the batch job in the database and mark it as processing
    const batchJobRecord = await BatchJob.find(parseInt(batchId))
    if (!batchJobRecord) {
      throw new Error(`Batch job ${batchId} not found in database`)
    }

    try {
      // Mark batch job as processing in database
      await batchJobRecord.startProcessing()

      await job.updateProgress(5)

      // Validate batch configuration
      const validatedConfig = this.validateBatchConfig(config)
      const concurrency = validatedConfig.parallel || 3
      const timeout = validatedConfig.timeout || env.get('SCREENSHOT_TIMEOUT', 30000)

      await job.updateProgress(10)

      // Create screenshot jobs for all items
      const screenshotJobs = await this.createScreenshotJobs(
        batchId,
        items,
        { timeout, apiKeyId },
        job
      )

      await job.updateProgress(20)

      // Process jobs with controlled concurrency
      const results = await this.processScreenshotJobsWithConcurrency(
        screenshotJobs,
        concurrency,
        validatedConfig.fail_fast || false,
        job
      )

      await job.updateProgress(90)

      // Send webhook if configured
      let webhookSent = false
      if (validatedConfig.webhook) {
        webhookSent = await this.sendWebhook(
          validatedConfig.webhook,
          validatedConfig.webhook_auth,
          batchId,
          results
        )
      }

      await job.updateProgress(100)

      const totalProcessingTime = Date.now() - startTime
      const completedItems = results.filter((r) => r.success).length
      const failedItems = results.length - completedItems

      // Update batch job in database with final results
      await batchJobRecord.updateProgress(completedItems, failedItems)

      // Update individual results in database
      const dbResults = results.map((result) => ({
        itemId: result.itemId,
        status: result.success ? 'success' as const : 'error' as const,
        url: result.imageUrl,
        error: result.error,
        cached: false, // This would need to be tracked from screenshot job
        processingTime: result.processingTime,
      }))

      logger.info('Saving batch results to database', {
        batchId,
        resultsCount: results.length,
        dbResultsCount: dbResults.length,
        completedItems,
        failedItems,
        results: results.map(r => ({ itemId: r.itemId, success: r.success, hasImageUrl: !!r.imageUrl }))
      })

      batchJobRecord.results = dbResults
      await batchJobRecord.markCompleted()

      logger.info('Batch job marked as completed in database', {
        batchId,
        finalResultsCount: batchJobRecord.results?.length || 0
      })

      const batchResult: BatchResult = {
        batchId,
        totalItems: items.length,
        completedItems,
        failedItems,
        results,
        totalProcessingTime,
        webhookSent,
      }

      logger.info('Batch job completed', {
        jobId: job.id,
        batchId,
        totalItems: items.length,
        completedItems,
        failedItems,
        totalProcessingTime,
        webhookSent,
      })

      return batchResult
    } catch (error) {
      const processingTime = Date.now() - startTime

      logger.error('Batch job failed', {
        jobId: job.id,
        batchId,
        error: error.message,
        processingTime,
        attempt: job.attemptsMade,
      })

      // Mark batch job as failed in database
      if (batchJobRecord) {
        await batchJobRecord.markFailed().catch((dbError) => {
          logger.error('Failed to mark batch job as failed in database', {
            batchId,
            error: dbError.message,
          })
        })
      }

      // Update progress to indicate failure
      await job.updateProgress(0)

      throw error
    }
  }

  /**
   * Create screenshot jobs for all batch items
   */
  private async createScreenshotJobs(
    batchId: string,
    items: BatchJobData['items'],
    options: { timeout: number; apiKeyId: string },
    parentJob: Job<BatchJobData>
  ): Promise<Array<{ itemId: string; jobId: string }>> {
    const jobs: Array<{ itemId: string; jobId: string }> = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const screenshotJobData: ScreenshotJobData = {
        url: item.url,
        format: item.format || 'png',
        width: item.width || 1280,
        height: item.height || 720,
        timeout: options.timeout,
        cacheKey: '', // Will be generated by the screenshot service
        batchId,
        itemId: item.id,
        apiKeyId: options.apiKeyId,
      }

      // Add job with high priority (batch jobs should be processed quickly)
      const screenshotJob = await queueService.addScreenshotJob(screenshotJobData, {
        priority: 10,
        jobId: `${batchId}-${item.id}`,
      })

      jobs.push({
        itemId: item.id,
        jobId: screenshotJob.id!,
      })

      // Update progress as we create jobs (10% to 20% range)
      const progress = 10 + Math.floor(((i + 1) / items.length) * 10)
      await parentJob.updateProgress(progress).catch(() => { }) // Don't fail on progress update error
    }

    logger.info('Created screenshot jobs for batch', {
      batchId,
      jobCount: jobs.length,
    })

    return jobs
  }

  /**
   * Process screenshot jobs with controlled concurrency
   */
  private async processScreenshotJobsWithConcurrency(
    jobs: Array<{ itemId: string; jobId: string }>,
    concurrency: number,
    failFast: boolean,
    parentJob: Job<BatchJobData>
  ): Promise<BatchResult['results']> {
    const results: BatchResult['results'] = []
    const activeJobs = new Map<string, Promise<JobResult>>()
    let completedCount = 0
    let failedCount = 0

    logger.info('Starting batch processing with concurrency control', {
      totalJobs: jobs.length,
      concurrency,
      failFast,
    })

    // Helper function to start a job
    const startJob = (jobInfo: { itemId: string; jobId: string }) => {
      logger.debug('Starting screenshot job', {
        itemId: jobInfo.itemId,
        jobId: jobInfo.jobId
      })

      const promise = this.waitForScreenshotJob(jobInfo.jobId)
        .then((result) => {
          completedCount++
          results.push({
            itemId: jobInfo.itemId,
            success: result.success,
            imageUrl: result.imageUrl,
            error: result.error,
            processingTime: result.processingTime,
          })

          logger.debug('Screenshot job result collected', {
            itemId: jobInfo.itemId,
            jobId: jobInfo.jobId,
            success: result.success,
            error: result.error,
            processingTime: result.processingTime
          })

          if (!result.success) {
            failedCount++
            if (failFast) {
              throw new Error(`Batch failed fast due to item ${jobInfo.itemId}: ${result.error}`)
            }
          }

          return result
        })
        .catch((error) => {
          failedCount++
          const errorResult = {
            itemId: jobInfo.itemId,
            success: false,
            error: error.message,
          }
          results.push(errorResult)

          logger.error('Screenshot job failed in batch processing', {
            itemId: jobInfo.itemId,
            jobId: jobInfo.jobId,
            error: error.message,
            errorStack: error.stack,
            failFast,
            errorType: error.constructor.name
          })

          if (failFast) {
            throw error
          }

          return { success: false, error: error.message }
        })
        .finally(() => {
          activeJobs.delete(jobInfo.jobId)

          // Update parent job progress
          const progress = 20 + Math.floor(((completedCount + failedCount) / jobs.length) * 70)
          parentJob.updateProgress(progress).catch(() => { }) // Don't fail batch on progress update error

          logger.debug('Screenshot job processing completed', {
            itemId: jobInfo.itemId,
            jobId: jobInfo.jobId,
            completedCount,
            failedCount,
            totalJobs: jobs.length,
            progress
          })
        })

      activeJobs.set(jobInfo.jobId, promise)
      return promise
    }

    try {
      // Simplified approach: process all jobs with Promise.all for now
      // This ensures we wait for ALL jobs to complete before proceeding
      const allPromises = jobs.map(job => startJob(job))

      logger.info('Waiting for all screenshot jobs to complete', {
        totalJobs: jobs.length,
        concurrency
      })

      // Wait for all jobs to complete
      await Promise.allSettled(allPromises)

      logger.info('Batch processing completed', {
        totalJobs: jobs.length,
        completedCount,
        failedCount,
        resultsCount: results.length,
        successfulResults: results.filter(r => r.success).length,
        failedResults: results.filter(r => !r.success).length
      })

      // Validate that we have results for all jobs
      if (results.length !== jobs.length) {
        logger.error('Mismatch between expected and actual results', {
          expectedJobs: jobs.length,
          actualResults: results.length,
          missingResults: jobs.length - results.length
        })
      }

      return results
    } catch (error) {
      // Cancel remaining jobs if fail_fast is enabled
      if (failFast) {
        logger.warn('Cancelling remaining jobs due to fail_fast', {
          remainingJobs: activeJobs.size,
        })

        for (const [jobId] of activeJobs) {
          await queueService.cancelJob(jobId, 'screenshot').catch(() => { }) // Don't fail on cancel errors
        }
      }

      throw error
    }
  }

  /**
   * Wait for a screenshot job to complete and return its result
   */
  private async waitForScreenshotJob(jobId: string): Promise<JobResult> {
    const maxWaitTime = 5 * 60 * 1000 // 5 minutes
    const pollInterval = 1000 // 1 second
    const startTime = Date.now()

    logger.debug('Waiting for screenshot job', { jobId })

    // Give the screenshot job a moment to be created before we start polling
    await new Promise((resolve) => setTimeout(resolve, 100))

    while (Date.now() - startTime < maxWaitTime) {
      const jobStatus = await queueService.getJobStatus(jobId, 'screenshot')

      if (!jobStatus) {
        // Job not found - likely cleaned up after completion
        logger.warn('Screenshot job not found, likely cleaned up after completion', {
          jobId,
          waitTime: Date.now() - startTime
        })
        throw new Error(`Screenshot job ${jobId} not found - may have been cleaned up after completion`)
      }

      // Job completed successfully
      if (jobStatus.finishedOn && jobStatus.returnvalue) {
        logger.debug('Screenshot job completed successfully', {
          jobId,
          waitTime: Date.now() - startTime
        })
        return jobStatus.returnvalue as JobResult
      }

      // Job completed but no return value (edge case)
      if (jobStatus.finishedOn && !jobStatus.returnvalue && !jobStatus.failedReason) {
        logger.warn('Screenshot job finished but has no return value', {
          jobId,
          jobStatus: {
            finishedOn: jobStatus.finishedOn,
            processedOn: jobStatus.processedOn,
            progress: jobStatus.progress
          }
        })
        return {
          success: false,
          error: 'Job completed but returned no result',
        }
      }

      // Job failed
      if (jobStatus.failedReason) {
        logger.debug('Screenshot job failed', {
          jobId,
          error: jobStatus.failedReason,
          waitTime: Date.now() - startTime
        })
        return {
          success: false,
          error: jobStatus.failedReason,
        }
      }

      // Job still processing, wait and check again
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }

    logger.error('Screenshot job timed out', {
      jobId,
      maxWaitTime,
      actualWaitTime: Date.now() - startTime
    })
    throw new Error(`Screenshot job ${jobId} timed out after ${maxWaitTime}ms`)
  }

  /**
   * Send webhook notification using the webhook service
   */
  private async sendWebhook(
    webhookUrl: string,
    authHeader: string | undefined,
    batchId: string,
    results: BatchResult['results']
  ): Promise<boolean> {
    try {
      const webhookService = (await import('#services/webhook_service')).default

      // Create webhook payload using the webhook service
      const payload = webhookService.createBatchCompletionPayload(
        batchId,
        'completed',
        results.length,
        results.filter((r) => r.success).length,
        results.filter((r) => !r.success).length,
        new Date(Date.now() - 60000), // Approximate start time
        new Date(),
        results.map((r) => ({
          itemId: r.itemId,
          status: r.success ? ('success' as const) : ('error' as const),
          url: r.imageUrl,
          error: r.error,
          cached: false, // This would need to be tracked from the screenshot job
          processingTime: r.processingTime,
        }))
      )

      // Send webhook with retry logic
      const webhookData = {
        url: webhookUrl,
        payload,
        auth: authHeader,
        maxRetries: 3,
      }

      const result = await webhookService.deliverWebhook(webhookData)

      logger.info('Webhook delivery completed', {
        batchId,
        webhookUrl,
        success: result.success,
        attempt: result.attempt,
      })

      return result.success
    } catch (error) {
      logger.error('Failed to send webhook', {
        batchId,
        webhookUrl,
        error: error.message,
      })

      return false
    }
  }

  /**
   * Validate and normalize batch configuration
   */
  private validateBatchConfig(config: BatchJobData['config']): Required<BatchJobData['config']> {
    return {
      parallel: Math.max(1, Math.min(config.parallel || 3, 10)), // Limit to 1-10
      timeout: Math.max(5000, Math.min(config.timeout || 30000, 60000)), // 5s to 60s
      webhook: config.webhook || '',
      webhook_auth: config.webhook_auth || '',
      fail_fast: config.fail_fast || false,
      cache: config.cache !== false, // Default to true
      priority: config.priority || 'normal',
    }
  }

  /**
   * Start the worker
   */
  async start(): Promise<void> {
    logger.info('Starting batch queue worker', {
      concurrency: this.worker.opts.concurrency,
    })
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    logger.info('Stopping batch queue worker')
    await this.worker.close()
    await this.redisConnection.quit()
  }

  /**
   * Pause the worker
   */
  async pause(): Promise<void> {
    await this.worker.pause()
    logger.info('Batch queue worker paused')
  }

  /**
   * Resume the worker
   */
  async resume(): Promise<void> {
    await this.worker.resume()
    logger.info('Batch queue worker resumed')
  }

  /**
   * Get worker instance for external use
   */
  getWorker(): Worker<BatchJobData, BatchResult> {
    return this.worker
  }

  /**
   * Set up event listeners for monitoring
   */
  private setupEventListeners(): void {
    this.worker.on('ready', () => {
      logger.info('Batch queue worker is ready')
    })

    this.worker.on('active', (job: Job<BatchJobData>) => {
      logger.debug('Batch job started processing', {
        jobId: job.id,
        batchId: job.data.id,
        itemCount: job.data.items.length,
      })
    })

    this.worker.on('completed', (job: Job<BatchJobData>, result: BatchResult) => {
      logger.debug('Batch job completed in worker', {
        jobId: job.id,
        batchId: result.batchId,
        completedItems: result.completedItems,
        failedItems: result.failedItems,
      })
    })

    this.worker.on('failed', (job: Job<BatchJobData> | undefined, error: Error) => {
      logger.error('Batch job failed in worker', {
        jobId: job?.id,
        batchId: job?.data?.id,
        error: error.message,
        attempts: job?.attemptsMade,
      })
    })

    this.worker.on('stalled', (jobId: string) => {
      logger.warn('Batch job stalled in worker', { jobId })
    })

    this.worker.on('error', (error: Error) => {
      logger.error('Batch worker error', { error: error.message })
    })

    // Note: Redis connection event logging is already handled by CentralRedisManager
  }
}

// Export factory function instead of singleton to prevent auto-instantiation
let instance: BatchQueueWorker | null = null

export function getBatchQueueWorker(): BatchQueueWorker {
  if (!instance) {
    instance = new BatchQueueWorker()
  }
  return instance
}

export function resetBatchQueueWorker(): void {
  instance = null
}

// Export singleton instance for backward compatibility
export default getBatchQueueWorker()
