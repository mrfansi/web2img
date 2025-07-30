import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'batch_jobs'

  async up() {
    // Check if columns already exist before adding them
    const hasNextScheduledTime = await this.schema.hasColumn(this.tableName, 'next_scheduled_time')
    const hasRecurrenceConfig = await this.schema.hasColumn(this.tableName, 'recurrence_config')
    const hasWebhookUrl = await this.schema.hasColumn(this.tableName, 'webhook_url')
    const hasWebhookAuth = await this.schema.hasColumn(this.tableName, 'webhook_auth')
    const hasProcessingStartedAt = await this.schema.hasColumn(this.tableName, 'processing_started_at')

    this.schema.alterTable(this.tableName, (table) => {
      // Add new columns for enhanced batch job functionality only if they don't exist
      if (!hasNextScheduledTime) {
        table.timestamp('next_scheduled_time').nullable()
      }
      if (!hasRecurrenceConfig) {
        table.json('recurrence_config').nullable()
      }
      if (!hasWebhookUrl) {
        table.string('webhook_url', 2048).nullable()
      }
      if (!hasWebhookAuth) {
        table.string('webhook_auth', 512).nullable()
      }
      if (!hasProcessingStartedAt) {
        table.timestamp('processing_started_at').nullable()
      }
    })

    // Add indexes for performance using schema builder to avoid conflicts
    this.schema.alterTable(this.tableName, (table) => {
      // Add composite index for status and scheduled_at if it doesn't exist
      try {
        table.index(['status', 'scheduled_at'], 'idx_batch_jobs_status_scheduled_composite')
      } catch (error) {
        console.log('Composite status-scheduled index already exists or failed to create')
      }
      
      // Add index for next_scheduled_time
      try {
        table.index(['next_scheduled_time'], 'idx_batch_jobs_next_scheduled_time')
      } catch (error) {
        console.log('Next scheduled time index already exists or failed to create')
      }
    })
  }

  async down() {
    // Drop indexes first
    this.schema.alterTable(this.tableName, (table) => {
      try {
        table.dropIndex(['status', 'scheduled_at'], 'idx_batch_jobs_status_scheduled_composite')
      } catch (error) {
        console.log('Composite status-scheduled index does not exist')
      }
      
      try {
        table.dropIndex(['next_scheduled_time'], 'idx_batch_jobs_next_scheduled_time')
      } catch (error) {
        console.log('Next scheduled time index does not exist')
      }
    })

    // Check if columns exist before dropping them
    const hasNextScheduledTime = await this.schema.hasColumn(this.tableName, 'next_scheduled_time')
    const hasRecurrenceConfig = await this.schema.hasColumn(this.tableName, 'recurrence_config')
    const hasWebhookUrl = await this.schema.hasColumn(this.tableName, 'webhook_url')
    const hasWebhookAuth = await this.schema.hasColumn(this.tableName, 'webhook_auth')
    const hasProcessingStartedAt = await this.schema.hasColumn(this.tableName, 'processing_started_at')

    this.schema.alterTable(this.tableName, (table) => {
      // Remove the added columns only if they exist
      if (hasNextScheduledTime) {
        table.dropColumn('next_scheduled_time')
      }
      if (hasRecurrenceConfig) {
        table.dropColumn('recurrence_config')
      }
      if (hasWebhookUrl) {
        table.dropColumn('webhook_url')
      }
      if (hasWebhookAuth) {
        table.dropColumn('webhook_auth')
      }
      if (hasProcessingStartedAt) {
        table.dropColumn('processing_started_at')
      }
    })
  }
}