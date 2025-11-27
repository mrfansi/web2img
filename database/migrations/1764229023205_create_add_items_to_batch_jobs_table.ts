import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'batch_jobs'

  async up() {
    // Check if the items column already exists
    const hasItems = await this.schema.hasColumn(this.tableName, 'items')

    if (!hasItems) {
      this.schema.alterTable(this.tableName, (table) => {
        // Add items column to store the original batch items for scheduling
        table.json('items').nullable()
      })
    }
  }

  async down() {
    const hasItems = await this.schema.hasColumn(this.tableName, 'items')

    if (hasItems) {
      this.schema.alterTable(this.tableName, (table) => {
        table.dropColumn('items')
      })
    }
  }
}