import { assert } from '@japa/assert'
import { apiClient } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import type { Config } from '@japa/runner/types'
import { pluginAdonisJS } from '@japa/plugin-adonisjs'
import testUtils from '@adonisjs/core/services/test_utils'
import redisService from '#services/redis_service'
import { getCentralRedisManager, CentralRedisManager } from '#services/central_redis_manager'
import db from '@adonisjs/lucid/services/db'

/**
 * This file is imported by the "bin/test.ts" entrypoint file
 */

// Global handler for unhandled promise rejections during tests
process.on('unhandledRejection', (reason, _promise) => {
  if (reason && typeof reason === 'object' && 'message' in reason) {
    const message = (reason as any).message
    if (message.includes('Connection is closed')) {
      // Silently ignore Redis connection closed errors during tests
      return
    }
  }
  console.warn('Unhandled promise rejection during tests:', reason)
})

/**
 * Configure Japa plugins in the plugins array.
 * Learn more - https://japa.dev/docs/runner-config#plugins-optional
 */
export const plugins: Config['plugins'] = [assert(), apiClient(), pluginAdonisJS(app)]

/**
 * Configure lifecycle function to run before and after all the
 * tests.
 *
 * The setup functions are executed before all the tests
 * The teardown functions are executed after all the tests
 */
export const runnerHooks: Required<Pick<Config, 'setup' | 'teardown'>> = {
  setup: [
    async () => {
      // Create database tables for tests (since we're using :memory: database)
      try {
        // Create batch_jobs table with the exact schema from migrations
        const hasBatchJobsTable = await db.connection().schema.hasTable('batch_jobs')
        if (!hasBatchJobsTable) {
          await db.connection().schema.createTable('batch_jobs', (table) => {
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
            table.timestamp('next_scheduled_time').nullable()
            table.json('recurrence_config').nullable()
            table.string('webhook_url', 2048).nullable()
            table.string('webhook_auth', 512).nullable()
            table.timestamp('processing_started_at').nullable()

            // Indexes
            table.index(['status'])
            table.index(['created_at'])
            table.index(['scheduled_at'])
          })
        }

        // Create other required tables
        const hasUsersTable = await db.connection().schema.hasTable('users')
        if (!hasUsersTable) {
          await db.connection().schema.createTable('users', (table) => {
            table.increments('id').notNullable()
            table.string('email').notNullable().unique()
            table.string('password').notNullable()
            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
          })
        }

        const hasApiKeysTable = await db.connection().schema.hasTable('api_keys')
        if (!hasApiKeysTable) {
          await db.connection().schema.createTable('api_keys', (table) => {
            table.increments('id').notNullable()
            table.string('key').notNullable().unique()
            table.string('name').notNullable()
            table.integer('user_id').notNullable()
            table.integer('rate_limit').notNullable().defaultTo(1000)
            table.boolean('is_active').notNullable().defaultTo(true)
            table.timestamp('created_at').notNullable()
            table.timestamp('updated_at').nullable()
          })
        }

        const hasApiKeyUsageTable = await db.connection().schema.hasTable('api_key_usage')
        if (!hasApiKeyUsageTable) {
          await db.connection().schema.createTable('api_key_usage', (table) => {
            table.increments('id').notNullable()
            table.integer('api_key_id').notNullable()
            table.string('endpoint').notNullable()
            table.string('method').notNullable()
            table.integer('status_code').notNullable()
            table.integer('response_time').notNullable()
            table.string('user_agent').nullable()
            table.string('ip_address').notNullable()
            table.timestamp('created_at').notNullable()
          })
        }

        const hasErrorLogsTable = await db.connection().schema.hasTable('error_logs')
        if (!hasErrorLogsTable) {
          await db.connection().schema.createTable('error_logs', (table) => {
            table.increments('id').notNullable()
            table.string('level').notNullable()
            table.text('message').notNullable()
            table.text('stack').nullable()
            table.text('context').nullable()
            table.string('endpoint').nullable()
            table.string('method').nullable()
            table.string('user_agent').nullable()
            table.timestamp('created_at').notNullable()
          })
        }
      } catch (error) {
        console.warn('Database table creation failed in tests:', error)
      }

      // Initialize Redis service for tests (optional)
      try {
        await redisService.initialize()
        console.log('Redis service initialized successfully for tests')
      } catch (error) {
        console.warn('Redis service initialization failed in tests, continuing without Redis:', error.message)
        // Don't throw error - tests should be able to run without Redis
      }
    },
  ],
  teardown: [
    async () => {
      // Give time for any pending operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Close database connections
      try {
        await db.manager.closeAll()
      } catch (error) {
        console.warn('Database cleanup failed in tests:', error)
      }

      // Register CentralRedisManager shutdown before other services
      try {
        const redisManager = getCentralRedisManager()
        await redisManager.shutdown()
      } catch (error) {
        console.warn('CentralRedisManager shutdown failed in tests:', error)
      }

      // Cleanup other services after Redis shutdown
      try {
        await redisService.shutdown()
      } catch (error) {
        console.warn('Redis service cleanup failed in tests:', error)
      }

      // Force close any remaining connections
      try {
        await CentralRedisManager.forceReset()
      } catch (error) {
        console.warn('Force reset failed in tests:', error)
      }

      // Additional cleanup time
      await new Promise((resolve) => setTimeout(resolve, 100))
    },
  ],
}

/**
 * Configure suites by tapping into the test suite instance.
 * Learn more - https://japa.dev/docs/test-suites#lifecycle-hooks
 */
export const configureSuite: Config['configureSuite'] = (suite) => {
  if (['browser', 'functional', 'e2e', 'integration', 'performance'].includes(suite.name)) {
    return suite.setup(() => testUtils.httpServer().start())
  }

  // Set up database cleanup for unit tests
  if (suite.name === 'unit') {
    return suite.setup(async () => {
      // Clean up database tables before each test suite
      try {
        // Delete in reverse order to avoid foreign key constraints
        await db.from('api_key_usage').del()
        await db.from('error_logs').del()
        await db.from('batch_jobs').del()
        await db.from('api_keys').del()
        await db.from('users').del()
      } catch (error) {
        console.warn('Database cleanup failed:', error)
      }
    }).teardown(async () => {
      // Clean up database tables after each test suite
      try {
        // Delete in reverse order to avoid foreign key constraints
        await db.from('api_key_usage').del()
        await db.from('error_logs').del()
        await db.from('batch_jobs').del()
        await db.from('api_keys').del()
        await db.from('users').del()
      } catch (error) {
        console.warn('Database cleanup failed:', error)
      }
    })
  }
}
