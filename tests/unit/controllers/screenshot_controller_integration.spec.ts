import { test } from '@japa/runner'
import ApiKeyAuthMiddleware from '#middleware/api_key_auth_middleware'
import RateLimitMiddleware from '#middleware/rate_limit_middleware'
import RequestLoggingMiddleware from '#middleware/request_logging_middleware'
import ScreenshotController from '#controllers/screenshot_controller'
import ApiKey from '#models/api_key'

test.group('ScreenshotController - Integration Tests', (group) => {
  let controller: ScreenshotController
  let apiKeyAuthMiddleware: ApiKeyAuthMiddleware
  let rateLimitMiddleware: RateLimitMiddleware
  let requestLoggingMiddleware: RequestLoggingMiddleware

  group.setup(() => {
    controller = new ScreenshotController()
    apiKeyAuthMiddleware = new ApiKeyAuthMiddleware()
    rateLimitMiddleware = new RateLimitMiddleware()
    requestLoggingMiddleware = new RequestLoggingMiddleware()
  })

  test('should handle complete middleware chain for single screenshot', async ({ assert }) => {
    // Mock API key
    const mockApiKey = {
      id: 1,
      key: 'test-api-key-123',
      name: 'Test API Key',
      rateLimit: 1000,
      user: { id: 1, email: 'test@example.com' },
    }

    ApiKey.findByKey = async () => mockApiKey as any

    // Mock services for successful screenshot
    const mockServices = setupMockServices()

    let responseStatus = 200
    let responseBody: any = null
    let responseHeaders: Record<string, string> = {}

    const ctx = {
      request: {
        method: () => 'POST',
        url: () => '/screenshot',
        header: (name: string) => {
          if (name === 'X-API-Key') return 'test-api-key-123'
          if (name === 'user-agent') return 'Test Client/1.0'
          return undefined
        },
        ip: () => '127.0.0.1',
        all: () => ({
          url: 'https://example.com',
          format: 'png',
          width: 1280,
          height: 720,
          cache: true,
        }),
        input: (key: string) => (key === 'url' ? 'https://example.com' : undefined),
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
        header: (name: string, value: string) => {
          responseHeaders[name] = value
          return ctx.response
        },
        getStatus: () => responseStatus,
      },
      correlationId: undefined,
      apiKey: undefined,
      user: undefined,
    }

    // Simulate middleware chain execution
    const next = async () => {
      await controller.single(ctx as any)
    }

    // Execute middleware chain
    await requestLoggingMiddleware.handle(ctx as any, async () => {
      await apiKeyAuthMiddleware.handle(ctx as any, async () => {
        await rateLimitMiddleware.handle(ctx as any, next)
      })
    })

    // Verify middleware effects
    assert.isDefined(ctx.correlationId)
    assert.isDefined(ctx.apiKey)
    assert.equal((ctx.apiKey as any).key, 'test-api-key-123')
    assert.isDefined(responseHeaders['X-RateLimit-Limit'])
    assert.isDefined(responseHeaders['X-RateLimit-Remaining'])

    // Verify controller response
    assert.equal(responseStatus, 200)
    assert.isDefined(responseBody.url)
    assert.isBoolean(responseBody.cached)

    // Cleanup mocks
    cleanupMockServices(mockServices)
  })

  test('should handle authentication failure', async ({ assert }) => {
    // Mock API key not found
    ApiKey.findByKey = async () => null

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        method: () => 'POST',
        url: () => '/screenshot',
        header: (name: string) => {
          if (name === 'X-API-Key') return 'invalid-api-key'
          if (name === 'user-agent') return 'Test Client/1.0'
          return undefined
        },
        ip: () => '127.0.0.1',
        all: () => ({
          url: 'https://example.com',
        }),
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
        getStatus: () => responseStatus,
      },
      correlationId: undefined,
      apiKey: undefined,
      user: undefined,
    }

    const next = async () => {
      await controller.single(ctx as any)
    }

    // Execute middleware chain (should fail at auth)
    await requestLoggingMiddleware.handle(ctx as any, async () => {
      await apiKeyAuthMiddleware.handle(ctx as any, next)
    })

    // Verify authentication failure
    assert.equal(responseStatus, 401)
    assert.equal(responseBody.detail.error, 'invalid_api_key')
  })

  test('should handle missing API key', async ({ assert }) => {
    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        method: () => 'POST',
        url: () => '/screenshot',
        header: (name: string) => {
          if (name === 'user-agent') return 'Test Client/1.0'
          return undefined // No X-API-Key header
        },
        ip: () => '127.0.0.1',
        all: () => ({
          url: 'https://example.com',
        }),
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
        getStatus: () => responseStatus,
      },
      correlationId: undefined,
      apiKey: undefined,
      user: undefined,
    }

    const next = async () => {
      await controller.single(ctx as any)
    }

    // Execute middleware chain (should fail at auth)
    await requestLoggingMiddleware.handle(ctx as any, async () => {
      await apiKeyAuthMiddleware.handle(ctx as any, next)
    })

    // Verify missing API key failure
    assert.equal(responseStatus, 401)
    assert.equal(responseBody.detail.error, 'missing_api_key')
  })

  test('should handle batch job creation with middleware', async ({ assert }) => {
    // Mock API key
    const mockApiKey = {
      id: 1,
      key: 'test-api-key-123',
      name: 'Test API Key',
      rateLimit: 1000,
      user: { id: 1, email: 'test@example.com' },
    }

    ApiKey.findByKey = async () => mockApiKey as any

    // Mock batch job creation
    const mockBatchJob = {
      id: 123,
      status: 'pending',
      totalItems: 2,
      completedItems: 0,
      failedItems: 0,
      results: [],
      createdAt: { toISO: () => '2025-01-26T10:00:00.000Z' },
      updatedAt: { toISO: () => '2025-01-26T10:00:00.000Z' },
      scheduledAt: null,
      completedAt: null,
      estimatedCompletion: null,
      save: async () => {},
    }

    const BatchJob = await import('#models/batch_job')
    BatchJob.default.createBatchJob = async () => mockBatchJob as any

    const queueService = await import('#services/queue_service')
    queueService.default.addBatchJob = async () => ({ id: 'queue-job-123' }) as any

    let responseStatus = 200
    let responseBody: any = null
    let responseHeaders: Record<string, string> = {}

    const ctx = {
      request: {
        method: () => 'POST',
        url: () => '/batch/screenshots',
        header: (name: string) => {
          if (name === 'X-API-Key') return 'test-api-key-123'
          if (name === 'user-agent') return 'Test Client/1.0'
          return undefined
        },
        ip: () => '127.0.0.1',
        all: () => ({
          items: [
            { id: 'item1', url: 'https://example.com' },
            { id: 'item2', url: 'https://google.com' },
          ],
          config: {
            parallel: 5,
            timeout: 60000,
            cache: true,
          },
        }),
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
        header: (name: string, value: string) => {
          responseHeaders[name] = value
          return ctx.response
        },
        getStatus: () => responseStatus,
      },
      correlationId: undefined,
      apiKey: undefined,
      user: undefined,
    }

    const next = async () => {
      await controller.createBatch(ctx as any)
    }

    // Execute middleware chain
    await requestLoggingMiddleware.handle(ctx as any, async () => {
      await apiKeyAuthMiddleware.handle(ctx as any, async () => {
        await rateLimitMiddleware.handle(ctx as any, next)
      })
    })

    // Verify middleware effects
    assert.isDefined(ctx.correlationId)
    assert.isDefined(ctx.apiKey)
    assert.equal((ctx.apiKey as any).key, 'test-api-key-123')
    assert.isDefined(responseHeaders['X-RateLimit-Limit'])

    // Verify controller response
    assert.equal(responseStatus, 202)
    assert.equal(responseBody.job_id, '123')
    assert.equal(responseBody.status, 'pending')
    assert.equal(responseBody.total, 2)
  })

  // Helper function to setup mock services
  function setupMockServices() {
    const cacheService = require('#services/cache_service').default
    const screenshotWorkerService =
      require('#services/screenshot_worker_service').screenshotWorkerService
    const fileStorageService = require('#services/file_storage_service').default
    const imgProxyService = require('#services/imgproxy_service').default

    const originalMethods = {
      cacheGet: cacheService.get,
      cacheGenerateKey: cacheService.generateCacheKey,
      cacheIsProcessing: cacheService.isProcessing,
      cacheSetLock: cacheService.setProcessingLock,
      cacheRemoveLock: cacheService.removeProcessingLock,
      cacheSet: cacheService.set,
      workerProcess: screenshotWorkerService.processScreenshotJob,
      storageSave: fileStorageService.saveFile,
      storageGetUrl: fileStorageService.getFileUrl,
      imgProxyGenerate: imgProxyService.generateUrlWithFallback,
    }

    // Setup mocks
    cacheService.get = async () => null
    cacheService.generateCacheKey = () => 'test-cache-key'
    cacheService.isProcessing = async () => false
    cacheService.setProcessingLock = async () => {}
    cacheService.removeProcessingLock = async () => {}
    cacheService.set = async () => {}

    screenshotWorkerService.processScreenshotJob = async () => ({
      buffer: Buffer.from('fake-image-data'),
      format: 'png',
      width: 1280,
      height: 720,
      processingTime: 1000,
      finalUrl: 'https://example.com',
      wasTransformed: false,
    })

    fileStorageService.saveFile = async () => 'screenshots/2025/01/26/test.png'
    fileStorageService.getFileUrl = () => 'https://storage.example.com/test.png'
    imgProxyService.generateUrlWithFallback = () => 'https://imgproxy.example.com/test.png'

    return originalMethods
  }

  // Helper function to cleanup mock services
  function cleanupMockServices(originalMethods: any) {
    const cacheService = require('#services/cache_service').default
    const screenshotWorkerService =
      require('#services/screenshot_worker_service').screenshotWorkerService
    const fileStorageService = require('#services/file_storage_service').default
    const imgProxyService = require('#services/imgproxy_service').default

    // Restore original methods
    cacheService.get = originalMethods.cacheGet
    cacheService.generateCacheKey = originalMethods.cacheGenerateKey
    cacheService.isProcessing = originalMethods.cacheIsProcessing
    cacheService.setProcessingLock = originalMethods.cacheSetLock
    cacheService.removeProcessingLock = originalMethods.cacheRemoveLock
    cacheService.set = originalMethods.cacheSet
    screenshotWorkerService.processScreenshotJob = originalMethods.workerProcess
    fileStorageService.saveFile = originalMethods.storageSave
    fileStorageService.getFileUrl = originalMethods.storageGetUrl
    imgProxyService.generateUrlWithFallback = originalMethods.imgProxyGenerate
  }
})
