import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export enum BatchJobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SCHEDULED = 'scheduled',
  CANCELLED = 'cancelled'
}

export interface BatchConfig {
  parallel?: number
  timeout?: number
  webhook?: string
  webhook_auth?: string
  fail_fast?: boolean
  cache?: boolean
  priority?: 'high' | 'normal' | 'low'
  scheduled_time?: string
  recurrence?: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'
  recurrence_interval?: number
  recurrence_count?: number
  recurrence_cron?: string
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

  @column()
  declare totalItems: number

  @column()
  declare completedItems: number

  @column()
  declare failedItems: number

  @column({
    prepare: (value: BatchConfig) => JSON.stringify(value),
    consume: (value: string) => JSON.parse(value)
  })
  declare config: BatchConfig

  @column({
    prepare: (value: BatchResult[]) => JSON.stringify(value),
    consume: (value: string) => JSON.parse(value)
  })
  declare results: BatchResult[]

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @column.dateTime()
  declare scheduledAt: DateTime | null

  @column.dateTime()
  declare completedAt: DateTime | null

  /**
   * Create a new batch job
   */
  static async createBatchJob(
    totalItems: number,
    config: BatchConfig = {},
    scheduledAt?: DateTime
  ): Promise<BatchJob> {
    const batchJob = new BatchJob()
    batchJob.status = scheduledAt ? BatchJobStatus.SCHEDULED : BatchJobStatus.PENDING
    batchJob.totalItems = totalItems
    batchJob.completedItems = 0
    batchJob.failedItems = 0
    batchJob.config = config
    batchJob.results = []
    batchJob.scheduledAt = scheduledAt || null
    
    await batchJob.save()
    return batchJob
  }

  /**
   * Start processing the batch job
   */
  async startProcessing(): Promise<void> {
    this.status = BatchJobStatus.PROCESSING
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
  async cancel(): Promise<void> {
    this.status = BatchJobStatus.CANCELLED
    await this.save()
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
    this.results = [...this.results, result]
    await this.save()
  }

  /**
   * Update a specific result in the batch job
   */
  async updateResult(itemId: string, updates: Partial<BatchResult>): Promise<void> {
    this.results = this.results.map(result => 
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
    return this.results.filter(result => result.status === 'success')
  }

  /**
   * Get failed results
   */
  get failedResults(): BatchResult[] {
    return this.results.filter(result => result.status === 'error')
  }

  /**
   * Get the estimated completion time based on current progress
   */
  get estimatedCompletion(): DateTime | null {
    if (!this.isProcessing || this.completedItems === 0) return null
    
    const elapsedTime = DateTime.now().diff(this.createdAt).as('milliseconds')
    const averageTimePerItem = elapsedTime / (this.completedItems + this.failedItems)
    const remainingItems = this.totalItems - this.completedItems - this.failedItems
    const estimatedRemainingTime = averageTimePerItem * remainingItems
    
    return DateTime.now().plus({ milliseconds: estimatedRemainingTime })
  }
}