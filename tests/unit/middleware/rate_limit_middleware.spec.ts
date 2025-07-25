import { test } from '@japa/runner'
import { HttpContextFactory } from '@adonisjs/core/factories/http'
import RateLimitMiddleware from '#middleware/rate_limit_middleware'
import ApiKey from '#models/api_key'
import User from '#models/user'
import redis from '@adonisjs/redis/services/main'

test.group('Rate Limit Middleware', (group) => {
  // Clean up Redis keys before and after each test
  group.each.setup(async () => {
    const keys = await redis.keys('rate_limit:*')
    if (keys.length > 0) {
      await redis.del(...keys)
    }
  })
  
  group.each.teardown(async () => {
    const keys = await redis.keys('rate_limit:*')
    if (keys.length > 0) {
      await redis.del(...keys)
    }
  })

  test('should return 500 when API key is not available', async ({ assert }) => {
    const ctx = new HttpContextFactory().create()
    const middleware = new RateLimitMiddleware()
    
    let nextCalled = false
    const next = async () => {
      nextCalled = true
    }

    await middleware.handle(ctx, next)

    assert.isFalse(nextCalled)
    assert.equal(ctx.response.getStatus(), 500)
    
    const responseBody = ctx.response.getBody()
    assert.deepEqual(responseBody, {
      detail: {
        error: 'internal_error',
        message: 'Rate limiting requires API key authentication'
      }
    })
  })

  test('should allow request when under rate limit', async ({ assert }) => {
    const ctx = new HttpContextFactory().create()
    
    // Create mock user and API key
    const mockUser = new User()
    mockUser.id = 1
    mockUser.email = 'test@example.com'
    
    const mockApiKey = new ApiKey()
    mockApiKey.id = 1
    mockApiKey.key = `test-key-${Date.now()}-1`
    mockApiKey.name = 'Test Key'
    mockApiKey.userId = 1
    mockApiKey.rateLimit = 100
    mockApiKey.isActive = true
    mockApiKey.user = mockUser
    
    ctx.apiKey = mockApiKey
    
    const middleware = new RateLimitMiddleware()
    
    let nextCalled = false
    const next = async () => {
      nextCalled = true
    }

    await middleware.handle(ctx, next)

    assert.isTrue(nextCalled)
    assert.notEqual(ctx.response.getStatus(), 429)
    
    // Check rate limit headers
    const headers = ctx.response.getHeaders()
    assert.equal(headers['x-ratelimit-limit'], '100')
    assert.equal(headers['x-ratelimit-remaining'], '99')
    assert.isTrue(headers['x-ratelimit-reset'] !== undefined)
  })

  test('should block request when rate limit exceeded', async ({ assert }) => {
    const ctx = new HttpContextFactory().create()
    
    // Create mock user and API key with low rate limit
    const mockUser = new User()
    mockUser.id = 1
    mockUser.email = 'test@example.com'
    
    const mockApiKey = new ApiKey()
    mockApiKey.id = 1
    mockApiKey.key = `test-key-${Date.now()}-2`
    mockApiKey.name = 'Test Key'
    mockApiKey.userId = 1
    mockApiKey.rateLimit = 2 // Very low limit for testing
    mockApiKey.isActive = true
    mockApiKey.user = mockUser
    
    ctx.apiKey = mockApiKey
    
    const middleware = new RateLimitMiddleware()
    
    const next = async () => {}

    // Make requests up to the limit
    await middleware.handle(ctx, next)
    await middleware.handle(ctx, next)
    
    // This request should be blocked
    let nextCalled = false
    const nextBlocked = async () => {
      nextCalled = true
    }
    
    await middleware.handle(ctx, nextBlocked)

    assert.isFalse(nextCalled)
    assert.equal(ctx.response.getStatus(), 429)
    
    const responseBody = ctx.response.getBody()
    assert.equal(responseBody.detail.error, 'rate_limited')
    assert.isTrue(responseBody.detail.message.includes('Rate limit exceeded'))
    assert.isNumber(responseBody.detail.retry_after)
    
    // Check rate limit headers
    const headers = ctx.response.getHeaders()
    assert.equal(headers['x-ratelimit-limit'], '2')
    assert.equal(headers['x-ratelimit-remaining'], '0')
    assert.isTrue(headers['retry-after'] !== undefined)
  })

  test('should handle Redis errors gracefully', async ({ assert }) => {
    const ctx = new HttpContextFactory().create()
    
    // Create mock user and API key
    const mockUser = new User()
    mockUser.id = 1
    mockUser.email = 'test@example.com'
    
    const mockApiKey = new ApiKey()
    mockApiKey.id = 1
    mockApiKey.key = `test-key-${Date.now()}-3`
    mockApiKey.name = 'Test Key'
    mockApiKey.userId = 1
    mockApiKey.rateLimit = 100
    mockApiKey.isActive = true
    mockApiKey.user = mockUser
    
    ctx.apiKey = mockApiKey
    
    const middleware = new RateLimitMiddleware()
    
    // Mock Redis to throw an error
    const originalPipeline = redis.pipeline
    redis.pipeline = () => {
      throw new Error('Redis connection failed')
    }
    
    let nextCalled = false
    const next = async () => {
      nextCalled = true
    }

    await middleware.handle(ctx, next)

    // Restore original method
    redis.pipeline = originalPipeline

    // Should continue despite Redis error
    assert.isTrue(nextCalled)
    assert.notEqual(ctx.response.getStatus(), 429)
    
    // Should still set basic headers
    const headers = ctx.response.getHeaders()
    assert.equal(headers['x-ratelimit-limit'], '100')
    assert.equal(headers['x-ratelimit-remaining'], '100')
  })

  test('should get rate limit status correctly', async ({ assert }) => {
    const middleware = new RateLimitMiddleware()
    
    // Test with clean state
    const status = await middleware.getRateLimitStatus(`test-status-key-${Date.now()}`)
    
    assert.isNumber(status.limit)
    assert.isNumber(status.remaining)
    assert.isNumber(status.reset)
    assert.isNumber(status.current)
    assert.isTrue(status.remaining <= status.limit)
  })

  test('should set correct rate limit headers for multiple requests', async ({ assert }) => {
    const ctx1 = new HttpContextFactory().create()
    const ctx2 = new HttpContextFactory().create()
    
    // Create mock user and API key
    const mockUser = new User()
    mockUser.id = 1
    mockUser.email = 'test@example.com'
    
    const mockApiKey = new ApiKey()
    mockApiKey.id = 1
    mockApiKey.key = `test-key-${Date.now()}-4`
    mockApiKey.name = 'Test Key'
    mockApiKey.userId = 1
    mockApiKey.rateLimit = 10
    mockApiKey.isActive = true
    mockApiKey.user = mockUser
    
    ctx1.apiKey = mockApiKey
    ctx2.apiKey = mockApiKey
    
    const middleware = new RateLimitMiddleware()
    const next = async () => {}

    // First request
    await middleware.handle(ctx1, next)
    let headers = ctx1.response.getHeaders()
    assert.equal(headers['x-ratelimit-remaining'], '9')

    // Second request
    await middleware.handle(ctx2, next)
    headers = ctx2.response.getHeaders()
    assert.equal(headers['x-ratelimit-remaining'], '8')
  })
})