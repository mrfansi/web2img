import { test } from '@japa/runner'
import { RedisService } from '#services/redis_service'
import { getCentralRedisManager } from '#services/central_redis_manager'

test.group('RedisService', (group) => {
  let redisService: RedisService

  group.setup(() => {
    redisService = RedisService.getInstance()
  })

  group.teardown(async () => {
    redisService.stopHealthMonitoring()
    await redisService.shutdown()
  })

  test('should create singleton instance', ({ assert }) => {
    const instance1 = RedisService.getInstance()
    const instance2 = RedisService.getInstance()

    assert.strictEqual(instance1, instance2)
  })

  test('should initialize successfully', async ({ assert }) => {
    await assert.doesNotReject(() => redisService.initialize())
  })

  test('should perform health check', async ({ assert }) => {
    const isHealthy = await redisService.healthCheck()
    assert.isTrue(isHealthy)
    assert.isTrue(redisService.isConnectionHealthy())
  })

  test('should get connection info', async ({ assert }) => {
    const info = await redisService.getConnectionInfo()

    assert.properties(info, [
      'status',
      'uptime',
      'connectedClients',
      'usedMemory',
      'totalSystemMemory'
    ])

    assert.equal(info.status, 'connected')
    assert.isNumber(info.uptime)
    assert.isNumber(info.connectedClients)
    assert.isString(info.usedMemory)
    assert.isString(info.totalSystemMemory)
  })

  test('should get Redis client instance', ({ assert }) => {
    const client = redisService.getClient()
    const centralRedisClient = getCentralRedisManager().getClient()
    assert.strictEqual(client, centralRedisClient)
  })

  test('should execute Redis commands with error handling', async ({ assert }) => {
    const redisClient = getCentralRedisManager().getClient()
    const result = await redisService.executeCommand(
      async () => {
        await redisClient.set('test:key', 'test-value')
        return await redisClient.get('test:key')
      },
      'test operation'
    )

    assert.equal(result, 'test-value')

    // Cleanup
    await redisClient.del('test:key')
  })

  test('should handle Redis operation errors', async ({ assert }) => {
    await assert.rejects(
      () => redisService.executeCommand(
        async () => {
          throw new Error('Redis operation failed')
        },
        'failing operation'
      ),
      'Redis operation failed: failing operation'
    )
  })

  test('should stop health monitoring', ({ assert }) => {
    redisService.stopHealthMonitoring()
    // Test passes if no errors are thrown
    assert.isTrue(true)
  })
})

test.group('RedisService - Connection Errors', (group) => {
  group.setup(() => {
    RedisService.getInstance()
  })

  test('should handle connection errors gracefully', async ({ assert }) => {
    const testService = RedisService.getInstance()
    const redisClient = getCentralRedisManager().getClient()

    // Mock the ping method to simulate connection error
    const originalPing = redisClient.ping
    redisClient.ping = async () => {
      throw new Error('ECONNREFUSED')
    }

    try {
      const isHealthy = await testService.healthCheck()
      assert.isFalse(isHealthy)
      assert.isFalse(testService.isConnectionHealthy())
    } finally {
      // Restore original method
      redisClient.ping = originalPing
    }
  })
})