import { assert } from '@japa/assert'
import { apiClient } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import type { Config } from '@japa/runner/types'
import { pluginAdonisJS } from '@japa/plugin-adonisjs'
import testUtils from '@adonisjs/core/services/test_utils'
import redisService from '#services/redis_service'
import { getCentralRedisManager, CentralRedisManager } from '#services/central_redis_manager'

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
      // Initialize Redis service for tests
      try {
        await redisService.initialize()
      } catch (error) {
        console.warn('Redis service initialization failed in tests:', error)
      }
    },
  ],
  teardown: [
    async () => {
      // Give time for any pending operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100))

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
  if (['browser', 'functional', 'e2e'].includes(suite.name)) {
    return suite.setup(() => testUtils.httpServer().start())
  }
}
