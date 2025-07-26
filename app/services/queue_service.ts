import { Queue, Job, QueueOptions, QueueEvents } from 'bullmq'
import { Redis } from 'ioredis'
import logger from '@adonisjs/core/services/logger'
import { getCentralRedisManager } from './central_redis_manager.js'

export interface ScreenshotJobData {
  url: string
  format: 'png' | 'jpeg' | 'webp'
  width: number
  height: number
  timeout: number
  cacheKey: string
  batchId?: string
  itemId?: string
  apiKeyId: string
}

export interface BatchJobData {
  id: string
  items: Array<{
    id: string
    url: string
    format?: 'png' | 'jpeg' | 'webp'
    width?: number
    height?: number
  }>
  config: {
    parallel?: number
    timeout?: number
    webhook?: string
    webhook_auth?: string
    fail_fast?: boolean
    cache?: boolean
    priority?: 'high' | 'normal' | 'low'
  }
  apiKeyId: string
}

export interface JobResult {
  success: boolean
  imageUrl?: string
  error?: string
  cached?: boolean
  processingTime?: number
}

export interface QueueMetrics {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}

export class QueueService {
  private screenshotQueue: Queue<ScreenshotJobData, JobResult>
  private batchQueue: Queue<BatchJobData, any>
  private screenshotQueueEvents: QueueEvents
  private batchQueueEvents: QueueEvents
  private redisConnection: Redis

  constructor() {
    // Create Redis connection for BullMQ using CentralRedisManager
    // BullMQ suggests separate connections for producers, so we duplicate the shared connection
    // Use duplicateForBullMQ() to get a connection without keyPrefix (BullMQ manages its own prefixing)
    const centralRedisManager = getCentralRedisManager()
    this.redisConnection = centralRedisManager.duplicateForBullMQ()

    // Queue options with retry and dead letter queue configuration
    const queueOptions: QueueOptions = {
      connection: this.redisConnection,
      prefix: 'web2img:queue',
      defaultJobOptions: {
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 50, // Keep last 50 failed jobs
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    }

    // Initialize queues
    this.screenshotQueue = new Queue<ScreenshotJobData, JobResult>('screenshot', queueOptions)
    this.batchQueue = new Queue<BatchJobData, any>('batch', queueOptions)

    // Initialize queue events for monitoring
    this.screenshotQueueEvents = new QueueEvents('screenshot', { connection: this.redisConnection })
    this.batchQueueEvents = new QueueEvents('batch', { connection: this.redisConnection })

    // Set up event listeners for monitoring
    this.setupEventListeners()
  }

  /**
   * Add a single screenshot job to the queue
   */
  async addScreenshotJob(
    data: ScreenshotJobData,
    options: {
      priority?: number
      delay?: number
      jobId?: string
    } = {}
  ): Promise<Job<ScreenshotJobData, JobResult>> {
    const jobOptions = {
      priority: options.priority || 0,
      delay: options.delay || 0,
      jobId: options.jobId,
    }

    logger.info('Adding screenshot job to queue', {
      url: data.url,
      batchId: data.batchId,
      itemId: data.itemId,
      options: jobOptions,
    })

    return await this.screenshotQueue.add('screenshot', data, jobOptions)
  }

  /**
   * Add a batch job to the queue
   */
  async addBatchJob(
    data: BatchJobData,
    options: {
      priority?: number
      delay?: number
      jobId?: string
    } = {}
  ): Promise<Job<BatchJobData, any>> {
    const jobOptions = {
      priority: options.priority || 0,
      delay: options.delay || 0,
      jobId: options.jobId || data.id,
    }

    logger.info('Adding batch job to queue', {
      batchId: data.id,
      itemCount: data.items.length,
      options: jobOptions,
    })

    return await this.batchQueue.add('batch', data, jobOptions)
  }

  /**
   * Schedule a job for future execution
   */
  async scheduleJob(
    queueName: 'screenshot' | 'batch',
    data: ScreenshotJobData | BatchJobData,
    scheduledTime: Date
  ): Promise<Job> {
    const delay = scheduledTime.getTime() - Date.now()

    if (delay <= 0) {
      throw new Error('Scheduled time must be in the future')
    }

    logger.info('Scheduling job for future execution', {
      queueName,
      scheduledTime: scheduledTime.toISOString(),
      delay,
    })

    if (queueName === 'screenshot') {
      return await this.addScreenshotJob(data as ScreenshotJobData, { delay })
    } else {
      return await this.addBatchJob(data as BatchJobData, { delay })
    }
  }

  /**
   * Get job status by ID
   */
  async getJobStatus(jobId: string, queueName: 'screenshot' | 'batch' = 'screenshot'): Promise<any> {
    const queue = queueName === 'screenshot' ? this.screenshotQueue : this.batchQueue
    const job = await queue.getJob(jobId)

    if (!job) {
      return null
    }

    return {
      id: job.id,
      name: job.name,
      data: job.data,
      progress: job.progress,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      opts: job.opts,
    }
  }

  /**
   * Get queue metrics
   */
  async getQueueMetrics(queueName: 'screenshot' | 'batch' = 'screenshot'): Promise<QueueMetrics> {
    const queue = queueName === 'screenshot' ? this.screenshotQueue : this.batchQueue

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed(),
    ])

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    }
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string, queueName: 'screenshot' | 'batch' = 'screenshot'): Promise<boolean> {
    const queue = queueName === 'screenshot' ? this.screenshotQueue : this.batchQueue
    const job = await queue.getJob(jobId)

    if (!job) {
      return false
    }

    try {
      await job.remove()
      logger.info('Job cancelled successfully', { jobId, queueName })
      return true
    } catch (error) {
      logger.error('Failed to cancel job', { jobId, queueName, error })
      return false
    }
  }

  /**
   * Pause a queue
   */
  async pauseQueue(queueName: 'screenshot' | 'batch'): Promise<void> {
    const queue = queueName === 'screenshot' ? this.screenshotQueue : this.batchQueue
    await queue.pause()
    logger.info('Queue paused', { queueName })
  }

  /**
   * Resume a queue
   */
  async resumeQueue(queueName: 'screenshot' | 'batch'): Promise<void> {
    const queue = queueName === 'screenshot' ? this.screenshotQueue : this.batchQueue
    await queue.resume()
    logger.info('Queue resumed', { queueName })
  }

  /**
   * Clean old jobs from queue
   */
  async cleanQueue(
    queueName: 'screenshot' | 'batch',
    grace: number = 24 * 60 * 60 * 1000, // 24 hours
    status: 'completed' | 'failed' = 'completed'
  ): Promise<string[]> {
    const queue = queueName === 'screenshot' ? this.screenshotQueue : this.batchQueue
    const jobs = await queue.clean(grace, 100, status)

    logger.info('Cleaned old jobs from queue', {
      queueName,
      status,
      cleanedCount: jobs.length,
      grace,
    })

    return jobs
  }

  /**
   * Get queue instance for external use
   */
  getQueue(queueName: 'screenshot' | 'batch'): Queue {
    return queueName === 'screenshot' ? this.screenshotQueue : this.batchQueue
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    await Promise.all([
      this.screenshotQueue.close(),
      this.batchQueue.close(),
      this.screenshotQueueEvents.close(),
      this.batchQueueEvents.close(),
      this.redisConnection.quit(),
    ])

    logger.info('Queue service closed')
  }

  /**
   * Set up event listeners for monitoring and logging
   */
  private setupEventListeners(): void {
    // Screenshot queue events
    this.screenshotQueueEvents.on('completed', ({ jobId, returnvalue }) => {
      logger.info('Screenshot job completed', {
        jobId,
        result: returnvalue,
      })
    })

    this.screenshotQueueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error('Screenshot job failed', {
        jobId,
        error: failedReason,
      })
    })

    this.screenshotQueueEvents.on('stalled', ({ jobId }) => {
      logger.warn('Screenshot job stalled', { jobId })
    })

    // Batch queue events
    this.batchQueueEvents.on('completed', ({ jobId, returnvalue }) => {
      logger.info('Batch job completed', {
        jobId,
        result: returnvalue,
      })
    })

    this.batchQueueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error('Batch job failed', {
        jobId,
        error: failedReason,
      })
    })

    this.batchQueueEvents.on('stalled', ({ jobId }) => {
      logger.warn('Batch job stalled', { jobId })
    })

    // Redis connection events are now handled by CentralRedisManager
    // No need for redundant event listeners here
  }
}

// Export singleton instance
export default new QueueService()