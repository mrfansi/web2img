import { test } from '@japa/runner'
import ScreenshotController from '#controllers/screenshot_controller'
import cacheService from '#services/cache_service'
import { screenshotWorkerService } from '#services/screenshot_worker_service'
import fileStorageService from '#services/file_storage_service'
import imgProxyService from '#services/imgproxy_service'
import BatchJob from '#models/batch_job'
import { DateTime } from 'luxon'

test.group('ScreenshotController - Single Screenshot', (group) => {
  let controller: ScreenshotController

  group.setup(() => {
    controller = new ScreenshotController()
  })

  test('should return cached screenshot when available', async ({ assert }) => {
    // Mock cache service to return cached URL
    const mockCachedUrl = 'https://imgproxy.example.com/cached-screenshot.png'
    const mockExpirationTime = new Date(Date.now() + 3600000) // 1 hour from now

    cacheService.get = async () => mockCachedUrl
    cacheService.generateCacheKey = () => 'test-cache-key'
    cacheService.getExpirationTime = async () => mockExpirationTime

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        all: () => ({
          url: 'https://example.com',
          format: 'png',
          width: 1280,
          height: 720,
          cache: true,
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
      },
    }

    await controller.single(ctx as any)

    assert.equal(responseStatus, 200)
    assert.equal(responseBody.url, mockCachedUrl)
  })

  test('should process new screenshot when not cached', async ({ assert }) => {
    // Mock services
    cacheService.get = async () => null
    cacheService.generateCacheKey = () => 'test-cache-key'
    cacheService.isProcessing = async () => false
    cacheService.setProcessingLock = async () => { }
    cacheService.removeProcessingLock = async () => { }
    cacheService.set = async () => { }
    cacheService.getDefaultTtl = () => 3600

    const mockScreenshotResult = {
      buffer: Buffer.from('fake-image-data-12345'), // 21 bytes
      format: 'png',
      width: 1280,
      height: 720,
      processingTime: 1000,
      finalUrl: 'https://example.com',
      wasTransformed: false,
    }

    screenshotWorkerService.processScreenshotJob = async () => mockScreenshotResult

    const mockStoragePath = 'screenshots/2025/01/26/test.png'
    fileStorageService.saveFile = async () => mockStoragePath

    const mockDirectUrl = 'https://storage.example.com/screenshots/2025/01/26/test.png'
    fileStorageService.getFileUrl = () => mockDirectUrl

    const mockImgProxyUrl = 'https://imgproxy.example.com/processed-screenshot.png'
    imgProxyService.generateUrlWithFallback = () => mockImgProxyUrl

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
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
      },
    }

    await controller.single(ctx as any)

    assert.equal(responseStatus, 200)
    assert.equal(responseBody.url, mockImgProxyUrl)
  })

  test('should return 429 when URL is being processed', async ({ assert }) => {
    cacheService.get = async () => null
    cacheService.generateCacheKey = () => 'test-cache-key'
    cacheService.isProcessing = async () => true

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        all: () => ({
          url: 'https://example.com',
          format: 'png',
          width: 1280,
          height: 720,
          cache: true,
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
      },
    }

    await controller.single(ctx as any)

    assert.equal(responseStatus, 429)
    assert.equal(responseBody.detail.error, 'processing_in_progress')
  })

  test('should return 400 for validation errors', async ({ assert }) => {
    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        all: () => ({
          url: 'invalid-url',
          format: 'invalid-format',
        }),
        input: (key: string) => (key === 'url' ? 'invalid-url' : undefined),
        url: () => '/api/screenshot',
        method: () => 'POST',
        header: (name: string) => name === 'user-agent' ? 'test-agent' : undefined,
        ip: () => '127.0.0.1',
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
      },
    }

    await controller.single(ctx as any)

    assert.equal(responseStatus, 400)
    assert.equal(responseBody.detail.error, 'validation_failed')
  })

  test('should return 408 for timeout errors', async ({ assert }) => {
    cacheService.get = async () => null
    cacheService.generateCacheKey = () => 'test-cache-key'
    cacheService.isProcessing = async () => false
    cacheService.setProcessingLock = async () => { }
    cacheService.removeProcessingLock = async () => { }

    screenshotWorkerService.processScreenshotJob = async () => {
      throw new Error('Navigation timeout after 30000ms')
    }

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        all: () => ({
          url: 'https://slow-website.com',
          format: 'png',
          width: 1280,
          height: 720,
          cache: true,
        }),
        input: (key: string) => (key === 'url' ? 'https://slow-website.com' : undefined),
        url: () => '/api/screenshot',
        method: () => 'POST',
        header: (name: string) => name === 'user-agent' ? 'test-agent' : undefined,
        ip: () => '127.0.0.1',
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
      },
    }

    await controller.single(ctx as any)

    assert.equal(responseStatus, 408)
    assert.equal(responseBody.detail.error, 'timeout')
  })

  test('should return 400 for HTTP errors', async ({ assert }) => {
    cacheService.get = async () => null
    cacheService.generateCacheKey = () => 'test-cache-key'
    cacheService.isProcessing = async () => false
    cacheService.setProcessingLock = async () => { }
    cacheService.removeProcessingLock = async () => { }

    screenshotWorkerService.processScreenshotJob = async () => {
      throw new Error('HTTP 404: Not Found')
    }

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        all: () => ({
          url: 'https://example.com/not-found',
          format: 'png',
          width: 1280,
          height: 720,
          cache: true,
        }),
        input: (key: string) => (key === 'url' ? 'https://example.com/not-found' : undefined),
        url: () => '/api/screenshot',
        method: () => 'POST',
        header: (name: string) => name === 'user-agent' ? 'test-agent' : undefined,
        ip: () => '127.0.0.1',
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
      },
    }

    await controller.single(ctx as any)

    assert.equal(responseStatus, 400)
    assert.equal(responseBody.detail.error, 'invalid_url')
  })

  test('should return 500 for storage errors', async ({ assert }) => {
    cacheService.get = async () => null
    cacheService.generateCacheKey = () => 'test-cache-key'
    cacheService.isProcessing = async () => false
    cacheService.setProcessingLock = async () => { }
    cacheService.removeProcessingLock = async () => { }

    const mockScreenshotResult = {
      buffer: Buffer.from('fake-image-data'),
      format: 'png',
      width: 1280,
      height: 720,
      processingTime: 1000,
      finalUrl: 'https://example.com',
      wasTransformed: false,
    }

    screenshotWorkerService.processScreenshotJob = async () => mockScreenshotResult

    const storageError = new Error('Storage failed') as any
    storageError.code = 'STORAGE_SAVE_FAILED'
    fileStorageService.saveFile = async () => {
      throw storageError
    }

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        all: () => ({
          url: 'https://example.com',
          format: 'png',
          width: 1280,
          height: 720,
          cache: true,
        }),
        input: (key: string) => (key === 'url' ? 'https://example.com' : undefined),
        url: () => '/api/screenshot',
        method: () => 'POST',
        header: (name: string) => name === 'user-agent' ? 'test-agent' : undefined,
        ip: () => '127.0.0.1',
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
      },
    }

    await controller.single(ctx as any)

    assert.equal(responseStatus, 500)
    assert.equal(responseBody.detail.error, 'storage_error')
  })

  test('should use default values for optional parameters', async ({ assert }) => {
    cacheService.get = async () => null
    cacheService.generateCacheKey = () => 'test-cache-key'
    cacheService.isProcessing = async () => false
    cacheService.setProcessingLock = async () => { }
    cacheService.removeProcessingLock = async () => { }
    cacheService.set = async () => { }

    let capturedOptions: any = null
    screenshotWorkerService.processScreenshotJob = async (jobData) => {
      capturedOptions = jobData.options
      return {
        buffer: Buffer.from('fake-image-data'),
        format: 'png',
        width: 1280,
        height: 720,
        processingTime: 1000,
        finalUrl: 'https://example.com',
        wasTransformed: false,
      }
    }

    fileStorageService.saveFile = async () => 'screenshots/2025/01/26/test.png'
    fileStorageService.getFileUrl = () => 'https://storage.example.com/test.png'
    imgProxyService.generateUrlWithFallback = () => 'https://imgproxy.example.com/test.png'

    let responseStatus = 200

    const ctx = {
      request: {
        all: () => ({
          url: 'https://example.com',
          // No format, width, height, timeout, or cache specified
        }),
        input: (key: string) => (key === 'url' ? 'https://example.com' : undefined),
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (_data: any) => {
          return ctx.response
        },
      },
    }

    await controller.single(ctx as any)

    assert.equal(responseStatus, 200)
    assert.equal(capturedOptions.format, 'png')
    assert.equal(capturedOptions.width, 1280)
    assert.equal(capturedOptions.height, 720)
    assert.equal(capturedOptions.timeout, 30000)
  })

  test('should bypass cache when cache parameter is false', async ({ assert }) => {
    let cacheGetCalled = false
    let cacheSetCalled = false

    cacheService.get = async () => {
      cacheGetCalled = true
      return 'cached-url'
    }
    cacheService.set = async () => {
      cacheSetCalled = true
    }
    cacheService.generateCacheKey = () => 'test-cache-key'
    cacheService.isProcessing = async () => false
    cacheService.setProcessingLock = async () => { }
    cacheService.removeProcessingLock = async () => { }

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

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        all: () => ({
          url: 'https://example.com',
          cache: false,
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
      },
    }

    await controller.single(ctx as any)

    assert.equal(responseStatus, 200)
    assert.isFalse(cacheGetCalled)
    assert.isFalse(cacheSetCalled)
    assert.isDefined(responseBody.url)
  })
})

test.group('ScreenshotController - Active Batch Jobs', (group) => {
  let controller: ScreenshotController

  group.setup(() => {
    controller = new ScreenshotController()
  })

  test('should return active batch jobs successfully', async ({ assert }) => {
    // Mock BatchJob query builder
    const mockActiveJobs = [
      {
        id: 123,
        status: 'processing',
        totalItems: 5,
        completedItems: 2,
        failedItems: 0,
        createdAt: { toISO: () => '2025-01-26T10:00:00.000Z' },
        updatedAt: { toISO: () => '2025-01-26T10:05:00.000Z' },
        scheduledAt: null,
        nextScheduledTime: null,
        estimatedCompletion: { toISO: () => '2025-01-26T10:15:00.000Z' },
      },
      {
        id: 124,
        status: 'scheduled',
        totalItems: 3,
        completedItems: 0,
        failedItems: 0,
        createdAt: { toISO: () => '2025-01-26T09:00:00.000Z' },
        updatedAt: { toISO: () => '2025-01-26T09:00:00.000Z' },
        scheduledAt: { toISO: () => '2025-01-26T12:00:00.000Z' },
        nextScheduledTime: { toISO: () => '2025-01-27T12:00:00.000Z' },
        estimatedCompletion: null,
      },
    ]

    // Mock the query builder chain
    BatchJob.query = () => ({
      whereIn: () => ({
        orderBy: () => mockActiveJobs,
      }),
    }) as any

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
      },
    }

    await controller.getActiveBatchJobs(ctx as any)

    assert.equal(responseStatus, 200)
    assert.lengthOf(responseBody.jobs, 2)
    assert.equal(responseBody.jobs[0].job_id, '123')
    assert.equal(responseBody.jobs[0].status, 'processing')
    assert.equal(responseBody.jobs[0].total, 5)
    assert.equal(responseBody.jobs[0].completed, 2)
    assert.equal(responseBody.jobs[0].failed, 0)
    assert.equal(responseBody.jobs[0].estimated_completion, '2025-01-26T10:15:00.000Z')
    assert.isUndefined(responseBody.jobs[0].scheduled_time)
    assert.isUndefined(responseBody.jobs[0].next_scheduled_time)

    assert.equal(responseBody.jobs[1].job_id, '124')
    assert.equal(responseBody.jobs[1].status, 'scheduled')
    assert.equal(responseBody.jobs[1].scheduled_time, '2025-01-26T12:00:00.000Z')
    assert.equal(responseBody.jobs[1].next_scheduled_time, '2025-01-27T12:00:00.000Z')
  })

  test('should return empty jobs array when no active jobs', async ({ assert }) => {
    // Mock the query builder chain to return empty array
    BatchJob.query = () => ({
      whereIn: () => ({
        orderBy: () => [],
      }),
    }) as any

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
      },
    }

    await controller.getActiveBatchJobs(ctx as any)

    assert.equal(responseStatus, 200)
    assert.lengthOf(responseBody.jobs, 0)
  })

  test('should handle database errors gracefully', async ({ assert }) => {
    // Mock the query builder chain to throw an error
    BatchJob.query = () => ({
      whereIn: () => ({
        orderBy: () => {
          throw new Error('Database connection failed')
        },
      }),
    }) as any

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        url: () => '/api/batch/active',
        method: () => 'GET',
        header: (name: string) => name === 'user-agent' ? 'test-agent' : undefined,
        ip: () => '127.0.0.1',
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
      },
    }

    await controller.getActiveBatchJobs(ctx as any)

    assert.equal(responseStatus, 500)
    assert.equal(responseBody.detail.error, 'active_jobs_retrieval_failed')
  })
})

test.group('SchedulshotController - Job Scheduling', (group) => {
  let controller: ScreenshotController

  group.setup(() => {
    controller = new ScreenshotController()
  })

  test('should schedule batch job successfully', async ({ assert }) => {
    const mockBatchJob = {
      id: 123,
      status: 'pending',
      totalItems: 3,
      completedItems: 0,
      failedItems: 0,
      progressPercentage: 0,
      createdAt: DateTime.fromISO('2025-01-26T10:00:00.000Z'),
      updatedAt: DateTime.fromISO('2025-01-26T10:30:00.000Z'),
      scheduledAt: null as DateTime | null,
      completedAt: null,
      estimatedCompletion: null,
      nextScheduledTime: null,
      config: { parallel: 3, timeout: 30000 },
      results: [],
      successfulResults: [],
      failedResults: [],
      save: async () => {
        // Update the mock object when save is called
        mockBatchJob.status = 'scheduled'
        mockBatchJob.scheduledAt = DateTime.fromISO('2025-12-31T15:00:00.000Z')
      },
    }

    BatchJob.find = async () => mockBatchJob as any

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '123' },
      request: {
        only: () => ({
          scheduled_time: '2025-12-31T15:00:00.000Z',
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
      },
    }

    await controller.scheduleBatchJob(ctx as any)

    assert.equal(responseStatus, 202)
    assert.equal(responseBody.job_id, '123')
    assert.equal(responseBody.status, 'scheduled')
    assert.equal(responseBody.scheduled_time, '2025-12-31T15:00:00.000+00:00')
  })

  test('should return 404 for non-existent job', async ({ assert }) => {
    BatchJob.find = async () => null

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '999' },
      request: {
        only: () => ({
          scheduled_time: '2025-01-26T15:00:00.000Z',
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
      },
    }

    await controller.scheduleBatchJob(ctx as any)

    assert.equal(responseStatus, 404)
    assert.equal(responseBody.detail.error, 'job_not_found')
  })

  test('should return 422 for invalid scheduled_time format', async ({ assert }) => {
    const mockBatchJob = {
      id: 123,
      status: 'pending',
      save: async () => { },
    }

    BatchJob.find = async () => mockBatchJob as any

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '123' },
      request: {
        only: () => ({
          scheduled_time: 'invalid-date-format',
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
      },
    }

    await controller.scheduleBatchJob(ctx as any)

    assert.equal(responseStatus, 422)
    assert.equal(responseBody.detail.error, 'validation_failed')
    assert.isArray(responseBody.detail.errors)
  })

  test('should return 400 for scheduled_time in the past', async ({ assert }) => {
    const mockBatchJob = {
      id: 123,
      status: 'pending',
      save: async () => { },
    }

    BatchJob.find = async () => mockBatchJob as any

    let responseStatus = 200
    let responseBody: any = null

    const pastTime = new Date(Date.now() - 3600000).toISOString() // 1 hour ago

    const ctx = {
      params: { job_id: '123' },
      request: {
        only: () => ({
          scheduled_time: pastTime,
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
      },
    }

    await controller.scheduleBatchJob(ctx as any)

    assert.equal(responseStatus, 400)
    assert.equal(responseBody.detail.error, 'invalid_scheduled_time')
    assert.include(responseBody.detail.message, 'future')
  })

  test('should return 400 for job in invalid state', async ({ assert }) => {
    const mockBatchJob = {
      id: 123,
      status: 'completed', // Invalid state for scheduling
    }

    BatchJob.find = async () => mockBatchJob as any

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '123' },
      request: {
        only: () => ({
          scheduled_time: '2025-12-31T15:00:00.000Z',
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
      },
    }

    await controller.scheduleBatchJob(ctx as any)

    assert.equal(responseStatus, 400)
    assert.equal(responseBody.detail.error, 'job_already_completed')
  })
})

test.group('ScreenshotController - Job Recurrence', (group) => {
  let controller: ScreenshotController

  group.setup(() => {
    controller = new ScreenshotController()
  })

  test('should set daily recurrence successfully', async ({ assert }) => {
    const mockBatchJob = {
      id: 123,
      status: 'scheduled',
      totalItems: 3,
      completedItems: 0,
      failedItems: 0,
      progressPercentage: 0,
      createdAt: { toISO: () => '2025-01-26T10:00:00.000Z' },
      updatedAt: { toISO: () => '2025-01-26T10:30:00.000Z' },
      scheduledAt: { toISO: () => '2025-01-26T15:00:00.000Z' },
      completedAt: null,
      estimatedCompletion: null,
      nextScheduledTime: { toISO: () => '2025-01-27T15:00:00.000Z' },
      config: { parallel: 3, timeout: 30000, recurrence: { pattern: 'daily', interval: 1 } },
      results: [],
      successfulResults: [],
      failedResults: [],
      save: async () => { },
    }

    BatchJob.find = async () => mockBatchJob as any

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '123' },
      request: {
        only: () => ({
          pattern: 'daily',
          interval: 1,
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
      },
    }

    await controller.setBatchJobRecurrence(ctx as any)

    assert.equal(responseStatus, 202)
    assert.equal(responseBody.job_id, '123')
    assert.equal(responseBody.status, 'scheduled')
    assert.equal(responseBody.next_scheduled_time, '2025-01-27T15:00:00.000Z')
    assert.equal(responseBody.config.recurrence.pattern, 'daily')
  })

  test('should set custom cron recurrence successfully', async ({ assert }) => {
    const mockBatchJob = {
      id: 124,
      status: 'scheduled',
      totalItems: 2,
      completedItems: 0,
      failedItems: 0,
      progressPercentage: 0,
      createdAt: { toISO: () => '2025-01-26T10:00:00.000Z' },
      updatedAt: { toISO: () => '2025-01-26T10:30:00.000Z' },
      scheduledAt: { toISO: () => '2025-01-26T15:00:00.000Z' },
      completedAt: null,
      estimatedCompletion: null,
      nextScheduledTime: { toISO: () => '2025-01-26T18:00:00.000Z' },
      config: {
        parallel: 3,
        timeout: 30000,
        recurrence: { pattern: 'custom', cron: '0 */3 * * *' },
      },
      results: [],
      successfulResults: [],
      failedResults: [],
      save: async () => { },
    }

    BatchJob.find = async () => mockBatchJob as any

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '124' },
      request: {
        only: () => ({
          pattern: 'custom',
          cron: '0 */3 * * *', // Every 3 hours
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
      },
    }

    await controller.setBatchJobRecurrence(ctx as any)

    assert.equal(responseStatus, 202)
    assert.equal(responseBody.job_id, '124')
    assert.equal(responseBody.config.recurrence.pattern, 'custom')
    assert.equal(responseBody.config.recurrence.cron, '0 */3 * * *')
    assert.equal(responseBody.next_scheduled_time, '2025-01-26T18:00:00.000Z')
  })

  test('should return 404 for non-existent job', async ({ assert }) => {
    BatchJob.find = async () => null

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '999' },
      request: {
        only: () => ({
          pattern: 'daily',
          interval: 1,
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
      },
    }

    await controller.setBatchJobRecurrence(ctx as any)

    assert.equal(responseStatus, 404)
    assert.equal(responseBody.detail.error, 'job_not_found')
  })

  test('should return 422 for invalid pattern', async ({ assert }) => {
    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '123' },
      request: {
        only: () => ({
          pattern: 'invalid-pattern',
          interval: 1,
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
      },
    }

    await controller.setBatchJobRecurrence(ctx as any)

    assert.equal(responseStatus, 422)
    assert.equal(responseBody.detail.error, 'validation_failed')
    assert.isArray(responseBody.detail.errors)
  })

  test('should return 422 for invalid cron expression', async ({ assert }) => {
    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '123' },
      request: {
        only: () => ({
          pattern: 'custom',
          cron: 'invalid-cron-expression',
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
      },
    }

    await controller.setBatchJobRecurrence(ctx as any)

    assert.equal(responseStatus, 422)
    assert.equal(responseBody.detail.error, 'validation_failed')
    assert.isArray(responseBody.detail.errors)
  })

  test('should return 422 when cron is missing for custom pattern', async ({ assert }) => {
    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '123' },
      request: {
        only: () => ({
          pattern: 'custom',
          // Missing cron field
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
      },
    }

    await controller.setBatchJobRecurrence(ctx as any)

    assert.equal(responseStatus, 422)
    assert.equal(responseBody.detail.error, 'validation_failed')
    assert.isArray(responseBody.detail.errors)
  })
})

test.group('ScreenshotController - Job Cancellation', (group) => {
  let controller: ScreenshotController

  group.setup(() => {
    controller = new ScreenshotController()
  })

  test('should cancel processing job successfully', async ({ assert }) => {
    const mockBatchJob = {
      id: 123,
      status: 'processing',
      totalItems: 5,
      completedItems: 2,
      failedItems: 0,
      progressPercentage: 40,
      createdAt: { toISO: () => '2025-01-26T10:00:00.000Z' },
      updatedAt: { toISO: () => '2025-01-26T10:30:00.000Z' },
      scheduledAt: null,
      completedAt: null,
      estimatedCompletion: null,
      nextScheduledTime: null,
      config: { parallel: 3, timeout: 30000 },
      results: [
        { itemId: 'item1', status: 'success', url: 'https://example.com/item1.png' },
        { itemId: 'item2', status: 'success', url: 'https://example.com/item2.png' },
        { itemId: 'item3', status: 'error', error: 'Job cancelled' },
        { itemId: 'item4', status: 'error', error: 'Job cancelled' },
        { itemId: 'item5', status: 'error', error: 'Job cancelled' },
      ],
      successfulResults: [
        { itemId: 'item1', status: 'success', url: 'https://example.com/item1.png' },
        { itemId: 'item2', status: 'success', url: 'https://example.com/item2.png' },
      ],
      failedResults: [
        { itemId: 'item3', status: 'error', error: 'Job cancelled' },
        { itemId: 'item4', status: 'error', error: 'Job cancelled' },
        { itemId: 'item5', status: 'error', error: 'Job cancelled' },
      ],
      cancel: async function () {
        this.status = 'cancelled'
      },
      save: async () => { },
    }

    BatchJob.find = async () => mockBatchJob as any

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '123' },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
      },
    }

    await controller.cancelBatchJob(ctx as any)

    assert.equal(responseStatus, 200)
    assert.equal(responseBody.job_id, '123')
    assert.equal(responseBody.status, 'cancelled')
    assert.equal(responseBody.total, 5)
    assert.equal(responseBody.completed, 2)
    assert.equal(responseBody.failed, 0)
    assert.equal(responseBody.progress_percentage, 40)
    assert.isArray(responseBody.results)
    assert.isArray(responseBody.successful_results)
    assert.isArray(responseBody.failed_results)
  })

  test('should return 404 for non-existent job', async ({ assert }) => {
    BatchJob.find = async () => null

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '999' },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
      },
    }

    await controller.cancelBatchJob(ctx as any)

    assert.equal(responseStatus, 404)
    assert.equal(responseBody.detail.error, 'job_not_found')
  })

  test('should return 400 for already completed job', async ({ assert }) => {
    const mockBatchJob = {
      id: 123,
      status: 'completed',
    }

    BatchJob.find = async () => mockBatchJob as any

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '123' },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
      },
    }

    await controller.cancelBatchJob(ctx as any)

    assert.equal(responseStatus, 400)
    assert.equal(responseBody.detail.error, 'job_already_completed')
  })

  test('should return 400 for already failed job', async ({ assert }) => {
    const mockBatchJob = {
      id: 123,
      status: 'failed',
    }

    BatchJob.find = async () => mockBatchJob as any

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '123' },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
      },
    }

    await controller.cancelBatchJob(ctx as any)

    assert.equal(responseStatus, 400)
    assert.equal(responseBody.detail.error, 'job_already_failed')
  })

  test('should return 400 for already cancelled job', async ({ assert }) => {
    const mockBatchJob = {
      id: 123,
      status: 'cancelled',
    }

    BatchJob.find = async () => mockBatchJob as any

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '123' },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
      },
    }

    await controller.cancelBatchJob(ctx as any)

    assert.equal(responseStatus, 400)
    assert.equal(responseBody.detail.error, 'job_already_cancelled')
  })

  test('should return 400 for missing job_id', async ({ assert }) => {
    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: {},
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
      },
    }

    await controller.cancelBatchJob(ctx as any)

    assert.equal(responseStatus, 400)
    assert.equal(responseBody.detail.error, 'missing_job_id')
  })
})

test.group('ScreenshotController - Job Results', (group) => {
  let controller: ScreenshotController

  group.setup(() => {
    controller = new ScreenshotController()
  })

  test('should return detailed job results successfully', async ({ assert }) => {
    const mockBatchJob = {
      id: 123,
      status: 'completed',
      totalItems: 3,
      completedItems: 2,
      failedItems: 1,
      createdAt: { toISO: () => '2025-01-26T10:00:00.000Z', diff: () => ({ as: () => 0 }) },
      completedAt: {
        toISO: () => '2025-01-26T10:05:00.000Z',
        diff: (_other: any) => ({ as: () => 300000 }) // 5 minutes
      },
      results: [
        { itemId: 'item1', status: 'success', url: 'https://example.com/item1.png', cached: false },
        { itemId: 'item2', status: 'success', url: 'https://example.com/item2.png', cached: true },
        { itemId: 'item3', status: 'error', error: 'Failed to load page', cached: undefined },
      ],
      successfulResults: [
        { itemId: 'item1', status: 'success', url: 'https://example.com/item1.png' },
        { itemId: 'item2', status: 'success', url: 'https://example.com/item2.png' },
      ],
      failedResults: [
        { itemId: 'item3', status: 'error', error: 'Failed to load page' },
      ],
    }

    BatchJob.find = async () => mockBatchJob as any

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '123' },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
      },
    }

    await controller.getBatchJobResults(ctx as any)

    assert.equal(responseStatus, 200)
    assert.equal(responseBody.job_id, '123')
    assert.equal(responseBody.status, 'completed')
    assert.equal(responseBody.total, 3)
    assert.equal(responseBody.succeeded, 2)
    assert.equal(responseBody.failed, 1)
    assert.equal(responseBody.processing_time, 300) // 300 seconds (converted from 300000ms)
    assert.lengthOf(responseBody.results, 3)

    // Check result format
    assert.equal(responseBody.results[0].id, 'item1')
    assert.equal(responseBody.results[0].status, 'success')
    assert.equal(responseBody.results[0].url, 'https://example.com/item1.png')
    assert.equal(responseBody.results[0].cached, false)
    assert.isUndefined(responseBody.results[0].error)

    assert.equal(responseBody.results[2].id, 'item3')
    assert.equal(responseBody.results[2].status, 'error')
    assert.equal(responseBody.results[2].error, 'Failed to load page')
    assert.isUndefined(responseBody.results[2].url)
  })

  test('should return results for processing job with current processing time', async ({ assert }) => {
    const mockBatchJob = {
      id: 124,
      status: 'processing',
      totalItems: 2,
      completedItems: 1,
      failedItems: 0,
      createdAt: {
        toISO: () => '2025-01-26T10:00:00.000Z',
        diff: () => ({ as: () => 0 })
      },
      completedAt: null,
      results: [
        { itemId: 'item1', status: 'success', url: 'https://example.com/item1.png', cached: false },
        { itemId: 'item2', status: 'pending', url: undefined, error: undefined, cached: undefined },
      ],
      successfulResults: [
        { itemId: 'item1', status: 'success', url: 'https://example.com/item1.png' },
      ],
      failedResults: [],
    }

    // Mock DateTime.now() to return a specific time for consistent testing

    BatchJob.find = async () => mockBatchJob as any

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '124' },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
      },
    }

    await controller.getBatchJobResults(ctx as any)

    assert.equal(responseStatus, 200)
    assert.equal(responseBody.job_id, '124')
    assert.equal(responseBody.status, 'processing')
    assert.equal(responseBody.total, 2)
    assert.equal(responseBody.succeeded, 1)
    assert.equal(responseBody.failed, 0)
    assert.isNumber(responseBody.processing_time)
    assert.lengthOf(responseBody.results, 2)
  })

  test('should return 404 for non-existent job', async ({ assert }) => {
    BatchJob.find = async () => null

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: { job_id: '999' },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
      },
    }

    await controller.getBatchJobResults(ctx as any)

    assert.equal(responseStatus, 404)
    assert.equal(responseBody.detail.error, 'job_not_found')
  })

  test('should return 400 for missing job_id', async ({ assert }) => {
    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: {},
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
      },
    }

    await controller.getBatchJobResults(ctx as any)

    assert.equal(responseStatus, 400)
    assert.equal(responseBody.detail.error, 'missing_job_id')
  })
})

test.group('ScreenshotController - Cache Statistics', (group) => {
  let controller: ScreenshotController

  group.setup(() => {
    controller = new ScreenshotController()
  })

  test('should return cache statistics successfully', async ({ assert }) => {
    const mockStats = {
      enabled: true,
      size: 1024,
      max_size: 10240,
      ttl: 3600,
      hits: 150,
      misses: 50,
      hit_rate: 0.75,
      cleanup_interval: 300,
    }

    cacheService.getEnhancedStats = async () => mockStats

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
      },
    }

    await controller.getCacheStats(ctx as any)

    assert.equal(responseStatus, 200)
    assert.equal(responseBody.enabled, true)
    assert.equal(responseBody.size, 1024)
    assert.equal(responseBody.max_size, 10240)
    assert.equal(responseBody.ttl, 3600)
    assert.equal(responseBody.hits, 150)
    assert.equal(responseBody.misses, 50)
    assert.equal(responseBody.hit_rate, 0.75)
    assert.equal(responseBody.cleanup_interval, 300)
  })

  test('should return cache statistics when cache is disabled', async ({ assert }) => {
    const mockStats = {
      enabled: false,
      size: 0,
      max_size: 0,
      ttl: 0,
      hits: 0,
      misses: 0,
      hit_rate: 0,
      cleanup_interval: 0,
    }

    cacheService.getEnhancedStats = async () => mockStats

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
      },
    }

    await controller.getCacheStats(ctx as any)

    assert.equal(responseStatus, 200)
    assert.equal(responseBody.enabled, false)
    assert.equal(responseBody.size, 0)
    assert.equal(responseBody.hits, 0)
    assert.equal(responseBody.misses, 0)
    assert.equal(responseBody.hit_rate, 0)
  })

  test('should handle cache service errors gracefully', async ({ assert }) => {
    cacheService.getEnhancedStats = async () => {
      throw new Error('Cache service unavailable')
    }

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        url: () => '/api/cache/stats',
        method: () => 'GET',
        header: (name: string) => name === 'user-agent' ? 'test-agent' : undefined,
        ip: () => '127.0.0.1',
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
      },
    }

    await controller.getCacheStats(ctx as any)

    assert.equal(responseStatus, 500)
    assert.equal(responseBody.detail.error, 'cache_stats_failed')
  })
})

test.group('ScreenshotController - Cache Clear', (group) => {
  let controller: ScreenshotController

  group.setup(() => {
    controller = new ScreenshotController()
  })

  test('should clear cache successfully', async ({ assert }) => {
    cacheService.flush = async () => { }

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        send: (data: any) => {
          responseBody = data
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        },
      },
    }

    await controller.clearCache(ctx as any)

    assert.equal(responseStatus, 204)
    assert.equal(responseBody, '')
  })

  test('should handle cache flush errors gracefully', async ({ assert }) => {
    cacheService.flush = async () => {
      throw new Error('Cache flush failed')
    }

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        url: () => '/api/cache/clear',
        method: () => 'DELETE',
        header: (name: string) => name === 'user-agent' ? 'test-agent' : undefined,
        ip: () => '127.0.0.1',
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
      },
    }

    await controller.clearCache(ctx as any)

    assert.equal(responseStatus, 500)
    assert.equal(responseBody.detail.error, 'cache_clear_failed')
  })
})

test.group('ScreenshotController - Cache URL Invalidation', (group) => {
  let controller: ScreenshotController

  group.setup(() => {
    controller = new ScreenshotController()
  })

  test('should invalidate cache for valid URL successfully', async ({ assert }) => {
    cacheService.invalidateByUrl = async () => 3

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        input: (key: string) => key === 'url' ? 'https://example.com' : undefined,
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
      },
    }

    await controller.invalidateCacheUrl(ctx as any)

    assert.equal(responseStatus, 200)
    assert.equal(responseBody.invalidated, 3)
  })

  test('should return 0 when no cache entries found for URL', async ({ assert }) => {
    cacheService.invalidateByUrl = async () => 0

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        input: (key: string) => key === 'url' ? 'https://nonexistent.com' : undefined,
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
      },
    }

    await controller.invalidateCacheUrl(ctx as any)

    assert.equal(responseStatus, 200)
    assert.equal(responseBody.invalidated, 0)
  })

  test('should return 422 for missing URL parameter', async ({ assert }) => {
    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        input: (_key: string) => undefined,
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
      },
    }

    await controller.invalidateCacheUrl(ctx as any)

    assert.equal(responseStatus, 422)
    assert.equal(responseBody.detail.error, 'validation_failed')
    assert.include(responseBody.detail.message, 'url parameter is required')
  })

  test('should return 422 for invalid URL format', async ({ assert }) => {
    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        input: (key: string) => key === 'url' ? 'invalid-url-format' : undefined,
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
      },
    }

    await controller.invalidateCacheUrl(ctx as any)

    assert.equal(responseStatus, 422)
    assert.equal(responseBody.detail.error, 'validation_failed')
    assert.include(responseBody.detail.message, 'valid URL')
  })

  test('should handle cache invalidation errors gracefully', async ({ assert }) => {
    cacheService.invalidateByUrl = async () => {
      throw new Error('Cache invalidation failed')
    }

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        input: (key: string) => key === 'url' ? 'https://example.com' : undefined,
        url: () => '/api/cache/invalidate',
        method: () => 'DELETE',
        header: (name: string) => name === 'user-agent' ? 'test-agent' : undefined,
        ip: () => '127.0.0.1',
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
      },
    }

    await controller.invalidateCacheUrl(ctx as any)

    assert.equal(responseStatus, 500)
    assert.equal(responseBody.detail.error, 'cache_invalidation_failed')
  })
})

