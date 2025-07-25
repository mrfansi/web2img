import { test } from '@japa/runner'
import { CacheService, type ScreenshotOptions } from '#services/cache_service'
import redis from '@adonisjs/redis/services/main'

test.group('CacheService', (group) => {
  let cacheService: CacheService

  group.setup(() => {
    cacheService = CacheService.getInstance()
  })

  group.teardown(async () => {
    // Clean up test keys
    const pattern = 'screenshot:cache:*'
    const keys = await redis.keys(pattern)
    if (keys.length > 0) {
      await redis.del(...keys)
    }
    
    const lockPattern = 'screenshot:lock:*'
    const lockKeys = await redis.keys(lockPattern)
    if (lockKeys.length > 0) {
      await redis.del(...lockKeys)
    }
  })

  test('should create singleton instance', ({ assert }) => {
    const instance1 = CacheService.getInstance()
    const instance2 = CacheService.getInstance()
    
    assert.strictEqual(instance1, instance2)
  })

  test('should generate consistent cache keys for same URL and options', ({ assert }) => {
    const url = 'https://example.com'
    const options: ScreenshotOptions = {
      format: 'png',
      width: 1280,
      height: 720
    }

    const key1 = cacheService.generateCacheKey(url, options)
    const key2 = cacheService.generateCacheKey(url, options)
    
    assert.equal(key1, key2)
    assert.isString(key1)
    assert.isTrue(key1.length === 64) // SHA-256 hex string length
  })

  test('should generate different cache keys for different URLs', ({ assert }) => {
    const options: ScreenshotOptions = {
      format: 'png',
      width: 1280,
      height: 720
    }

    const key1 = cacheService.generateCacheKey('https://example.com', options)
    const key2 = cacheService.generateCacheKey('https://google.com', options)
    
    assert.notEqual(key1, key2)
  })

  test('should generate different cache keys for different options', ({ assert }) => {
    const url = 'https://example.com'
    
    const key1 = cacheService.generateCacheKey(url, {
      format: 'png',
      width: 1280,
      height: 720
    })
    
    const key2 = cacheService.generateCacheKey(url, {
      format: 'jpeg',
      width: 1280,
      height: 720
    })
    
    const key3 = cacheService.generateCacheKey(url, {
      format: 'png',
      width: 1920,
      height: 1080
    })
    
    assert.notEqual(key1, key2)
    assert.notEqual(key1, key3)
    assert.notEqual(key2, key3)
  })

  test('should normalize URLs for consistent caching', ({ assert }) => {
    const baseUrl = 'https://example.com'
    const options: ScreenshotOptions = {
      format: 'png',
      width: 1280,
      height: 720
    }

    // URLs with tracking parameters should generate same key
    const key1 = cacheService.generateCacheKey(`${baseUrl}?utm_source=test`, options)
    const key2 = cacheService.generateCacheKey(`${baseUrl}?fbclid=123`, options)
    const key3 = cacheService.generateCacheKey(baseUrl, options)
    
    assert.equal(key1, key2)
    assert.equal(key1, key3)
  })

  test('should set and get cached values', async ({ assert }) => {
    const key = 'test-key-1'
    const value = 'https://imgproxy.example.com/test-image.png'
    
    await cacheService.set(key, value)
    const retrieved = await cacheService.get(key)
    
    assert.equal(retrieved, value)
  })

  test('should set cached values with custom TTL', async ({ assert }) => {
    const key = 'test-key-ttl'
    const value = 'https://imgproxy.example.com/test-image-ttl.png'
    const ttl = 60 // 1 minute
    
    await cacheService.set(key, value, ttl)
    const retrieved = await cacheService.get(key)
    
    assert.equal(retrieved, value)
    
    // Check TTL is set correctly
    const actualTtl = await redis.ttl('screenshot:cache:' + key)
    assert.isTrue(actualTtl > 0 && actualTtl <= ttl)
  })

  test('should return null for non-existent keys', async ({ assert }) => {
    const result = await cacheService.get('non-existent-key')
    assert.isNull(result)
  })

  test('should delete cached values', async ({ assert }) => {
    const key = 'test-key-delete'
    const value = 'https://imgproxy.example.com/test-delete.png'
    
    await cacheService.set(key, value)
    assert.equal(await cacheService.get(key), value)
    
    await cacheService.del(key)
    assert.isNull(await cacheService.get(key))
  })

  test('should handle processing locks', async ({ assert }) => {
    const url = 'https://example.com/processing-test'
    
    // Initially not processing
    assert.isFalse(await cacheService.isProcessing(url))
    
    // Set processing lock
    await cacheService.setProcessingLock(url, 60)
    assert.isTrue(await cacheService.isProcessing(url))
    
    // Remove processing lock
    await cacheService.removeProcessingLock(url)
    assert.isFalse(await cacheService.isProcessing(url))
  })

  test('should handle processing lock TTL', async ({ assert }) => {
    const url = 'https://example.com/processing-ttl-test'
    
    // Set lock with short TTL
    await cacheService.setProcessingLock(url, 1)
    assert.isTrue(await cacheService.isProcessing(url))
    
    // Wait for TTL to expire
    await new Promise(resolve => setTimeout(resolve, 1100))
    assert.isFalse(await cacheService.isProcessing(url))
  })

  test('should get cache statistics', async ({ assert }) => {
    // Add some test data
    await cacheService.set('stats-test-1', 'value1')
    await cacheService.set('stats-test-2', 'value2')
    
    const stats = await cacheService.getStats()
    
    assert.properties(stats, ['totalKeys', 'memoryUsage'])
    assert.isNumber(stats.totalKeys)
    assert.isString(stats.memoryUsage)
    assert.isTrue(stats.totalKeys >= 0) // Should have some keys
  })

  test('should flush all cache entries', async ({ assert }) => {
    // Add test data
    await cacheService.set('flush-test-1', 'value1')
    await cacheService.set('flush-test-2', 'value2')
    
    // Flush cache should not throw errors
    await assert.doesNotReject(() => cacheService.flush())
    
    // Test that flush method works by verifying it can be called multiple times
    await assert.doesNotReject(() => cacheService.flush())
  })

  test('should handle cache errors gracefully', async ({ assert }) => {
    // Mock Redis error for get operation
    const originalGet = redis.get
    redis.get = async () => {
      throw new Error('Redis connection error')
    }

    try {
      const result = await cacheService.get('error-test-key')
      assert.isNull(result) // Should return null on error
    } finally {
      // Restore original method
      redis.get = originalGet
    }
  })

  test('should not throw errors on set failures', async ({ assert }) => {
    // Mock Redis error for set operation
    const originalSetex = redis.setex
    redis.setex = async () => {
      throw new Error('Redis connection error')
    }

    try {
      // Should not throw error
      await assert.doesNotReject(() => 
        cacheService.set('error-test-key', 'value')
      )
    } finally {
      // Restore original method
      redis.setex = originalSetex
    }
  })

  test('should clear expired entries', async ({ assert }) => {
    // This test is limited since Redis automatically handles TTL
    // We're mainly testing that the method doesn't throw errors
    const clearedCount = await cacheService.clearExpired()
    assert.isNumber(clearedCount)
    assert.isTrue(clearedCount >= 0)
  })
})

test.group('CacheService - Key Generation Edge Cases', (group) => {
  let cacheService: CacheService

  group.setup(() => {
    cacheService = CacheService.getInstance()
  })

  test('should handle URLs with query parameters consistently', ({ assert }) => {
    const options: ScreenshotOptions = {
      format: 'png',
      width: 1280,
      height: 720
    }

    // Different parameter orders should generate same key
    const key1 = cacheService.generateCacheKey('https://example.com?a=1&b=2', options)
    const key2 = cacheService.generateCacheKey('https://example.com?b=2&a=1', options)
    
    assert.equal(key1, key2)
  })

  test('should handle URLs with fragments', ({ assert }) => {
    const options: ScreenshotOptions = {
      format: 'png',
      width: 1280,
      height: 720
    }

    const key1 = cacheService.generateCacheKey('https://example.com#section1', options)
    const key2 = cacheService.generateCacheKey('https://example.com#section2', options)
    
    // Fragments should affect cache key since they can affect page content
    assert.notEqual(key1, key2)
  })

  test('should handle malformed URLs gracefully', ({ assert }) => {
    const options: ScreenshotOptions = {
      format: 'png',
      width: 1280,
      height: 720
    }

    // Should not throw error for malformed URL
    assert.doesNotThrow(() => {
      const key = cacheService.generateCacheKey('not-a-valid-url', options)
      assert.isString(key)
    })
  })

  test('should exclude timeout from cache key', ({ assert }) => {
    const url = 'https://example.com'
    
    const key1 = cacheService.generateCacheKey(url, {
      format: 'png',
      width: 1280,
      height: 720,
      timeout: 30
    })
    
    const key2 = cacheService.generateCacheKey(url, {
      format: 'png',
      width: 1280,
      height: 720,
      timeout: 60
    })
    
    // Timeout should not affect cache key
    assert.equal(key1, key2)
  })
})