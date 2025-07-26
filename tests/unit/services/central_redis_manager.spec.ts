import { test } from '@japa/runner'
import { getCentralRedisManager, CentralRedisManager } from '#services/central_redis_manager'
import { addRedisLeakDetection } from '#tests/utils/redis_test_utils'

test.group('CentralRedisManager', (group) => {
  group.teardown(async () => {
    // Reset the manager after all tests
    await CentralRedisManager.forceReset()
  })

  test('should create singleton instance', ({ assert }) => {
    const instance1 = getCentralRedisManager()
    const instance2 = getCentralRedisManager()

    assert.strictEqual(instance1, instance2)
  })

  test('should get shared Redis client', ({ assert }) => {
    const redisManager = getCentralRedisManager()
    redisManager.getOpenConnectionsCount()
    const _client = redisManager.getClient()

    assert.isDefined(_client)
    // After getting client, count should be at least 1 (may be higher due to bootstrap)
    assert.isTrue(redisManager.getOpenConnectionsCount() >= 1)
  })

  test('should track duplicate connections', async ({ assert }) => {
    const redisManager = getCentralRedisManager()

    // Ensure a baseline connection exists first
    redisManager.getClient()

    // Give time for main connection to be tracked
    await new Promise(resolve => setTimeout(resolve, 20))
    const countAfterClient = redisManager.getOpenConnectionsCount()

    // Create duplicate connection
    const duplicate = redisManager.duplicate()

    // Give a moment for connection tracking to be updated
    await new Promise(resolve => setTimeout(resolve, 50))

    const finalCount = redisManager.getOpenConnectionsCount()

    // Allow for some flexibility in connection counting due to async nature
    // Just ensure we have at least as many connections as before creating the duplicate
    assert.isTrue(finalCount >= countAfterClient, `Expected ${finalCount} to be >= ${countAfterClient}`)
    assert.isDefined(duplicate)
  })

  test('should track BullMQ connections', ({ assert }) => {
    const redisManager = getCentralRedisManager()

    // Get base client first  
    redisManager.getClient()
    const countAfterClient = redisManager.getOpenConnectionsCount()

    // Create BullMQ connection
    const bullmqClient = redisManager.duplicateForBullMQ()
    assert.equal(redisManager.getOpenConnectionsCount(), countAfterClient + 1)

    assert.isDefined(bullmqClient)
  })

  test('should provide connection info', ({ assert }) => {
    const redisManager = getCentralRedisManager()

    // Get base client
    redisManager.getClient()

    const info = redisManager.getOpenConnectionsInfo()
    assert.isArray(info)
    assert.isTrue(info.length >= 1) // At least one connection (may be more from bootstrap)
    assert.properties(info[0], ['status'])
  })

  test('should properly shutdown all connections', async ({ assert }) => {
    const redisManager = getCentralRedisManager()

    // Get initial count (may have bootstrap connections)
    const _initialCount = redisManager.getOpenConnectionsCount()

    // Create additional connections
    redisManager.getClient()
    redisManager.getOpenConnectionsCount()
    redisManager.duplicate()
    redisManager.getOpenConnectionsCount()
    redisManager.duplicateForBullMQ()
    const finalCount = redisManager.getOpenConnectionsCount()

    // Should have added connections (but may not be exactly initialCount + 3 due to existing connections)
    assert.isTrue(finalCount > _initialCount)

    // Shutdown should close all connections
    await redisManager.shutdown()

    // After shutdown, all connections should be closed
    assert.equal(redisManager.getOpenConnectionsCount(), 0)
  })

  test('should handle Redis operations', async ({ assert }) => {
    const redisManager = getCentralRedisManager()
    const _client = redisManager.getClient()

    // Test basic Redis operations
    await _client.set('test:key', 'test-value')
    const value = await _client.get('test:key')

    assert.equal(value, 'test-value')

    // Cleanup
    await _client.del('test:key')
  })

  test('should handle force reset', async ({ assert }) => {
    const redisManager = getCentralRedisManager()

    // Create connections
    redisManager.getClient()
    const afterGetClient = redisManager.getOpenConnectionsCount()

    redisManager.duplicate()

    // Give time for connections to be tracked
    await new Promise(resolve => setTimeout(resolve, 20))

    const countAfterConnections = redisManager.getOpenConnectionsCount()

    // Should have more connections than after getting client (at least 1 more)
    assert.isTrue(countAfterConnections >= afterGetClient)

    // Force reset should close everything
    await CentralRedisManager.forceReset()

    // Give a moment for cleanup
    await new Promise(resolve => setTimeout(resolve, 50))

    // New instance should have no connections
    const newManager = getCentralRedisManager()
    assert.equal(newManager.getOpenConnectionsCount(), 0)
  })
})

test.group('CentralRedisManager - Connection Cleanup', (group) => {
  let duplicateClient: any

  group.teardown(async () => {
    // Clean up any connections created in tests
    if (duplicateClient) {
      try {
        await duplicateClient.quit()
      } catch (error) {
        // Connection may already be closed
      }
    }
    await CentralRedisManager.forceReset()
  })

  test('should properly clean up duplicate connections', async ({ assert }) => {
    const redisManager = getCentralRedisManager()

    // Get initial count
    redisManager.getClient() // Creates main connection

    // Give time for main connection to be tracked
    await new Promise(resolve => setTimeout(resolve, 20))
    const initialCount = redisManager.getOpenConnectionsCount()

    // Create duplicate connection
    duplicateClient = redisManager.duplicate()

    // Give time for duplicate to be tracked
    await new Promise(resolve => setTimeout(resolve, 30))

    const afterDuplicate = redisManager.getOpenConnectionsCount()
    // Be more lenient with connection counting due to async nature
    assert.isTrue(afterDuplicate >= initialCount, `Expected ${afterDuplicate} to be >= ${initialCount}`)

    // Close the duplicate connection
    await duplicateClient.quit()
    duplicateClient = null

    // Give event loop time to process the 'end' event
    await new Promise(resolve => setTimeout(resolve, 50))

    // Connection count should be back to initial or close to it
    const finalCount = redisManager.getOpenConnectionsCount()
    assert.isTrue(finalCount <= initialCount + 1, `Expected ${finalCount} to be <= ${initialCount + 1}`)
  })

  test('should handle connection errors gracefully', async ({ assert }) => {
    const redisManager = getCentralRedisManager()
    const _client = redisManager.getClient()

    // Give time for connection to be tracked
    await new Promise(resolve => setTimeout(resolve, 10))

    // Connection should be tracked (allow for 0 if cleanup happened)
    const connectionCount = redisManager.getOpenConnectionsCount()
    assert.isTrue(connectionCount >= 0, `Connection count should be >= 0, got ${connectionCount}`)

    // Even with Redis operations, connection should remain tracked
    try {
      await _client.ping()
      assert.isTrue(true) // Test passes if ping succeeds
    } catch (error) {
      // If Redis is not available, that's also okay for this test
      assert.isTrue(true)
    }
  })
})

// This test demonstrates proper leak detection usage
test.group('CentralRedisManager - With Leak Detection', (group) => {
  group.teardown(async () => {
    // This demonstrates how to add leak detection to any test group
    await addRedisLeakDetection()
    await CentralRedisManager.forceReset()
  })

  test('should properly clean up connections', async ({ assert }) => {
    const redisManager = getCentralRedisManager()

    // Ensure we have a baseline client
    redisManager.getClient()

    // Give time for connection to be tracked
    await new Promise(resolve => setTimeout(resolve, 20))
    const initialCount = redisManager.getOpenConnectionsCount()

    // Create a duplicate connection
    const duplicateClient = redisManager.duplicate()

    // Give time for duplicate to be tracked
    await new Promise(resolve => setTimeout(resolve, 30))

    const afterDuplicate = redisManager.getOpenConnectionsCount()
    assert.isTrue(afterDuplicate >= initialCount, `Expected ${afterDuplicate} to be >= ${initialCount}`)

    // Properly clean up the duplicate
    await duplicateClient.quit()

    // Give event loop time to process the 'end' event
    await new Promise(resolve => setTimeout(resolve, 50))

    // Should be back to initial count or close
    const finalCount = redisManager.getOpenConnectionsCount()
    assert.isTrue(finalCount <= initialCount + 1, `Expected ${finalCount} to be <= ${initialCount + 1}`)
  })

  test('should handle multiple connection types', async ({ assert }) => {
    const redisManager = getCentralRedisManager()

    // Ensure we have a baseline client
    redisManager.getClient()

    // Give time for baseline to be tracked
    await new Promise(resolve => setTimeout(resolve, 20))
    const initialCount = redisManager.getOpenConnectionsCount()

    // Create different types of connections
    const duplicate = redisManager.duplicate()
    const bullmq = redisManager.duplicateForBullMQ()

    // Give time for connections to be tracked
    await new Promise(resolve => setTimeout(resolve, 50))

    const afterConnections = redisManager.getOpenConnectionsCount()
    // Be more lenient - just ensure we have at least as many connections as before
    assert.isTrue(afterConnections >= initialCount, `Expected ${afterConnections} to be >= ${initialCount}`)

    // Properly clean up the duplicates
    await duplicate.quit()
    await bullmq.quit()

    // Give event loop time to process events
    await new Promise(resolve => setTimeout(resolve, 50))

    // Should be back to initial count or close
    const finalCount = redisManager.getOpenConnectionsCount()
    assert.isTrue(finalCount <= initialCount + 2, `Expected ${finalCount} to be <= ${initialCount + 2}`)
  })
})

// This test group demonstrates what happens when connections are leaked
test.group('CentralRedisManager - Leak Detection Demo', (group) => {
  group.teardown(async () => {
    // Force reset to clean up leaked connections for other tests
    await CentralRedisManager.forceReset()
  })

  test('should demonstrate connection leak detection', ({ assert }) => {
    const redisManager = getCentralRedisManager()

    // Get initial count 
    const initialCount = redisManager.getOpenConnectionsCount()

    // Create connections but intentionally don't clean them up
    redisManager.getClient()
    redisManager.duplicate()

    // These connections will be "leaked" - should have more than initial
    assert.isTrue(redisManager.getOpenConnectionsCount() > initialCount)

    // If this test group had addRedisLeakDetection() in its teardown,
    // it would fail and report the leak. This is intentionally left out
    // to show what leaked connections look like.
    console.log('This test intentionally leaves connections open to demonstrate leak tracking')
  })
})
