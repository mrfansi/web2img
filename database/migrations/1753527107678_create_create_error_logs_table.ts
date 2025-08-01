import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'error_logs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.enum('level', ['error', 'warn', 'fatal']).notNullable()
      table.text('message').notNullable()
      table.text('stack').nullable()
      table.text('context').nullable() // JSON string
      table.string('endpoint').nullable()
      table.string('method', 10).nullable()
      table.string('user_agent').nullable()
      table.string('ip_address', 45).nullable()
      table.string('correlation_id').nullable()
      table
        .integer('api_key_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('api_keys')
        .onDelete('SET NULL')
      table.timestamp('created_at', { useTz: true })

      // Indexes for performance
      table.index(['created_at'])
      table.index(['level'])
      table.index(['endpoint'])
      table.index(['correlation_id'])
      table.index(['api_key_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
