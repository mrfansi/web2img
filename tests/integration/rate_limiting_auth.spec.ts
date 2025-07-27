import { test } from '@japa/runner'
import { ApiClient } from '@japa/api-client'
import ApiKey from '#models/api_key'
import User from '#models/user'
import { cleanupRedisConnections } from '#tests/utils/redis_test_utils'

test.group('Rate Limiting and Authentication - Integration Tests', (group) => {
  let apiClient: ApiClient
  let testUser: User
  let lowLimitApiKey: ApiKey
  let highLimitApiKey: ApiKey
  let inactiveApiKey: ApiKey

  group.setup(async () => {
    apiClient = new ApiClient()
    
    // Create test user
    testUser = await User.create({
      email: 'ratelimit-test@example.com',
      password: 'password123'
    })
    
    // Create API key with low rate limit for testing
    lowLimitApiKey = await ApiKey.create({
      key: 'low-limit-api-key-123',
      name: 'Low Limit Test Key',
      userId: testUser.id,
      rateLimit: 5, // 5 requests per minute
      isActive: true
    })
    
    // Create API key with high rate limit
    highLimitApiKey = await ApiKey.create({
      key: 'high-limit-api-key-123',
      name: 'High Limit Test Key',
      userId: testUser.id,
      rateLimit: 1000, // 1000 requests per minute
      isActive: true
    })
    
    // Create inactive API key
    inactiveApiKey = await ApiKey.create({
      key: 'inactive-api-key-123',
      name: 'Inactive Test Key',
      userId: testUser.id,
      rateLimit: 100,
      isActive: false
    })
  })

  group.teardown(async () => {
    // Clean up test data
    if (lowLimitApiKey) {
      await lowLimitApiKey.delete()
    }
    if (highLimitApiKey) {
      await highLimitApiKey.delete()
    }
    if (inactiveApiKey) {
      await inactiveApiKey.delete()
    }
    if (testUser) {
      await testUser.delete()
    }
    
    // Clean up Redis connections
    await cleanupRedisConnections()
  })

  test('rate limiting enforcement', async ({ assert }) => {
    const requests = []
    
    // Make requests up to the rate limit
    for (let i = 0; i < 5; i++) {
      const response = await apiClient
        .post('/screenshot')
        .header('X-API-Key', lowLimitApiKey.key)
        .json({
          url: `https://example.com?test=${i}`,
          cache: false // Disable cache to ensure each request is processed
        })
      
      requests.push(response)
      
      // Check rate limit headers
      assert.isDefined(response.headers()['x-ratelimit-limit'])
      assert.isDefined(response.headers()['x-ratelimit-remaining'])
      assert.equal(response.headers()['x-ratelimit-limit'], '5')
      
      const remaining = parseInt(response.headers()['x-ratelimit-remaining'])
      assert.equal(remaining, 4 - i) // Should decrease with each request
    }
    
    // All requests within limit should succeed
    requests.forEach(response => {
      response.assertStatus(200)
    })
    
    // Next request should be rate limited
    const rateLimitedResponse = await apiClient
      .post('/screenshot')
      .header('X-API-Key', lowLimitApiKey.key)
      .json({
        url: 'https://example.com?rate-limited=true'
      })
    
    rateLimitedResponse.assertStatus(429)
    rateLimitedResponse.assertBodyContains({
      detail: {
        error: 'rate_limited'
      }
    })
    
    // Should have retry-after header
    assert.isDefined(rateLimitedResponse.headers()['retry-after'])
    assert.equal(rateLimitedResponse.headers()['x-ratelimit-remaining'], '0')
  })

  test('rate limiting with different API keys', async ({ assert }) => {
    // Use up the low limit key
    for (let i = 0; i < 5; i++) {
      const response = await apiClient
        .post('/screenshot')
        .header('X-API-Key', lowLimitApiKey.key)
        .json({
          url: `https://example.com?low-limit=${i}`,
          cache: false
        })
      
      response.assertStatus(200)
    }
    
    // Low limit key should now be rate limited
    const lowLimitResponse = await apiClient
      .post('/screenshot')
      .header('X-API-Key', lowLimitApiKey.key)
      .json({
        url: 'https://example.com?should-fail=true'
      })
    
    lowLimitResponse.assertStatus(429)
    
    // High limit key should still work
    const highLimitResponse = await apiClient
      .post('/screenshot')
      .header('X-API-Key', highLimitApiKey.key)
      .json({
        url: 'https://example.com?high-limit=true'
      })
    
    highLimitResponse.assertStatus(200)
    assert.equal(highLimitResponse.headers()['x-ratelimit-limit'], '1000')
  })

  test('batch request rate limiting', async ({ }) => {
    // Create multiple batch jobs to test rate limiting
    const batchRequests = []
    
    for (let i = 0; i < 3; i++) {
      const response = await apiClient
        .post('/batch/screenshots')
        .header('X-API-Key', lowLimitApiKey.key)
        .json({
          items: [
            { id: `batch${i}-item1`, url: 'https://example.com' }
          ]
        })
      
      batchRequests.push(response)
    }
    
    // First few should succeed
    batchRequests.forEach(response => {
      response.assertStatus(202)
    })
    
    // Make more requests to exceed rate limit
    for (let i = 0; i < 3; i++) {
      await apiClient
        .post('/batch/screenshots')
        .header('X-API-Key', lowLimitApiKey.key)
        .json({
          items: [
            { id: `excess${i}-item1`, url: 'https://example.com' }
          ]
        })
    }
    
    // Next request should be rate limited
    const rateLimitedResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', lowLimitApiKey.key)
      .json({
        items: [
          { id: 'rate-limited-item', url: 'https://example.com' }
        ]
      })
    
    rateLimitedResponse.assertStatus(429)
    rateLimitedResponse.assertBodyContains({
      detail: {
        error: 'rate_limited'
      }
    })
  })

  test('authentication with missing API key', async ({ }) => {
    // Test single screenshot without API key
    const singleResponse = await apiClient
      .post('/screenshot')
      .json({
        url: 'https://example.com'
      })
    
    singleResponse.assertStatus(401)
    singleResponse.assertBodyContains({
      detail: {
        error: 'missing_api_key',
        message: 'API key is required. Please provide X-API-Key header.'
      }
    })
    
    // Test batch screenshot without API key
    const batchResponse = await apiClient
      .post('/batch/screenshots')
      .json({
        items: [
          { id: 'no-auth-item', url: 'https://example.com' }
        ]
      })
    
    batchResponse.assertStatus(401)
    batchResponse.assertBodyContains({
      detail: {
        error: 'missing_api_key'
      }
    })
    
    // Test batch status without API key
    const statusResponse = await apiClient
      .get('/batch/screenshots/123')
    
    statusResponse.assertStatus(401)
    statusResponse.assertBodyContains({
      detail: {
        error: 'missing_api_key'
      }
    })
  })

  test('authentication with invalid API key', async ({ }) => {
    const invalidKeys = [
      'invalid-key-123',
      'nonexistent-key',
      '',
      'too-short',
      'a'.repeat(100) // Too long
    ]
    
    for (const invalidKey of invalidKeys) {
      const response = await apiClient
        .post('/screenshot')
        .header('X-API-Key', invalidKey)
        .json({
          url: 'https://example.com'
        })
      
      response.assertStatus(401)
      response.assertBodyContains({
        detail: {
          error: 'invalid_api_key'
        }
      })
    }
  })

  test('authentication with inactive API key', async ({ }) => {
    const response = await apiClient
      .post('/screenshot')
      .header('X-API-Key', inactiveApiKey.key)
      .json({
        url: 'https://example.com'
      })
    
    response.assertStatus(401)
    response.assertBodyContains({
      detail: {
        error: 'invalid_api_key',
        message: 'API key is invalid or inactive'
      }
    })
  })

  test('authentication context propagation', async ({ assert }) => {
    // Make a successful request and verify auth context is set
    const response = await apiClient
      .post('/screenshot')
      .header('X-API-Key', highLimitApiKey.key)
      .json({
        url: 'https://example.com'
      })
    
    response.assertStatus(200)
    
    // The response should indicate successful authentication
    // (auth context should be available to the controller)
    assert.isDefined(response.body().url)
    
    // Rate limit headers should reflect the correct API key limits
    assert.equal(response.headers()['x-ratelimit-limit'], '1000')
  })

  test('concurrent requests with rate limiting', async ({ assert }) => {
    // Make concurrent requests to test race conditions in rate limiting
    const concurrentRequests = Array.from({ length: 6 }, (_, i) => 
      apiClient
        .post('/screenshot')
        .header('X-API-Key', lowLimitApiKey.key)
        .json({
          url: `https://example.com?concurrent=${i}`,
          cache: false
        })
    )
    
    const responses = await Promise.all(concurrentRequests)
    
    // Count successful and rate-limited responses
    const successfulResponses = responses.filter(r => r.response.status === 200)
    const rateLimitedResponses = responses.filter(r => r.response.status === 429)
    
    // Should have exactly 5 successful requests (the rate limit)
    assert.equal(successfulResponses.length, 5)
    assert.equal(rateLimitedResponses.length, 1)
    
    // All rate-limited responses should have proper error format
    rateLimitedResponses.forEach(response => {
      response.assertBodyContains({
        detail: {
          error: 'rate_limited'
        }
      })
    })
  })

  test('rate limit reset after time window', async ({ assert }) => {
    // Use up the rate limit
    for (let i = 0; i < 5; i++) {
      const response = await apiClient
        .post('/screenshot')
        .header('X-API-Key', lowLimitApiKey.key)
        .json({
          url: `https://example.com?reset-test=${i}`,
          cache: false
        })
      
      response.assertStatus(200)
    }
    
    // Next request should be rate limited
    const rateLimitedResponse = await apiClient
      .post('/screenshot')
      .header('X-API-Key', lowLimitApiKey.key)
      .json({
        url: 'https://example.com?should-be-limited=true'
      })
    
    rateLimitedResponse.assertStatus(429)
    
    // Wait for rate limit window to reset (assuming 1-minute window)
    // In a real test, you might want to mock the time or use a shorter window
    console.log('Waiting for rate limit reset...')
    await new Promise(resolve => setTimeout(resolve, 61000)) // Wait 61 seconds
    
    // Should be able to make requests again
    const resetResponse = await apiClient
      .post('/screenshot')
      .header('X-API-Key', lowLimitApiKey.key)
      .json({
        url: 'https://example.com?after-reset=true'
      })
    
    resetResponse.assertStatus(200)
    assert.equal(resetResponse.headers()['x-ratelimit-remaining'], '4')
  }).timeout(70000) // Increase timeout for this test

  test('health endpoints bypass authentication', async ({ assert }) => {
    // Health endpoints should not require authentication
    const healthEndpoints = [
      '/health',
      '/health/detailed',
      '/health/ready',
      '/health/live',
      '/metrics'
    ]
    
    for (const endpoint of healthEndpoints) {
      const response = await apiClient.get(endpoint)
      
      // Should not return 401 (may return other status codes based on health)
      assert.notEqual(response.response.status, 401)
    }
  })
})