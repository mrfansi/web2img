import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'batch_jobs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('status').notNullable().defaultTo('pending')
      table.integer('total_items').notNullable().defaultTo(0)
      table.integer('completed_items').notNullable().defaultTo(0)
      table.integer('failed_items').notNullable().defaultTo(0)
      table.json('config').nullable()
      table.json('results').nullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()
      table.timestamp('scheduled_at').nullable()
      table.timestamp('completed_at').nullable()

      // Indexes for performance
      table.index(['status'])
      table.index(['created_at'])
      table.index(['scheduled_at'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
