import { test } from '@japa/runner'
import ScreenshotController from '#controllers/screenshot_controller'
import cacheService from '#services/cache_service'
import { screenshotWorkerService } from '#services/screenshot_worker_service'
import fileStorageService from '#services/file_storage_service'
import imgProxyService from '#services/imgproxy_service'
import queueService from '#services/queue_service'
import BatchJob from '#models/batch_job'

test.group('ScreenshotController - Single Screenshot', (group) => {
  let controller: ScreenshotController

  group.setup(() => {
    controller = new ScreenshotController()
  })

  test('should return cached screenshot when available', async ({ assert }) => {
    // Mock cache service to return cached URL
    const mockCachedUrl = 'https://imgproxy.example.com/cached-screenshot.png'
    cacheService.get = async () => mockCachedUrl
    cacheService.generateCacheKey = () => 'test-cache-key'

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        all: () => ({
          url: 'https://example.com',
          format: 'png',
          width: 1280,
          height: 720,
          cache: true
        })
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        }
      }
    }

    await controller.single(ctx as any)

    assert.equal(responseStatus, 200)
    assert.equal(responseBody.url, mockCachedUrl)
    assert.isTrue(responseBody.cached)
  })

  test('should process new screenshot when not cached', async ({ assert }) => {
    // Mock services
    cacheService.get = async () => null
    cacheService.generateCacheKey = () => 'test-cache-key'
    cacheService.isProcessing = async () => false
    cacheService.setProcessingLock = async () => {}
    cacheService.removeProcessingLock = async () => {}
    cacheService.set = async () => {}

    const mockScreenshotResult = {
      buffer: Buffer.from('fake-image-data'),
      format: 'png',
      width: 1280,
      height: 720,
      processingTime: 1000,
      finalUrl: 'https://example.com',
      wasTransformed: false
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
          cache: true
        }),
        input: (key: string) => key === 'url' ? 'https://example.com' : undefined
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        }
      }
    }

    await controller.single(ctx as any)

    assert.equal(responseStatus, 200)
    assert.equal(responseBody.url, mockImgProxyUrl)
    assert.isFalse(responseBody.cached)
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
          cache: true
        })
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        }
      }
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
          format: 'invalid-format'
        }),
        input: (key: string) => key === 'url' ? 'invalid-url' : undefined
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        }
      }
    }

    await controller.single(ctx as any)

    assert.equal(responseStatus, 400)
    assert.equal(responseBody.detail.error, 'validation_failed')
  })

  test('should return 408 for timeout errors', async ({ assert }) => {
    cacheService.get = async () => null
    cacheService.generateCacheKey = () => 'test-cache-key'
    cacheService.isProcessing = async () => false
    cacheService.setProcessingLock = async () => {}
    cacheService.removeProcessingLock = async () => {}

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
          cache: true
        }),
        input: (key: string) => key === 'url' ? 'https://slow-website.com' : undefined
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        }
      }
    }

    await controller.single(ctx as any)

    assert.equal(responseStatus, 408)
    assert.equal(responseBody.detail.error, 'timeout')
  })

  test('should return 400 for HTTP errors', async ({ assert }) => {
    cacheService.get = async () => null
    cacheService.generateCacheKey = () => 'test-cache-key'
    cacheService.isProcessing = async () => false
    cacheService.setProcessingLock = async () => {}
    cacheService.removeProcessingLock = async () => {}

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
          cache: true
        }),
        input: (key: string) => key === 'url' ? 'https://example.com/not-found' : undefined
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        }
      }
    }

    await controller.single(ctx as any)

    assert.equal(responseStatus, 400)
    assert.equal(responseBody.detail.error, 'invalid_url')
  })

  test('should return 500 for storage errors', async ({ assert }) => {
    cacheService.get = async () => null
    cacheService.generateCacheKey = () => 'test-cache-key'
    cacheService.isProcessing = async () => false
    cacheService.setProcessingLock = async () => {}
    cacheService.removeProcessingLock = async () => {}

    const mockScreenshotResult = {
      buffer: Buffer.from('fake-image-data'),
      format: 'png',
      width: 1280,
      height: 720,
      processingTime: 1000,
      finalUrl: 'https://example.com',
      wasTransformed: false
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
          cache: true
        }),
        input: (key: string) => key === 'url' ? 'https://example.com' : undefined
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        }
      }
    }

    await controller.single(ctx as any)

    assert.equal(responseStatus, 500)
    assert.equal(responseBody.detail.error, 'storage_error')
  })

  test('should use default values for optional parameters', async ({ assert }) => {
    cacheService.get = async () => null
    cacheService.generateCacheKey = () => 'test-cache-key'
    cacheService.isProcessing = async () => false
    cacheService.setProcessingLock = async () => {}
    cacheService.removeProcessingLock = async () => {}
    cacheService.set = async () => {}

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
        wasTransformed: false
      }
    }

    fileStorageService.saveFile = async () => 'screenshots/2025/01/26/test.png'
    fileStorageService.getFileUrl = () => 'https://storage.example.com/test.png'
    imgProxyService.generateUrlWithFallback = () => 'https://imgproxy.example.com/test.png'

    let responseStatus = 200

    const ctx = {
      request: {
        all: () => ({
          url: 'https://example.com'
          // No format, width, height, timeout, or cache specified
        }),
        input: (key: string) => key === 'url' ? 'https://example.com' : undefined
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (_data: any) => {
          return ctx.response
        }
      }
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
    cacheService.setProcessingLock = async () => {}
    cacheService.removeProcessingLock = async () => {}

    screenshotWorkerService.processScreenshotJob = async () => ({
      buffer: Buffer.from('fake-image-data'),
      format: 'png',
      width: 1280,
      height: 720,
      processingTime: 1000,
      finalUrl: 'https://example.com',
      wasTransformed: false
    })

    fileStorageService.saveFile = async () => 'screenshots/2025/01/26/test.png'
    fileStorageService.getFileUrl = () => 'https://storage.example.com/test.png'
    imgProxyService.generateUrlWithFallback = () => 'https://imgproxy.example.com/test.png'

    let responseStatus = 200

    const ctx = {
      request: {
        all: () => ({
          url: 'https://example.com',
          cache: false
        }),
        input: (key: string) => key === 'url' ? 'https://example.com' : undefined
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (_data: any) => {
          return ctx.response
        }
      }
    }

    await controller.single(ctx as any)

    assert.equal(responseStatus, 200)
    assert.isFalse(cacheGetCalled)
    assert.isFalse(cacheSetCalled)
  })
})

test.group('ScreenshotController - Batch Screenshots', (group) => {
  let controller: ScreenshotController

  group.setup(() => {
    controller = new ScreenshotController()
  })

  test('should create batch job successfully', async ({ assert }) => {
    // Mock BatchJob.createBatchJob
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
      save: async () => {}
    }

    BatchJob.createBatchJob = async () => mockBatchJob as any

    // Mock queue service
    queueService.addBatchJob = async () => ({ id: 'queue-job-123' } as any)

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        all: () => ({
          items: [
            { id: 'item1', url: 'https://example.com' },
            { id: 'item2', url: 'https://google.com' }
          ],
          config: {
            parallel: 5,
            timeout: 60000,
            cache: true
          }
        })
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        }
      }
    }

    await controller.createBatch(ctx as any)

    assert.equal(responseStatus, 202)
    assert.equal(responseBody.job_id, '123')
    assert.equal(responseBody.status, 'pending')
    assert.equal(responseBody.total, 2)
    assert.equal(responseBody.completed, 0)
    assert.equal(responseBody.failed, 0)
  })

  test('should create scheduled batch job', async ({ assert }) => {
    // Mock BatchJob.createBatchJob
    const mockBatchJob = {
      id: 124,
      status: 'scheduled',
      totalItems: 1,
      completedItems: 0,
      failedItems: 0,
      results: [],
      createdAt: { toISO: () => '2025-01-26T10:00:00.000Z' },
      updatedAt: { toISO: () => '2025-01-26T10:00:00.000Z' },
      scheduledAt: { toISO: () => '2025-01-26T12:00:00.000Z' },
      completedAt: null,
      estimatedCompletion: null,
      save: async () => {}
    }

    BatchJob.createBatchJob = async () => mockBatchJob as any

    // Mock queue service
    queueService.scheduleJob = async () => ({ id: 'scheduled-job-124' } as any)

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        all: () => ({
          items: [
            { id: 'item1', url: 'https://example.com' }
          ],
          config: {
            scheduled_time: '2025-01-26T12:00:00.000Z'
          }
        })
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        }
      }
    }

    await controller.createBatch(ctx as any)

    assert.equal(responseStatus, 202)
    assert.equal(responseBody.job_id, '124')
    assert.equal(responseBody.status, 'scheduled')
    assert.equal(responseBody.scheduled_time, '2025-01-26T12:00:00.000Z')
  })

  test('should return 400 for invalid scheduled time', async ({ assert }) => {
    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        all: () => ({
          items: [
            { id: 'item1', url: 'https://example.com' }
          ],
          config: {
            scheduled_time: 'invalid-date'
          }
        })
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        }
      }
    }

    await controller.createBatch(ctx as any)

    assert.equal(responseStatus, 400)
    assert.equal(responseBody.detail.error, 'invalid_scheduled_time')
  })

  test('should return 400 for validation errors', async ({ assert }) => {
    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      request: {
        all: () => ({
          items: [], // Empty items array should fail validation
          config: {}
        })
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        }
      }
    }

    await controller.createBatch(ctx as any)

    assert.equal(responseStatus, 400)
    assert.equal(responseBody.detail.error, 'validation_failed')
  })

  test('should get batch job status successfully', async ({ assert }) => {
    // Mock BatchJob.find
    const mockBatchJob = {
      id: 123,
      status: 'processing',
      totalItems: 3,
      completedItems: 1,
      failedItems: 0,
      progressPercentage: 33,
      createdAt: { toISO: () => '2025-01-26T10:00:00.000Z' },
      updatedAt: { toISO: () => '2025-01-26T10:05:00.000Z' },
      scheduledAt: null,
      completedAt: null,
      estimatedCompletion: { toISO: () => '2025-01-26T10:10:00.000Z' },
      config: { parallel: 3, timeout: 30000 },
      results: [
        { itemId: 'item1', status: 'success', url: 'https://imgproxy.example.com/item1.png' },
        { itemId: 'item2', status: 'processing' },
        { itemId: 'item3', status: 'pending' }
      ],
      successfulResults: [
        { itemId: 'item1', status: 'success', url: 'https://imgproxy.example.com/item1.png' }
      ],
      failedResults: []
    }

    BatchJob.find = async () => mockBatchJob as any

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: {
        job_id: '123'
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        }
      }
    }

    await controller.getBatchStatus(ctx as any)

    assert.equal(responseStatus, 200)
    assert.equal(responseBody.job_id, '123')
    assert.equal(responseBody.status, 'processing')
    assert.equal(responseBody.total, 3)
    assert.equal(responseBody.completed, 1)
    assert.equal(responseBody.failed, 0)
    assert.equal(responseBody.progress_percentage, 33)
    assert.lengthOf(responseBody.results, 3)
    assert.lengthOf(responseBody.successful_results, 1)
    assert.lengthOf(responseBody.failed_results, 0)
  })

  test('should return 404 for non-existent batch job', async ({ assert }) => {
    // Mock BatchJob.find to return null
    BatchJob.find = async () => null

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: {
        job_id: '999'
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        }
      }
    }

    await controller.getBatchStatus(ctx as any)

    assert.equal(responseStatus, 404)
    assert.equal(responseBody.detail.error, 'job_not_found')
  })

  test('should return 400 for missing job_id', async ({ assert }) => {
    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: {}, // No job_id parameter
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        }
      }
    }

    await controller.getBatchStatus(ctx as any)

    assert.equal(responseStatus, 400)
    assert.equal(responseBody.detail.error, 'missing_job_id')
  })

  test('should handle database errors gracefully', async ({ assert }) => {
    // Mock BatchJob.find to throw an error
    BatchJob.find = async () => {
      throw new Error('Database connection failed')
    }

    let responseStatus = 200
    let responseBody: any = null

    const ctx = {
      params: {
        job_id: '123'
      },
      response: {
        status: (code: number) => {
          responseStatus = code
          return ctx.response
        },
        json: (data: any) => {
          responseBody = data
          return ctx.response
        }
      }
    }

    await controller.getBatchStatus(ctx as any)

    assert.equal(responseStatus, 500)
    assert.equal(responseBody.detail.error, 'status_retrieval_failed')
  })
})