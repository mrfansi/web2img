import { getCentralRedisManager } from '#services/central_redis_manager'

/**
 * Adds Redis connection leak detection to a test group
 * This should be called in each test group teardown that uses Redis connections
 * 
 * Usage:
 * ```typescript
 * test.group('My Tests', (group) => {
 *   group.teardown(async () => {
 *     await addRedisLeakDetection()
 *   })
 * })
 * ```
 */
export async function addRedisLeakDetection(assert?: any): Promise<void> {
  const redisManager = getCentralRedisManager()
  const openConnectionsCount = redisManager.getOpenConnectionsCount()

  if (openConnectionsCount > 0) {
    const connectionInfo = redisManager.getOpenConnectionsInfo()
    console.warn(`Redis connection leak detected! ${openConnectionsCount} connections still open:`, connectionInfo)

    // Force cleanup of leaked connections to prevent affecting other tests
    await redisManager.shutdown()

    // If assert is provided, fail the test
    if (assert) {
      assert.equal(
        0,
        openConnectionsCount,
        `Redis connection leak detected: ${openConnectionsCount} connections were not properly closed. This indicates a resource leak that could cause issues in production.`
      )
    } else {
      throw new Error(`Redis connection leak detected: ${openConnectionsCount} connections were not properly closed.`)
    }
  }
}

/**
 * Helper function to clean up Redis connections after tests
 * Use this in group teardown when you know you've created connections that should be cleaned up
 */
export async function cleanupRedisConnections(): Promise<void> {
  const redisManager = getCentralRedisManager()
  const openConnectionsCount = redisManager.getOpenConnectionsCount()

  if (openConnectionsCount > 0) {
    console.log(`Cleaning up ${openConnectionsCount} Redis connections`)
    await redisManager.shutdown()
  }
}

/**
 * Get current Redis connection count for debugging
 */
export function getRedisConnectionCount(): number {
  const redisManager = getCentralRedisManager()
  return redisManager.getOpenConnectionsCount()
}

/**
 * Get detailed Redis connection info for debugging
 */
export function getRedisConnectionInfo(): Array<{ status: string }> {
  const redisManager = getCentralRedisManager()
  return redisManager.getOpenConnectionsInfo()
}
