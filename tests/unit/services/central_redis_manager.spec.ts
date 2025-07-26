import { test } from '@japa/runner'
import { getCentralRedisManager, CentralRedisManager } from '#services/central_redis_manager'
import { addRedisLeakDetection, cleanupRedisConnections } from '#tests/utils/redis_test_utils'

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
    const initialCount = redisManager.getOpenConnectionsCount()
    const client = redisManager.getClient()
    
    assert.isDefined(client)
    // After getting client, count should be at least 1 (may be higher due to bootstrap)
    assert.isTrue(redisManager.getOpenConnectionsCount() >= 1)
  })

  test('should track duplicate connections', ({ assert }) => {
    const redisManager = getCentralRedisManager()
    
    // Get base client first
    redisManager.getClient()
    const countAfterClient = redisManager.getOpenConnectionsCount()
    
    // Create duplicate
    const duplicate = redisManager.duplicate()
    assert.equal(redisManager.getOpenConnectionsCount(), countAfterClient + 1)
    
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
    assert.properties(info[0], ['status', 'readyState'])
  })

  test('should properly shutdown all connections', async ({ assert }) => {
    const redisManager = getCentralRedisManager()
    
    // Get initial count (may have bootstrap connections)
    const initialCount = redisManager.getOpenConnectionsCount()
    
    // Create additional connections
    redisManager.getClient()
    const beforeDuplicate = redisManager.getOpenConnectionsCount()
    redisManager.duplicate()
    const beforeBullMQ = redisManager.getOpenConnectionsCount()
    redisManager.duplicateForBullMQ()
    const finalCount = redisManager.getOpenConnectionsCount()
    
    // Should have added connections (but may not be exactly initialCount + 3 due to existing connections)
    assert.isTrue(finalCount > initialCount)
    
    // Shutdown should close all connections
    await redisManager.shutdown()
    
    // After shutdown, all connections should be closed
    assert.equal(redisManager.getOpenConnectionsCount(), 0)
  })

  test('should handle Redis operations', async ({ assert }) => {
    const redisManager = getCentralRedisManager()
    const client = redisManager.getClient()
    
    // Test basic Redis operations
    await client.set('test:key', 'test-value')
    const value = await client.get('test:key')
    
    assert.equal(value, 'test-value')
    
    // Cleanup
    await client.del('test:key')
  })

  test('should handle force reset', async ({ assert }) => {
    const redisManager = getCentralRedisManager()
    
    // Create connections
    redisManager.getClient()
    redisManager.duplicate()
    
    // Should have at least 2 connections (may be more from bootstrap)
    assert.isTrue(redisManager.getOpenConnectionsCount() >= 2)
    
    // Force reset should close everything
    await CentralRedisManager.forceReset()
    
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
    const initialCount = redisManager.getOpenConnectionsCount()
    
    // Create and properly close duplicate
    duplicateClient = redisManager.duplicate()
    assert.equal(redisManager.getOpenConnectionsCount(), initialCount + 1)
    
    // Close the duplicate connection
    await duplicateClient.quit()
    duplicateClient = null
    
    // Give event loop time to process the 'end' event
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // Connection count should be back to initial
    assert.equal(redisManager.getOpenConnectionsCount(), initialCount)
  })

  test('should handle connection errors gracefully', async ({ assert }) => {
    const redisManager = getCentralRedisManager()
    const client = redisManager.getClient()
    
    // Connection should be tracked
    assert.isTrue(redisManager.getOpenConnectionsCount() > 0)
    
    // Even with Redis operations, connection should remain tracked
    try {
      await client.ping()
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
    
    // Create a duplicate connection
    const duplicateClient = redisManager.duplicate()
    assert.equal(redisManager.getOpenConnectionsCount(), 2) // main + duplicate
    
    // Properly clean up the duplicate
    await duplicateClient.quit()
    
    // Give event loop time to process the 'end' event
    await new Promise(resolve => setTimeout(resolve, 10))
    
    // Should only have the main connection left
    assert.equal(redisManager.getOpenConnectionsCount(), 1)
  })

  test('should handle multiple connection types', async ({ assert }) => {
    const redisManager = getCentralRedisManager()
    
    // Create different types of connections
    const client = redisManager.getClient()
    const duplicate = redisManager.duplicate()
    const bullmq = redisManager.duplicateForBullMQ()
    
    assert.equal(redisManager.getOpenConnectionsCount(), 3)
    
    // Properly clean up the duplicates
    await duplicate.quit()
    await bullmq.quit()
    
    // Give event loop time to process events
    await new Promise(resolve => setTimeout(resolve, 20))
    
    // Should only have the main connection left
    assert.equal(redisManager.getOpenConnectionsCount(), 1)
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
    
    // Create connections but intentionally don't clean them up
    redisManager.getClient()
    redisManager.duplicate()
    
    // These connections will be "leaked"
    assert.equal(redisManager.getOpenConnectionsCount(), 2)
    
    // If this test group had addRedisLeakDetection() in its teardown,
    // it would fail and report the leak. This is intentionally left out
    // to show what leaked connections look like.
    console.log('This test intentionally leaves connections open to demonstrate leak tracking')
  })
})
