import logger from '@adonisjs/core/services/logger'
import type { ScreenshotJobData, BatchJobData } from '#services/queue_service'

/**
 * Mock Queue Service for testing environments
 * Provides the same interface as QueueService but doesn't require Redis
 */
export class MockQueueService {
  private jobs: Map<string, any> = new Map()
  private jobCounter = 0

  constructor() {
    logger.info('MockQueueService initialized for testing')
  }

  /**
   * Add a screenshot job to the mock queue
   */
  async addScreenshotJob(data: ScreenshotJobData, options: any = {}): Promise<any> {
    const jobId = `mock-screenshot-${++this.jobCounter}`
    const job = {
      id: jobId,
      name: 'screenshot',
      data,
      opts: options,
      timestamp: Date.now(),
    }

    this.jobs.set(jobId, job)
    logger.info('Mock screenshot job added', { jobId, data })

    return {
      id: jobId,
      data,
      opts: options,
    }
  }

  /**
   * Add a batch job to the mock queue
   */
  async addBatchJob(data: BatchJobData, options: any = {}): Promise<any> {
    const jobId = `mock-batch-${++this.jobCounter}`
    const job = {
      id: jobId,
      name: 'batch',
      data,
      opts: options,
      timestamp: Date.now(),
    }

    this.jobs.set(jobId, job)
    logger.info('Mock batch job added', { jobId, data })

    return {
      id: jobId,
      data,
      opts: options,
    }
  }

  /**
   * Schedule a job for future execution (mock implementation)
   */
  async scheduleJob(
    queueName: 'screenshot' | 'batch',
    data: ScreenshotJobData | BatchJobData,
    scheduledTime: Date
  ): Promise<any> {
    const delay = scheduledTime.getTime() - Date.now()
    logger.info('Mock job scheduled', { queueName, delay })

    if (queueName === 'screenshot') {
      return await this.addScreenshotJob(data as ScreenshotJobData, { delay })
    } else {
      return await this.addBatchJob(data as BatchJobData, { delay })
    }
  }

  /**
   * Get queue metrics (mock implementation)
   */
  async getQueueMetrics(queueName: 'screenshot' | 'batch'): Promise<any> {
    const queueJobs = Array.from(this.jobs.values()).filter(job =>
      queueName === 'screenshot' ? job.name === 'screenshot' : job.name === 'batch'
    )

    return {
      waiting: queueJobs.length,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
    }
  }

  /**
   * Get job by ID (mock implementation)
   */
  async getJob(_queueName: 'screenshot' | 'batch', jobId: string): Promise<any> {
    const job = this.jobs.get(jobId)
    return job || null
  }

  /**
   * Remove job (mock implementation)
   */
  async removeJob(queueName: 'screenshot' | 'batch', jobId: string): Promise<void> {
    this.jobs.delete(jobId)
    logger.info('Mock job removed', { queueName, jobId })
  }

  /**
   * Clean old jobs (mock implementation)
   */
  async cleanQueue(
    queueName: 'screenshot' | 'batch',
    grace: number = 24 * 60 * 60 * 1000,
    status: 'completed' | 'failed' = 'completed'
  ): Promise<string[]> {
    // In mock implementation, just return empty array
    logger.info('Mock queue cleaned', { queueName, grace, status })
    return []
  }

  /**
   * Get queue instance (mock implementation)
   */
  getQueue(queueName: 'screenshot' | 'batch'): any {
    return {
      name: queueName,
      add: queueName === 'screenshot' ? this.addScreenshotJob.bind(this) : this.addBatchJob.bind(this),
      getWaiting: () => Promise.resolve([]),
      getActive: () => Promise.resolve([]),
      getCompleted: () => Promise.resolve([]),
      getFailed: () => Promise.resolve([]),
      getDelayed: () => Promise.resolve([]),
    }
  }

  /**
   * Close the mock queue service
   */
  async close(): Promise<void> {
    this.jobs.clear()
    logger.info('MockQueueService closed')
  }

  /**
   * Get all jobs for testing
   */
  getAllJobs(): Map<string, any> {
    return this.jobs
  }

  /**
   * Clear all jobs for testing
   */
  clearAllJobs(): void {
    this.jobs.clear()
  }
}

// Export singleton instance
let mockQueueServiceInstance: MockQueueService | null = null

export function getMockQueueService(): MockQueueService {
  if (!mockQueueServiceInstance) {
    mockQueueServiceInstance = new MockQueueService()
  }
  return mockQueueServiceInstance
}

export default getMockQueueService()
