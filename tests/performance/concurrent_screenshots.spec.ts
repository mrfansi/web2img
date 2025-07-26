import { test } from '@japa/runner'
import { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import ApiKey from '#models/api_key'
import User from '#models/user'
import { cleanupRedisConnections } from '#tests/utils/redis_test_utils'

test.group('Concurrent Screenshots - Performance Tests', (group) => {
  let apiClient: ApiClient
  let testUser: User
  let testApiKey: ApiKey

  group.setup(async () => {
    apiClient = testUtils.apiClient()
    
    // Create test user
    testUser = await User.create({
      email: 'perf-test@example.com',
      password: 'password123'
    })
    
    // Create test API key with high rate limit
    testApiKey = await ApiKey.create({
      key: 'perf-test-api-key-123',
      name: 'Performance Test Key',
      userId: testUser.id,
      rateLimit: 10000, // High limit for performance testing
      isActive: true
    })
  })

  group.teardown(async () => {
    // Clean up test data
    if (testApiKey) {
      await testApiKey.delete()
    }
    if (testUser) {
      await testUser.delete()
    }
    
    // Clean up Redis connections
    await cleanupRedisConnections()
  })

  test('concurrent single screenshot requests - 10 requests', async ({ assert }) => {
    const concurrency = 10
    const startTime = Date.now()
    
    // Create concurrent requests
    const requests = Array.from({ length: concurrency }, (_, i) =>
      apiClient
        .post('/screenshot')
        .header('X-API-Key', testApiKey.key)
        .json({
          url: `https://example.com?concurrent=${i}`,
          format: 'png',
          width: 1280,
          height: 720,
          cache: false // Disable cache to test actual processing
        })
    )
    
    // Execute all requests concurrently
    const responses = await Promise.all(requests)
    const totalTime = Date.now() - startTime
    
    // Verify all requests succeeded
    const successfulResponses = responses.filter(r => r.response.status === 200)
    const failedResponses = responses.filter(r => r.response.status !== 200)
    
    console.log(`Concurrent Screenshots Performance:`)
    console.log(`- Concurrency: ${concurrency}`)
    console.log(`- Total time: ${totalTime}ms`)
    console.log(`- Average time per request: ${totalTime / concurrency}ms`)
    console.log(`- Successful requests: ${successfulResponses.length}`)
    console.log(`- Failed requests: ${failedResponses.length}`)
    
    // Performance assertions
    assert.isTrue(successfulResponses.length >= concurrency * 0.8, 'At least 80% of requests should succeed')
    assert.isTrue(totalTime < 60000, 'All requests should complete within 60 seconds')
    
    // Verify response structure
    successfulResponses.forEach(response => {
      assert.isString(response.body().url)
      assert.equal(response.body().cached, false)
    })
    
    // Calculate throughput
    const throughput = (successfulResponses.length / totalTime) * 1000 // requests per second
    console.log(`- Throughput: ${throughput.toFixed(2)} requests/second`)
    
    // Log any failures for debugging
    if (failedResponses.length > 0) {
      console.log('Failed responses:', failedResponses.map(r => ({
        status: r.response.status,
        body: r.body()
      })))
    }
  }).timeout(120000) // 2 minute timeout

  test('concurrent single screenshot requests - 25 requests', async ({ assert }) => {
    const concurrency = 25
    const startTime = Date.now()
    
    // Create concurrent requests with different URLs to avoid cache hits
    const requests = Array.from({ length: concurrency }, (_, i) =>
      apiClient
        .post('/screenshot')
        .header('X-API-Key', testApiKey.key)
        .json({
          url: `https://httpbin.org/html?id=${i}&timestamp=${Date.now()}`,
          format: i % 2 === 0 ? 'png' : 'jpeg', // Mix formats
          width: 1280,
          height: 720,
          cache: false
        })
    )
    
    // Execute all requests concurrently
    const responses = await Promise.all(requests)
    const totalTime = Date.now() - startTime
    
    // Analyze results
    const successfulResponses = responses.filter(r => r.response.status === 200)
    const rateLimitedResponses = responses.filter(r => r.response.status === 429)
    const errorResponses = responses.filter(r => r.response.status >= 500)
    
    console.log(`High Concurrency Screenshots Performance:`)
    console.log(`- Concurrency: ${concurrency}`)
    console.log(`- Total time: ${totalTime}ms`)
    console.log(`- Average time per request: ${totalTime / concurrency}ms`)
    console.log(`- Successful requests: ${successfulResponses.length}`)
    console.log(`- Rate limited requests: ${rateLimitedResponses.length}`)
    console.log(`- Error requests: ${errorResponses.length}`)
    
    // Performance assertions - more lenient for higher concurrency
    assert.isTrue(successfulResponses.length >= concurrency * 0.6, 'At least 60% of requests should succeed')
    assert.isTrue(totalTime < 120000, 'All requests should complete within 2 minutes')
    
    // Calculate metrics
    const throughput = (successfulResponses.length / totalTime) * 1000
    console.log(`- Throughput: ${throughput.toFixed(2)} requests/second`)
    
    // Memory usage check (if available)
    if (process.memoryUsage) {
      const memUsage = process.memoryUsage()
      console.log(`- Memory usage: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`)
    }
  }).timeout(180000) // 3 minute timeout

  test('concurrent requests with cache performance', async ({ assert }) => {
    const concurrency = 20
    const sameUrl = 'https://example.com/cache-test'
    
    // First, make one request to populate cache
    const cachePopulateResponse = await apiClient
      .post('/screenshot')
      .header('X-API-Key', testApiKey.key)
      .json({
        url: sameUrl,
        format: 'png',
        cache: true
      })
    
    cachePopulateResponse.assertStatus(200)
    assert.equal(cachePopulateResponse.body().cached, false)
    
    // Now make concurrent requests to the same URL (should hit cache)
    const startTime = Date.now()
    
    const requests = Array.from({ length: concurrency }, () =>
      apiClient
        .post('/screenshot')
        .header('X-API-Key', testApiKey.key)
        .json({
          url: sameUrl,
          format: 'png',
          cache: true
        })
    )
    
    const responses = await Promise.all(requests)
    const totalTime = Date.now() - startTime
    
    // Analyze cache performance
    const successfulResponses = responses.filter(r => r.response.status === 200)
    const cachedResponses = successfulResponses.filter(r => r.body().cached === true)
    
    console.log(`Cache Performance Test:`)
    console.log(`- Concurrency: ${concurrency}`)
    console.log(`- Total time: ${totalTime}ms`)
    console.log(`- Average time per request: ${totalTime / concurrency}ms`)
    console.log(`- Successful requests: ${successfulResponses.length}`)
    console.log(`- Cached responses: ${cachedResponses.length}`)
    console.log(`- Cache hit rate: ${(cachedResponses.length / successfulResponses.length * 100).toFixed(1)}%`)
    
    // Cache performance assertions
    assert.isTrue(successfulResponses.length >= concurrency * 0.9, 'At least 90% should succeed with cache')
    assert.isTrue(cachedResponses.length >= successfulResponses.length * 0.8, 'At least 80% should be cache hits')
    assert.isTrue(totalTime < 10000, 'Cached requests should be very fast (< 10 seconds total)')
    
    // Cache should be much faster
    const avgTimePerRequest = totalTime / concurrency
    console.log(`- Average time per cached request: ${avgTimePerRequest}ms`)
    assert.isTrue(avgTimePerRequest < 500, 'Cached requests should average < 500ms each')
  }).timeout(60000)

  test('mixed concurrent requests - cache hits and misses', async ({ assert }) => {
    const concurrency = 30
    const cacheableUrls = [
      'https://example.com/page1',
      'https://example.com/page2',
      'https://example.com/page3'
    ]
    
    const startTime = Date.now()
    
    // Create mix of requests - some will hit cache, some won't
    const requests = Array.from({ length: concurrency }, (_, i) => {
      const useCache = i % 3 === 0 // Every 3rd request uses a cacheable URL
      const url = useCache 
        ? cacheableUrls[i % cacheableUrls.length]
        : `https://httpbin.org/html?unique=${i}&timestamp=${Date.now()}`
      
      return apiClient
        .post('/screenshot')
        .header('X-API-Key', testApiKey.key)
        .json({
          url,
          format: 'png',
          cache: true
        })
    })
    
    const responses = await Promise.all(requests)
    const totalTime = Date.now() - startTime
    
    // Analyze mixed performance
    const successfulResponses = responses.filter(r => r.response.status === 200)
    const cachedResponses = successfulResponses.filter(r => r.body().cached === true)
    const freshResponses = successfulResponses.filter(r => r.body().cached === false)
    
    console.log(`Mixed Cache Performance Test:`)
    console.log(`- Concurrency: ${concurrency}`)
    console.log(`- Total time: ${totalTime}ms`)
    console.log(`- Successful requests: ${successfulResponses.length}`)
    console.log(`- Cached responses: ${cachedResponses.length}`)
    console.log(`- Fresh responses: ${freshResponses.length}`)
    console.log(`- Cache hit rate: ${(cachedResponses.length / successfulResponses.length * 100).toFixed(1)}%`)
    
    // Performance assertions
    assert.isTrue(successfulResponses.length >= concurrency * 0.7, 'At least 70% should succeed')
    assert.isTrue(totalTime < 90000, 'Mixed requests should complete within 90 seconds')
    
    // Should have both cached and fresh responses
    assert.isTrue(cachedResponses.length > 0, 'Should have some cache hits')
    assert.isTrue(freshResponses.length > 0, 'Should have some fresh responses')
    
    const throughput = (successfulResponses.length / totalTime) * 1000
    console.log(`- Overall throughput: ${throughput.toFixed(2)} requests/second`)
  }).timeout(120000)

  test('stress test - 50 concurrent requests', async ({ assert }) => {
    const concurrency = 50
    const startTime = Date.now()
    
    // Create stress test requests
    const requests = Array.from({ length: concurrency }, (_, i) =>
      apiClient
        .post('/screenshot')
        .header('X-API-Key', testApiKey.key)
        .json({
          url: `https://httpbin.org/delay/${Math.floor(Math.random() * 3)}?id=${i}`, // Random delays 0-2 seconds
          format: ['png', 'jpeg', 'webp'][i % 3], // Rotate formats
          width: [1280, 1920, 800][i % 3], // Different sizes
          height: [720, 1080, 600][i % 3],
          cache: i % 4 === 0 // 25% cache enabled
        })
    )
    
    // Execute stress test
    const responses = await Promise.allSettled(requests)
    const totalTime = Date.now() - startTime
    
    // Analyze stress test results
    const fulfilledResponses = responses.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>[]
    const rejectedResponses = responses.filter(r => r.status === 'rejected')
    
    const successfulResponses = fulfilledResponses.filter(r => r.value.response.status === 200)
    const timeoutResponses = fulfilledResponses.filter(r => r.value.response.status === 408)
    const errorResponses = fulfilledResponses.filter(r => r.value.response.status >= 500)
    
    console.log(`Stress Test Results:`)
    console.log(`- Concurrency: ${concurrency}`)
    console.log(`- Total time: ${totalTime}ms`)
    console.log(`- Fulfilled requests: ${fulfilledResponses.length}`)
    console.log(`- Rejected requests: ${rejectedResponses.length}`)
    console.log(`- Successful requests: ${successfulResponses.length}`)
    console.log(`- Timeout responses: ${timeoutResponses.length}`)
    console.log(`- Error responses: ${errorResponses.length}`)
    
    // Stress test assertions - more lenient
    assert.isTrue(successfulResponses.length >= concurrency * 0.4, 'At least 40% should succeed under stress')
    assert.isTrue(totalTime < 300000, 'Stress test should complete within 5 minutes')
    
    // Calculate success rate
    const successRate = (successfulResponses.length / concurrency) * 100
    console.log(`- Success rate: ${successRate.toFixed(1)}%`)
    
    // Memory usage
    if (process.memoryUsage) {
      const memUsage = process.memoryUsage()
      console.log(`- Peak memory usage: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`)
      console.log(`- RSS memory: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`)
    }
    
    // Log error distribution for debugging
    if (errorResponses.length > 0) {
      const errorCounts: Record<number, number> = {}
      errorResponses.forEach(r => {
        const status = r.value.response.status
        errorCounts[status] = (errorCounts[status] || 0) + 1
      })
      console.log('- Error distribution:', errorCounts)
    }
  }).timeout(360000) // 6 minute timeout
})