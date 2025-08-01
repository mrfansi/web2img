import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import logger from '@adonisjs/core/services/logger'

export enum BatchJobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SCHEDULED = 'scheduled',
  CANCELLED = 'cancelled',
}

export interface RecurrenceConfig {
  pattern: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'
  interval?: number
  count?: number
  cron?: string
}

export interface BatchConfig {
  parallel?: number
  timeout?: number
  webhook_url?: string
  webhook_auth?: string
  fail_fast?: boolean
  cache?: boolean
  priority?: 'high' | 'normal' | 'low'
  scheduled_time?: string
  recurrence?: RecurrenceConfig
  rate_limit?: number
}

export interface BatchResult {
  itemId: string
  status: 'success' | 'error' | 'pending' | 'processing'
  url?: string
  error?: string
  cached?: boolean
  processingTime?: number
}

export default class BatchJob extends BaseModel {
  static table = 'batch_jobs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare status: BatchJobStatus

  @column({ columnName: 'total_items' })
  declare totalItems: number

  @column({ columnName: 'completed_items' })
  declare completedItems: number

  @column({ columnName: 'failed_items' })
  declare failedItems: number

  @column({
    prepare: (value: BatchConfig) => JSON.stringify(value || {}),
    consume: (value: string) => {
      if (!value || typeof value !== 'string') return {}

      try {
        const parsed = JSON.parse(value)
        return typeof parsed === 'object' && parsed !== null ? parsed : {}
      } catch (error) {
        logger.warn('Failed to parse batch job config from database', {
          value: typeof value === 'string' ? value.substring(0, 100) : String(value),
          valueType: typeof value,
          error: error.message
        })
        return {}
      }
    },
  })
  declare config: BatchConfig

  @column({
    prepare: (value: BatchResult[]) => JSON.stringify(value || []),
    consume: (value: any) => {
      // Handle null/undefined
      if (!value) return []

      // If it's already an array (parsed by database), return it
      if (Array.isArray(value)) return value

      // If it's an object but not an array, wrap it or return empty
      if (typeof value === 'object') {
        return Array.isArray(value) ? value : []
      }

      // If it's a string, try to parse it
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value)
          return Array.isArray(parsed) ? parsed : []
        } catch (error) {
          logger.warn('Failed to parse batch job results from database', {
            value: value.substring(0, 100),
            valueType: typeof value,
            error: error.message
          })
          return []
        }
      }

      // For any other type, return empty array
      logger.warn('Unexpected value type for batch job results', {
        valueType: typeof value,
        value: String(value).substring(0, 100)
      })
      return []
    },
  })
  declare results: BatchResult[]

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column.dateTime({ columnName: 'scheduled_at' })
  declare scheduledAt: DateTime | null

  @column.dateTime({ columnName: 'completed_at' })
  declare completedAt: DateTime | null

  @column.dateTime({ columnName: 'next_scheduled_time' })
  declare nextScheduledTime: DateTime | null

  @column({
    columnName: 'recurrence_config',
    prepare: (value: RecurrenceConfig) => value ? JSON.stringify(value) : null,
    consume: (value: string) => {
      if (!value || typeof value !== 'string') return null

      try {
        const parsed = JSON.parse(value)
        return typeof parsed === 'object' && parsed !== null ? parsed : null
      } catch (error) {
        logger.warn('Failed to parse batch job recurrence config from database', {
          value: typeof value === 'string' ? value.substring(0, 100) : String(value),
          valueType: typeof value,
          error: error.message
        })
        return null
      }
    },
  })
  declare recurrenceConfig: RecurrenceConfig | null

  @column({ columnName: 'webhook_url' })
  declare webhookUrl: string | null

  @column({ columnName: 'webhook_auth' })
  declare webhookAuth: string | null

  @column.dateTime({ columnName: 'processing_started_at' })
  declare processingStartedAt: DateTime | null

  /**
   * Get all active batch jobs (processing or scheduled)
   */
  static async getActiveJobs(): Promise<BatchJob[]> {
    return await BatchJob.query()
      .whereIn('status', [BatchJobStatus.PROCESSING, BatchJobStatus.SCHEDULED])
      .orderBy('created_at', 'desc')
  }

  /**
   * Create a new batch job
   */
  static async createBatchJob(
    totalItems: number,
    config: BatchConfig = {},
    scheduledAt?: DateTime
  ): Promise<BatchJob> {
    const batchJob = await BatchJob.create({
      status: scheduledAt ? BatchJobStatus.SCHEDULED : BatchJobStatus.PENDING,
      totalItems: totalItems,
      completedItems: 0,
      failedItems: 0,
      config: config,
      results: [],
      scheduledAt: scheduledAt || null,
    })

    return batchJob
  }

  /**
   * Schedule the batch job for future execution
   */
  async scheduleJob(scheduledTime: DateTime): Promise<void> {
    if (this.status === BatchJobStatus.COMPLETED || this.status === BatchJobStatus.PROCESSING) {
      throw new Error('Cannot schedule a job that is already completed or processing')
    }

    this.status = BatchJobStatus.SCHEDULED
    this.scheduledAt = scheduledTime
    await this.save()
  }

  /**
   * Set recurrence configuration for the batch job
   */
  async setRecurrence(recurrenceConfig: RecurrenceConfig): Promise<void> {
    this.recurrenceConfig = recurrenceConfig
    this.nextScheduledTime = this.calculateNextExecution(recurrenceConfig)
    await this.save()
  }

  /**
   * Calculate next execution time based on recurrence config
   */
  private calculateNextExecution(config: RecurrenceConfig): DateTime | null {
    if (!this.scheduledAt) return null

    const baseTime = this.scheduledAt
    const interval = config.interval || 1

    switch (config.pattern) {
      case 'hourly':
        return baseTime.plus({ hours: interval })
      case 'daily':
        return baseTime.plus({ days: interval })
      case 'weekly':
        return baseTime.plus({ weeks: interval })
      case 'monthly':
        return baseTime.plus({ months: interval })
      case 'custom':
        // For custom cron expressions, we would need a cron parser
        // For now, return null as this requires additional implementation
        return null
      default:
        return null
    }
  }

  /**
   * Start processing the batch job
   */
  async startProcessing(): Promise<void> {
    this.status = BatchJobStatus.PROCESSING
    this.processingStartedAt = DateTime.now()
    await this.save()
  }

  /**
   * Mark the batch job as completed
   */
  async markCompleted(): Promise<void> {
    this.status = BatchJobStatus.COMPLETED
    this.completedAt = DateTime.now()
    await this.save()
  }

  /**
   * Mark the batch job as failed
   */
  async markFailed(): Promise<void> {
    this.status = BatchJobStatus.FAILED
    this.completedAt = DateTime.now()
    await this.save()
  }

  /**
   * Cancel the batch job
   */
  async cancelJob(): Promise<void> {
    if (this.status === BatchJobStatus.COMPLETED || this.status === BatchJobStatus.FAILED) {
      throw new Error('Cannot cancel a job that is already completed or failed')
    }

    this.status = BatchJobStatus.CANCELLED
    this.completedAt = DateTime.now()
    await this.save()
  }

  /**
   * Cancel the batch job (alias for backward compatibility)
   */
  async cancel(): Promise<void> {
    await this.cancelJob()
  }

  /**
   * Update progress of the batch job
   */
  async updateProgress(completedItems: number, failedItems: number): Promise<void> {
    this.completedItems = completedItems
    this.failedItems = failedItems
    await this.save()
  }

  /**
   * Add a result to the batch job
   */
  async addResult(result: BatchResult): Promise<void> {
    const currentResults = this.results || []
    this.results = [...currentResults, result]
    await this.save()
  }

  /**
   * Update a specific result in the batch job
   */
  async updateResult(itemId: string, updates: Partial<BatchResult>): Promise<void> {
    const currentResults = this.results || []
    this.results = currentResults.map((result) =>
      result.itemId === itemId ? { ...result, ...updates } : result
    )
    await this.save()
  }

  /**
   * Get the progress percentage
   */
  get progressPercentage(): number {
    if (this.totalItems === 0) return 0
    return Math.round(((this.completedItems + this.failedItems) / this.totalItems) * 100)
  }

  /**
   * Check if the batch job is completed (either successfully or with failures)
   */
  get isCompleted(): boolean {
    return this.status === BatchJobStatus.COMPLETED || this.status === BatchJobStatus.FAILED
  }

  /**
   * Check if the batch job is in progress
   */
  get isProcessing(): boolean {
    return this.status === BatchJobStatus.PROCESSING
  }

  /**
   * Check if the batch job is scheduled
   */
  get isScheduled(): boolean {
    return this.status === BatchJobStatus.SCHEDULED
  }

  /**
   * Check if the batch job is pending
   */
  get isPending(): boolean {
    return this.status === BatchJobStatus.PENDING
  }

  /**
   * Get successful results
   */
  get successfulResults(): BatchResult[] {
    return (this.results || []).filter((result) => result.status === 'success')
  }

  /**
   * Get failed results
   */
  get failedResults(): BatchResult[] {
    return (this.results || []).filter((result) => result.status === 'error')
  }

  /**
   * Get successful results (method version for API endpoints)
   */
  getSuccessfulResults(): BatchResult[] {
    return this.successfulResults
  }

  /**
   * Get failed results (method version for API endpoints)
   */
  getFailedResults(): BatchResult[] {
    return this.failedResults
  }

  /**
   * Get the estimated completion time based on current progress
   */
  get estimatedCompletion(): DateTime | null {
    if (!this.isProcessing) return null

    const startTime = this.processingStartedAt || this.createdAt
    const elapsedTime = DateTime.now().diff(startTime).as('milliseconds')
    const processedItems = this.completedItems + this.failedItems

    if (processedItems === 0) return null

    const averageTimePerItem = elapsedTime / processedItems
    const remainingItems = this.totalItems - processedItems
    const estimatedRemainingTime = averageTimePerItem * remainingItems

    return DateTime.now().plus({ milliseconds: estimatedRemainingTime })
  }

  /**
   * Get the next scheduled time for recurring jobs
   */
  getNextScheduledTime(): DateTime | null {
    // Return the stored next scheduled time if available
    if (this.nextScheduledTime) {
      return this.nextScheduledTime
    }

    // Calculate next scheduled time if recurrence config exists
    if (!this.recurrenceConfig || !this.scheduledAt) return null

    return this.calculateNextExecution(this.recurrenceConfig)
  }
}
