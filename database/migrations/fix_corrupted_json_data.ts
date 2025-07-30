import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'batch_jobs'

  /**
   * Fix corrupted JSON data in batch_jobs table
   */
  public async up() {
    // Fix corrupted results column
    await this.db.rawQuery(`
      UPDATE ${this.tableName} 
      SET results = '[]' 
      WHERE results IS NOT NULL 
      AND results != '' 
      AND results != 'null'
      AND (
        results = '[object Object]' 
        OR results LIKE '%[object Object]%'
        OR (results NOT LIKE '[%' AND results NOT LIKE '{%')
      )
    `)

    // Fix corrupted config column
    await this.db.rawQuery(`
      UPDATE ${this.tableName} 
      SET config = '{}' 
      WHERE config IS NOT NULL 
      AND config != '' 
      AND config != 'null'
      AND (
        config = '[object Object]' 
        OR config LIKE '%[object Object]%'
        OR (config NOT LIKE '[%' AND config NOT LIKE '{%')
      )
    `)

    // Fix corrupted recurrence_config column
    await this.db.rawQuery(`
      UPDATE ${this.tableName} 
      SET recurrence_config = NULL 
      WHERE recurrence_config IS NOT NULL 
      AND recurrence_config != '' 
      AND recurrence_config != 'null'
      AND (
        recurrence_config = '[object Object]' 
        OR recurrence_config LIKE '%[object Object]%'
        OR (recurrence_config NOT LIKE '[%' AND recurrence_config NOT LIKE '{%')
      )
    `)

    console.log('✅ Fixed corrupted JSON data in batch_jobs table')
  }

  /**
   * Reverse the migration (not applicable for data cleanup)
   */
  public async down() {
    // Cannot reverse data cleanup
    console.log('⚠️  Cannot reverse JSON data cleanup migration')
  }
}
