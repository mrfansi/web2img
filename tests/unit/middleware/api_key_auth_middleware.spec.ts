import { test } from '@japa/runner'
import { HttpContextFactory } from '@adonisjs/core/factories/http'
import ApiKeyAuthMiddleware from '#middleware/api_key_auth_middleware'
import ApiKey from '#models/api_key'
import User from '#models/user'

test.group('API Key Auth Middleware', () => {
  test('should return 401 when X-API-Key header is missing', async ({ assert }) => {
    const ctx = new HttpContextFactory().create()
    const middleware = new ApiKeyAuthMiddleware()
    
    let nextCalled = false
    const next = async () => {
      nextCalled = true
    }

    await middleware.handle(ctx, next)

    assert.isFalse(nextCalled)
    assert.equal(ctx.response.getStatus(), 401)
    
    const responseBody = ctx.response.getBody()
    assert.deepEqual(responseBody, {
      detail: {
        error: 'missing_api_key',
        message: 'X-API-Key header is required'
      }
    })
  })

  test('should return 401 when API key is invalid', async ({ assert }) => {
    const ctx = new HttpContextFactory().create()
    ctx.request.request.headers['x-api-key'] = 'invalid-key'
    
    const middleware = new ApiKeyAuthMiddleware()
    
    // Mock ApiKey.findByKey to return null
    const originalFindByKey = ApiKey.findByKey
    ApiKey.findByKey = async () => null
    
    let nextCalled = false
    const next = async () => {
      nextCalled = true
    }

    await middleware.handle(ctx, next)

    // Restore original method
    ApiKey.findByKey = originalFindByKey

    assert.isFalse(nextCalled)
    assert.equal(ctx.response.getStatus(), 401)
    
    const responseBody = ctx.response.getBody()
    assert.deepEqual(responseBody, {
      detail: {
        error: 'invalid_api_key',
        message: 'Invalid or inactive API key'
      }
    })
  })

  test('should enrich context and call next when API key is valid', async ({ assert }) => {
    const ctx = new HttpContextFactory().create()
    ctx.request.request.headers['x-api-key'] = 'valid-key'
    
    const middleware = new ApiKeyAuthMiddleware()
    
    // Create mock user and API key
    const mockUser = new User()
    mockUser.id = 1
    mockUser.email = 'test@example.com'
    
    const mockApiKey = new ApiKey()
    mockApiKey.id = 1
    mockApiKey.key = 'valid-key'
    mockApiKey.name = 'Test Key'
    mockApiKey.userId = 1
    mockApiKey.rateLimit = 1000
    mockApiKey.isActive = true
    mockApiKey.user = mockUser
    
    // Mock ApiKey.findByKey to return mock API key
    const originalFindByKey = ApiKey.findByKey
    ApiKey.findByKey = async () => mockApiKey
    
    let nextCalled = false
    const next = async () => {
      nextCalled = true
    }

    await middleware.handle(ctx, next)

    // Restore original method
    ApiKey.findByKey = originalFindByKey

    assert.isTrue(nextCalled)
    assert.equal(ctx.apiKey, mockApiKey)
    assert.equal(ctx.user, mockUser)
    assert.notEqual(ctx.response.getStatus(), 401)
  })

  test('should handle case-insensitive header extraction', async ({ assert }) => {
    const ctx = new HttpContextFactory().create()
    // Set header using the request object method
    ctx.request.request.headers['x-api-key'] = 'valid-key'
    
    const middleware = new ApiKeyAuthMiddleware()
    
    // Create mock user and API key
    const mockUser = new User()
    mockUser.id = 1
    mockUser.email = 'test@example.com'
    
    const mockApiKey = new ApiKey()
    mockApiKey.id = 1
    mockApiKey.key = 'valid-key'
    mockApiKey.name = 'Test Key'
    mockApiKey.userId = 1
    mockApiKey.rateLimit = 1000
    mockApiKey.isActive = true
    mockApiKey.user = mockUser
    
    // Mock ApiKey.findByKey to return mock API key
    const originalFindByKey = ApiKey.findByKey
    ApiKey.findByKey = async () => mockApiKey
    
    let nextCalled = false
    const next = async () => {
      nextCalled = true
    }

    await middleware.handle(ctx, next)

    // Restore original method
    ApiKey.findByKey = originalFindByKey

    assert.isTrue(nextCalled)
    assert.equal(ctx.apiKey, mockApiKey)
    assert.equal(ctx.user, mockUser)
  })
})