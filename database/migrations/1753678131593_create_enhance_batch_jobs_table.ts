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

    // Add indexes for performance (check if they exist first)
    const hasStatusScheduledIndex = await this.schema.raw(`
      SELECT COUNT(*) as count FROM information_schema.statistics 
      WHERE table_schema = DATABASE() 
      AND table_name = 'batch_jobs' 
      AND index_name = 'idx_batch_jobs_status_scheduled'
    `)

    const hasNextScheduledIndex = await this.schema.raw(`
      SELECT COUNT(*) as count FROM information_schema.statistics 
      WHERE table_schema = DATABASE() 
      AND table_name = 'batch_jobs' 
      AND index_name = 'idx_batch_jobs_next_scheduled'
    `)

    if (hasStatusScheduledIndex[0][0].count === 0) {
      await this.schema.raw('CREATE INDEX idx_batch_jobs_status_scheduled ON batch_jobs(status, scheduled_at)')
    }

    if (hasNextScheduledIndex[0][0].count === 0) {
      await this.schema.raw('CREATE INDEX idx_batch_jobs_next_scheduled ON batch_jobs(next_scheduled_time)')
    }
  }

  async down() {
    // Drop indexes first (check if they exist)
    try {
      await this.schema.raw('DROP INDEX idx_batch_jobs_status_scheduled ON batch_jobs')
    } catch (error) {
      // Index doesn't exist, ignore error
    }

    try {
      await this.schema.raw('DROP INDEX idx_batch_jobs_next_scheduled ON batch_jobs')
    } catch (error) {
      // Index doesn't exist, ignore error
    }

    this.schema.alterTable(this.tableName, (table) => {
      // Remove the added columns
      table.dropColumn('next_scheduled_time')
      table.dropColumn('recurrence_config')
      table.dropColumn('webhook_url')
      table.dropColumn('webhook_auth')
      table.dropColumn('processing_started_at')
    })
  }
}