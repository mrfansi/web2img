import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import db from '@adonisjs/lucid/services/db'

export default class FixJsonData extends BaseCommand {
  static commandName = 'fix:json-data'
  static description = 'Fix corrupted JSON data in the database'

  static options: CommandOptions = {
    startApp: true,
  }

  async run() {
    this.logger.info('🔧 Starting JSON data cleanup...')

    try {
      // Check for corrupted data first
      const corruptedResults = await db.rawQuery(`
        SELECT id, results, config, recurrence_config 
        FROM batch_jobs 
        WHERE (
          (results IS NOT NULL AND results != '' AND results != 'null' AND (
            results = '[object Object]' 
            OR results LIKE '%[object Object]%'
            OR (results NOT LIKE '[%' AND results NOT LIKE '{%')
          ))
          OR (config IS NOT NULL AND config != '' AND config != 'null' AND (
            config = '[object Object]' 
            OR config LIKE '%[object Object]%'
            OR (config NOT LIKE '[%' AND config NOT LIKE '{%')
          ))
          OR (recurrence_config IS NOT NULL AND recurrence_config != '' AND recurrence_config != 'null' AND (
            recurrence_config = '[object Object]' 
            OR recurrence_config LIKE '%[object Object]%'
            OR (recurrence_config NOT LIKE '[%' AND recurrence_config NOT LIKE '{%')
          ))
        )
      `)

      const corruptedCount = corruptedResults.rows?.length || 0
      
      if (corruptedCount === 0) {
        this.logger.success('✅ No corrupted JSON data found!')
        return
      }

      this.logger.info(`📊 Found ${corruptedCount} records with corrupted JSON data`)

      // Fix corrupted results column
      const resultsFixed = await db.rawQuery(`
        UPDATE batch_jobs 
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
      const configFixed = await db.rawQuery(`
        UPDATE batch_jobs 
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
      const recurrenceFixed = await db.rawQuery(`
        UPDATE batch_jobs 
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

      this.logger.success('✅ JSON data cleanup completed!')
      this.logger.info(`📈 Results fixed: ${resultsFixed.rowCount || 0} records`)
      this.logger.info(`📈 Config fixed: ${configFixed.rowCount || 0} records`)
      this.logger.info(`📈 Recurrence config fixed: ${recurrenceFixed.rowCount || 0} records`)

    } catch (error) {
      this.logger.error('❌ Failed to fix JSON data:', error.message)
      this.exitCode = 1
    }
  }
}
