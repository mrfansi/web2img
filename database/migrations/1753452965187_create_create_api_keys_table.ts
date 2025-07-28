import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'api_keys'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').notNullable()
      table.string('key', 64).notNullable().unique()
      table.string('name').notNullable()
      table.integer('user_id').unsigned().notNullable()
      table.integer('rate_limit').defaultTo(1000)
      table.boolean('is_active').defaultTo(true)

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      // Foreign key constraint
      table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE')

      // Index for performance
      table.index(['key'])
      table.index(['user_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
