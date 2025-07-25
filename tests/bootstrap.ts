import { assert } from '@japa/assert'
import { apiClient } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import type { Config } from '@japa/runner/types'
import { pluginAdonisJS } from '@japa/plugin-adonisjs'
import testUtils from '@adonisjs/core/services/test_utils'
import redisService from '#services/redis_service'

/**
 * This file is imported by the "bin/test.ts" entrypoint file
 */

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
      // Initialize Redis service for tests
      try {
        await redisService.initialize()
      } catch (error) {
        console.warn('Redis service initialization failed in tests:', error)
      }
    }
  ],
  teardown: [
    async () => {
      // Cleanup Redis service after tests
      try {
        await redisService.shutdown()
        
        // Also ensure the main Redis connection is properly closed
        const redis = await import('@adonisjs/redis/services/main')
        await redis.default.quit()
      } catch (error) {
        console.warn('Redis cleanup failed in tests:', error)
        
        // Force disconnect if graceful shutdown fails
        try {
          const redis = await import('@adonisjs/redis/services/main')
          await redis.default.disconnect()
        } catch (disconnectError) {
          console.warn('Redis force disconnect failed:', disconnectError)
        }
      }
      
      // Force exit after cleanup to prevent hanging
      setTimeout(() => {
        process.exit(0)
      }, 500)
    }
  ],
}

/**
 * Configure suites by tapping into the test suite instance.
 * Learn more - https://japa.dev/docs/test-suites#lifecycle-hooks
 */
export const configureSuite: Config['configureSuite'] = (suite) => {
  if (['browser', 'functional', 'e2e'].includes(suite.name)) {
    return suite.setup(() => testUtils.httpServer().start())
  }
}
