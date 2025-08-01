import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'api_key_usage'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table
        .integer('api_key_id')
        .unsigned()
        .references('id')
        .inTable('api_keys')
        .onDelete('CASCADE')
      table.string('endpoint').notNullable()
      table.string('method', 10).notNullable()
      table.integer('status_code').notNullable()
      table.integer('response_time').notNullable() // in milliseconds
      table.string('user_agent').nullable()
      table.string('ip_address', 45).notNullable() // supports IPv6
      table.timestamp('created_at', { useTz: true })

      // Indexes for performance
      table.index(['api_key_id', 'created_at'])
      table.index(['created_at'])
      table.index(['endpoint'])
      table.index(['status_code'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
