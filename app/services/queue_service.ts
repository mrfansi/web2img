import { Queue, Worker, Job, QueueOptions, WorkerOptions } from 'bullmq'
import { Redis } from 'ioredis'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'

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
  private redisConnection: Redis

  constructor() {
    // Create Redis connection for BullMQ
    this.redisConnection = new Redis({
      host: env.get('REDIS_HOST'),
      port: env.get('REDIS_PORT'),
      password: env.get('REDIS_PASSWORD'),
      db: env.get('REDIS_DB'),
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      lazyConnect: true,
    })

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
      this.redisConnection.quit(),
    ])
    
    logger.info('Queue service closed')
  }

  /**
   * Set up event listeners for monitoring and logging
   */
  private setupEventListeners(): void {
    // Screenshot queue events
    this.screenshotQueue.on('completed', (job: Job, result: JobResult) => {
      logger.info('Screenshot job completed', {
        jobId: job.id,
        url: job.data.url,
        success: result.success,
        cached: result.cached,
        processingTime: result.processingTime,
      })
    })

    this.screenshotQueue.on('failed', (job: Job | undefined, error: Error) => {
      logger.error('Screenshot job failed', {
        jobId: job?.id,
        url: job?.data?.url,
        error: error.message,
        attempts: job?.attemptsMade,
      })
    })

    this.screenshotQueue.on('stalled', (jobId: string) => {
      logger.warn('Screenshot job stalled', { jobId })
    })

    // Batch queue events
    this.batchQueue.on('completed', (job: Job, result: any) => {
      logger.info('Batch job completed', {
        jobId: job.id,
        batchId: job.data.id,
        itemCount: job.data.items.length,
      })
    })

    this.batchQueue.on('failed', (job: Job | undefined, error: Error) => {
      logger.error('Batch job failed', {
        jobId: job?.id,
        batchId: job?.data?.id,
        error: error.message,
        attempts: job?.attemptsMade,
      })
    })

    this.batchQueue.on('stalled', (jobId: string) => {
      logger.warn('Batch job stalled', { jobId })
    })

    // Connection events
    this.redisConnection.on('connect', () => {
      logger.info('Queue Redis connection established')
    })

    this.redisConnection.on('error', (error: Error) => {
      logger.error('Queue Redis connection error', { error: error.message })
    })

    this.redisConnection.on('close', () => {
      logger.info('Queue Redis connection closed')
    })
  }
}

// Export singleton instance
export default new QueueService()