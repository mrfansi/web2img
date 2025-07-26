import { Job } from 'bullmq'
import type { Redis } from 'ioredis'
import { CronJob } from 'cron'
import logger from '@adonisjs/core/services/logger'
import queueService from '#services/queue_service'
import type { ScreenshotJobData, BatchJobData } from '#services/queue_service'
import { getCentralRedisManager } from '#services/central_redis_manager'

export interface ScheduledJobData {
  id: string
  type: 'screenshot' | 'batch'
  data: ScreenshotJobData | BatchJobData
  schedule: {
    type: 'once' | 'recurring'
    executeAt?: Date
    cronExpression?: string
    timezone?: string
    endDate?: Date
    maxRuns?: number
  }
  metadata: {
    createdAt: Date
    createdBy: string
    description?: string
    tags?: string[]
  }
}

export interface ScheduledJobStatus {
  id: string
  status: 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled'
  nextRun?: Date
  lastRun?: Date
  runCount: number
  maxRuns?: number
  error?: string
}

export class JobSchedulerService {
  private redisConnection: Redis
  private scheduledJobs: Map<string, CronJob> = new Map()

  constructor() {
    // Get Redis connection from CentralRedisManager
    // Use duplicateRawRedis() to get a raw ioredis connection for the scheduler
    this.redisConnection = getCentralRedisManager().duplicateRawRedis()
  }

  /**
   * Schedule a one-time job for future execution
   */
  async scheduleOnceJob(
    jobData: ScheduledJobData,
    executeAt: Date
  ): Promise<{ jobId: string; scheduledJobId: string }> {
    const delay = executeAt.getTime() - Date.now()

    if (delay <= 0) {
      throw new Error('Scheduled time must be in the future')
    }

    logger.info('Scheduling one-time job', {
      scheduledJobId: jobData.id,
      type: jobData.type,
      executeAt: executeAt.toISOString(),
      delay,
    })

    // Store scheduled job metadata
    await this.storeScheduledJobMetadata({
      ...jobData,
      schedule: {
        type: 'once',
        executeAt,
      },
    })

    // Schedule the job using BullMQ delayed jobs
    let job: Job
    if (jobData.type === 'screenshot') {
      job = await queueService.addScreenshotJob(jobData.data as ScreenshotJobData, {
        delay,
        jobId: `scheduled-${jobData.id}`,
      })
    } else {
      job = await queueService.addBatchJob(jobData.data as BatchJobData, {
        delay,
        jobId: `scheduled-${jobData.id}`,
      })
    }

    // Update status
    await this.updateScheduledJobStatus(jobData.id, {
      id: jobData.id,
      status: 'scheduled',
      nextRun: executeAt,
      runCount: 0,
      maxRuns: 1,
    })

    return {
      jobId: job.id!,
      scheduledJobId: jobData.id,
    }
  }

  /**
   * Schedule a recurring job using cron expression
   */
  async scheduleRecurringJob(
    jobData: ScheduledJobData,
    cronExpression: string,
    options: {
      timezone?: string
      endDate?: Date
      maxRuns?: number
    } = {}
  ): Promise<{ scheduledJobId: string }> {
    logger.info('Scheduling recurring job', {
      scheduledJobId: jobData.id,
      type: jobData.type,
      cronExpression,
      options,
    })

    // Validate cron expression
    if (!this.isValidCronExpression(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`)
    }

    // Store scheduled job metadata
    await this.storeScheduledJobMetadata({
      ...jobData,
      schedule: {
        type: 'recurring',
        cronExpression,
        timezone: options.timezone || 'UTC',
        endDate: options.endDate,
        maxRuns: options.maxRuns,
      },
    })

    // Create cron job
    const cronJob = new CronJob(
      cronExpression,
      () => this.executeRecurringJob(jobData.id),
      null,
      false,
      options.timezone || 'UTC'
    )

    // Store cron job reference
    this.scheduledJobs.set(jobData.id, cronJob)

    // Start the cron job
    cronJob.start()

    // Update status
    await this.updateScheduledJobStatus(jobData.id, {
      id: jobData.id,
      status: 'scheduled',
      nextRun: cronJob.nextDate() as unknown as Date,
      runCount: 0,
      maxRuns: options.maxRuns,
    })

    return {
      scheduledJobId: jobData.id,
    }
  }

  /**
   * Execute a recurring job
   */
  private async executeRecurringJob(scheduledJobId: string): Promise<void> {
    try {
      logger.info('Executing recurring job', { scheduledJobId })

      // Get job metadata
      const jobMetadata = await this.getScheduledJobMetadata(scheduledJobId)
      if (!jobMetadata) {
        logger.error('Scheduled job metadata not found', { scheduledJobId })
        return
      }

      // Get current status
      const currentStatus = await this.getScheduledJobStatus(scheduledJobId)
      if (!currentStatus) {
        logger.error('Scheduled job status not found', { scheduledJobId })
        return
      }

      // Check if job should still run
      if (currentStatus.status === 'cancelled') {
        logger.info('Skipping cancelled recurring job', { scheduledJobId })
        return
      }

      // Check max runs limit
      if (currentStatus.maxRuns && currentStatus.runCount >= currentStatus.maxRuns) {
        logger.info('Recurring job reached max runs limit', {
          scheduledJobId,
          runCount: currentStatus.runCount,
          maxRuns: currentStatus.maxRuns,
        })
        await this.cancelScheduledJob(scheduledJobId)
        return
      }

      // Check end date
      if (jobMetadata.schedule.endDate && new Date() > jobMetadata.schedule.endDate) {
        logger.info('Recurring job reached end date', {
          scheduledJobId,
          endDate: jobMetadata.schedule.endDate,
        })
        await this.cancelScheduledJob(scheduledJobId)
        return
      }

      // Update status to running
      await this.updateScheduledJobStatus(scheduledJobId, {
        ...currentStatus,
        status: 'running',
        lastRun: new Date(),
      })

      // Execute the job
      let job: Job
      if (jobMetadata.type === 'screenshot') {
        job = await queueService.addScreenshotJob(jobMetadata.data as ScreenshotJobData, {
          priority: 5, // Higher priority for scheduled jobs
          jobId: `recurring-${scheduledJobId}-${Date.now()}`,
        })
      } else {
        job = await queueService.addBatchJob(jobMetadata.data as BatchJobData, {
          priority: 5,
          jobId: `recurring-${scheduledJobId}-${Date.now()}`,
        })
      }

      // Update run count and next run time
      const cronJob = this.scheduledJobs.get(scheduledJobId)
      const nextRun = cronJob ? cronJob.nextDate() as unknown as Date : undefined

      await this.updateScheduledJobStatus(scheduledJobId, {
        ...currentStatus,
        status: 'scheduled',
        runCount: currentStatus.runCount + 1,
        nextRun,
      })

      logger.info('Recurring job executed successfully', {
        scheduledJobId,
        jobId: job.id,
        runCount: currentStatus.runCount + 1,
        nextRun,
      })
    } catch (error) {
      logger.error('Failed to execute recurring job', {
        scheduledJobId,
        error: error.message,
      })

      // Update status to failed
      const currentStatus = await this.getScheduledJobStatus(scheduledJobId)
      if (currentStatus) {
        await this.updateScheduledJobStatus(scheduledJobId, {
          ...currentStatus,
          status: 'failed',
          error: error.message,
        })
      }
    }
  }

  /**
   * Cancel a scheduled job
   */
  async cancelScheduledJob(scheduledJobId: string): Promise<boolean> {
    try {
      logger.info('Cancelling scheduled job', { scheduledJobId })

      // Stop cron job if it exists
      const cronJob = this.scheduledJobs.get(scheduledJobId)
      if (cronJob) {
        cronJob.stop()
        this.scheduledJobs.delete(scheduledJobId)
      }

      // Update status
      const currentStatus = await this.getScheduledJobStatus(scheduledJobId)
      if (currentStatus) {
        await this.updateScheduledJobStatus(scheduledJobId, {
          ...currentStatus,
          status: 'cancelled',
        })
      }

      // Try to cancel any pending BullMQ jobs (ignore errors if jobs don't exist)
      try {
        await queueService.cancelJob(`scheduled-${scheduledJobId}`, 'screenshot')
      } catch (error) {
        // Ignore errors - job might not exist
      }

      try {
        await queueService.cancelJob(`scheduled-${scheduledJobId}`, 'batch')
      } catch (error) {
        // Ignore errors - job might not exist
      }

      logger.info('Scheduled job cancelled successfully', { scheduledJobId })
      return true
    } catch (error) {
      logger.error('Failed to cancel scheduled job', {
        scheduledJobId,
        error: error.message,
      })
      return false
    }
  }

  /**
   * Modify a scheduled job
   */
  async modifyScheduledJob(
    scheduledJobId: string,
    updates: {
      cronExpression?: string
      timezone?: string
      endDate?: Date
      maxRuns?: number
      data?: ScreenshotJobData | BatchJobData
    }
  ): Promise<boolean> {
    try {
      logger.info('Modifying scheduled job', { scheduledJobId, updates })

      // Get current job metadata
      const currentMetadata = await this.getScheduledJobMetadata(scheduledJobId)
      if (!currentMetadata) {
        throw new Error('Scheduled job not found')
      }

      // For recurring jobs, update cron schedule if needed
      if (currentMetadata.schedule.type === 'recurring' && updates.cronExpression) {
        if (!this.isValidCronExpression(updates.cronExpression)) {
          throw new Error(`Invalid cron expression: ${updates.cronExpression}`)
        }

        // Stop current cron job
        const cronJob = this.scheduledJobs.get(scheduledJobId)
        if (cronJob) {
          cronJob.stop()
        }

        // Create new cron job with updated expression
        const newCronJob = new CronJob(
          updates.cronExpression,
          () => this.executeRecurringJob(scheduledJobId),
          null,
          false,
          updates.timezone || currentMetadata.schedule.timezone || 'UTC'
        )

        this.scheduledJobs.set(scheduledJobId, newCronJob)
        newCronJob.start()

        // Update next run time
        const currentStatus = await this.getScheduledJobStatus(scheduledJobId)
        if (currentStatus) {
          await this.updateScheduledJobStatus(scheduledJobId, {
            ...currentStatus,
            nextRun: newCronJob.nextDate() as unknown as Date,
          })
        }
      }

      // Update metadata
      const updatedMetadata: ScheduledJobData = {
        ...currentMetadata,
        data: updates.data || currentMetadata.data,
        schedule: {
          ...currentMetadata.schedule,
          cronExpression: updates.cronExpression || currentMetadata.schedule.cronExpression,
          timezone: updates.timezone || currentMetadata.schedule.timezone,
          endDate: updates.endDate !== undefined ? updates.endDate : currentMetadata.schedule.endDate,
          maxRuns: updates.maxRuns !== undefined ? updates.maxRuns : currentMetadata.schedule.maxRuns,
        },
      }

      await this.storeScheduledJobMetadata(updatedMetadata)

      logger.info('Scheduled job modified successfully', { scheduledJobId })
      return true
    } catch (error) {
      logger.error('Failed to modify scheduled job', {
        scheduledJobId,
        error: error.message,
      })
      return false
    }
  }

  /**
   * Get scheduled job status
   */
  async getScheduledJobStatus(scheduledJobId: string): Promise<ScheduledJobStatus | null> {
    try {
      const key = `scheduled:status:${scheduledJobId}`
      const statusData = await this.redisConnection.get(key)

      if (!statusData) {
        return null
      }

      const status = JSON.parse(statusData)

      // Convert date strings back to Date objects
      if (status.nextRun) status.nextRun = new Date(status.nextRun)
      if (status.lastRun) status.lastRun = new Date(status.lastRun)

      return status
    } catch (error) {
      logger.error('Failed to get scheduled job status', {
        scheduledJobId,
        error: error.message,
      })
      return null
    }
  }

  /**
   * List all scheduled jobs
   */
  async listScheduledJobs(filters: {
    status?: ScheduledJobStatus['status']
    type?: 'screenshot' | 'batch'
    createdBy?: string
  } = {}): Promise<Array<ScheduledJobData & { status: ScheduledJobStatus }>> {
    try {
      const pattern = 'scheduled:metadata:*'
      const keys = await this.redisConnection.keys(pattern)

      const jobs: Array<ScheduledJobData & { status: ScheduledJobStatus }> = []

      for (const key of keys) {
        const scheduledJobId = key.replace('scheduled:metadata:', '')
        const metadata = await this.getScheduledJobMetadata(scheduledJobId)
        const status = await this.getScheduledJobStatus(scheduledJobId)

        if (metadata && status) {
          // Apply filters
          if (filters.status && status.status !== filters.status) continue
          if (filters.type && metadata.type !== filters.type) continue
          if (filters.createdBy && metadata.metadata.createdBy !== filters.createdBy) continue

          jobs.push({ ...metadata, status })
        }
      }

      return jobs.sort((a, b) => b.metadata.createdAt.getTime() - a.metadata.createdAt.getTime())
    } catch (error) {
      logger.error('Failed to list scheduled jobs', { error: error.message })
      return []
    }
  }

  /**
   * Clean up completed and failed jobs older than specified time
   */
  async cleanupOldJobs(olderThanHours: number = 24): Promise<number> {
    try {
      const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000)
      const allJobs = await this.listScheduledJobs()

      let cleanedCount = 0

      for (const job of allJobs) {
        if (
          (job.status.status === 'completed' || job.status.status === 'failed') &&
          job.metadata.createdAt < cutoffTime
        ) {
          await this.deleteScheduledJob(job.id)
          cleanedCount++
        }
      }

      logger.info('Cleaned up old scheduled jobs', {
        cleanedCount,
        olderThanHours,
      })

      return cleanedCount
    } catch (error) {
      logger.error('Failed to cleanup old jobs', { error: error.message })
      return 0
    }
  }

  /**
   * Initialize scheduler (restore recurring jobs from Redis)
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing job scheduler')

      const recurringJobs = await this.listScheduledJobs({
        status: 'scheduled',
      })

      for (const job of recurringJobs) {
        if (job.schedule.type === 'recurring' && job.schedule.cronExpression) {
          const cronJob = new CronJob(
            job.schedule.cronExpression,
            () => this.executeRecurringJob(job.id),
            null,
            false,
            job.schedule.timezone || 'UTC'
          )

          this.scheduledJobs.set(job.id, cronJob)
          cronJob.start()

          logger.info('Restored recurring job', {
            scheduledJobId: job.id,
            cronExpression: job.schedule.cronExpression,
          })
        }
      }

      logger.info('Job scheduler initialized', {
        restoredJobs: this.scheduledJobs.size,
      })
    } catch (error) {
      logger.error('Failed to initialize job scheduler', { error: error.message })
    }
  }

  /**
   * Shutdown scheduler
   */
  async shutdown(): Promise<void> {
    try {
      logger.info('Shutting down job scheduler')

      // Stop all cron jobs
      for (const [_, cronJob] of this.scheduledJobs) {
        cronJob.stop()
      }
      this.scheduledJobs.clear()

      // Close Redis connection gracefully
      // This is a duplicated connection from CentralRedisManager, so we handle it directly
      try {
        await this.redisConnection.quit()
        logger.info('Job scheduler Redis connection gracefully closed')
      } catch (quitError) {
        logger.warn('Job scheduler Redis quit failed, forcing disconnect', { error: quitError })

        // If quit fails, force disconnect
        try {
          this.redisConnection.disconnect()
          logger.info('Job scheduler Redis connection forcefully disconnected')
        } catch (disconnectError) {
          logger.error('Job scheduler Redis disconnect failed', { error: disconnectError })
        }
      }

      logger.info('Job scheduler shutdown completed')
    } catch (error) {
      logger.error('Error during scheduler shutdown', { error: error.message })
    }
  }

  /**
   * Store scheduled job metadata in Redis
   */
  private async storeScheduledJobMetadata(jobData: ScheduledJobData): Promise<void> {
    const key = `scheduled:metadata:${jobData.id}`
    await this.redisConnection.set(key, JSON.stringify(jobData))
  }

  /**
   * Get scheduled job metadata from Redis
   */
  private async getScheduledJobMetadata(scheduledJobId: string): Promise<ScheduledJobData | null> {
    try {
      const key = `scheduled:metadata:${scheduledJobId}`
      const data = await this.redisConnection.get(key)

      if (!data) {
        return null
      }

      const metadata = JSON.parse(data)

      // Convert date strings back to Date objects
      metadata.metadata.createdAt = new Date(metadata.metadata.createdAt)
      if (metadata.schedule.executeAt) {
        metadata.schedule.executeAt = new Date(metadata.schedule.executeAt)
      }
      if (metadata.schedule.endDate) {
        metadata.schedule.endDate = new Date(metadata.schedule.endDate)
      }

      return metadata
    } catch (error) {
      logger.error('Failed to get scheduled job metadata', {
        scheduledJobId,
        error: error.message,
      })
      return null
    }
  }

  /**
   * Update scheduled job status in Redis
   */
  private async updateScheduledJobStatus(
    scheduledJobId: string,
    status: ScheduledJobStatus
  ): Promise<void> {
    const key = `scheduled:status:${scheduledJobId}`
    await this.redisConnection.set(key, JSON.stringify(status))
  }

  /**
   * Delete scheduled job from Redis
   */
  private async deleteScheduledJob(scheduledJobId: string): Promise<void> {
    const metadataKey = `scheduled:metadata:${scheduledJobId}`
    const statusKey = `scheduled:status:${scheduledJobId}`

    await Promise.all([
      this.redisConnection.del(metadataKey),
      this.redisConnection.del(statusKey),
    ])

    // Stop and remove cron job if it exists
    const cronJob = this.scheduledJobs.get(scheduledJobId)
    if (cronJob) {
      cronJob.stop()
      this.scheduledJobs.delete(scheduledJobId)
    }
  }

  /**
   * Validate cron expression
   */
  private isValidCronExpression(expression: string): boolean {
    try {
      new CronJob(expression, () => { }, null, false)
      return true
    } catch {
      return false
    }
  }

  // Note: Redis connection event logging is already handled by CentralRedisManager
}

// Export singleton instance
export default new JobSchedulerService()