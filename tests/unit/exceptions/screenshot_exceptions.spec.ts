import { test } from '@japa/runner'
import { ErrorCode } from '#types/errors'
import {
  InvalidUrlException,
  ScreenshotFailedException,
  TimeoutException,
  RateLimitedException,
  ServiceOverloadedException,
  StorageErrorException,
  WebhookFailedException,
  BatchTooLargeException,
  InvalidFormatException,
  InvalidDimensionsException,
  UnauthorizedException,
  InvalidApiKeyException,
  CacheErrorException,
  QueueErrorException,
  BrowserErrorException,
  ImgProxyErrorException,
} from '#exceptions/screenshot_exceptions'

test.group('Screenshot Exceptions', () => {
  test('InvalidUrlException should create proper error response', ({ assert }) => {
    const url = 'invalid-url'
    const context = { userId: 123 }
    const exception = new InvalidUrlException(url, context)

    assert.equal(exception.code, ErrorCode.INVALID_URL)
    assert.equal(exception.status, 400)
    assert.include(exception.message, url)

    const response = exception.getErrorResponse()
    assert.equal(response.detail.error, ErrorCode.INVALID_URL)
    assert.include(response.detail.message, url)
    assert.equal(response.detail.context?.url, url)
    assert.equal(response.detail.context?.userId, 123)
  })

  test('ScreenshotFailedException should include failure reason', ({ assert }) => {
    const url = 'https://example.com'
    const reason = 'Page load timeout'
    const exception = new ScreenshotFailedException(url, reason)

    assert.equal(exception.code, ErrorCode.SCREENSHOT_FAILED)
    assert.equal(exception.status, 500)
    assert.include(exception.message, url)
    assert.include(exception.message, reason)

    const response = exception.getErrorResponse()
    assert.equal(response.detail.context?.url, url)
    assert.equal(response.detail.context?.reason, reason)
  })

  test('TimeoutException should include timeout duration', ({ assert }) => {
    const url = 'https://example.com'
    const timeout = 30
    const exception = new TimeoutException(url, timeout)

    assert.equal(exception.code, ErrorCode.TIMEOUT)
    assert.equal(exception.status, 408)
    assert.include(exception.message, url)
    assert.include(exception.message, timeout.toString())

    const response = exception.getErrorResponse()
    assert.equal(response.detail.context?.url, url)
    assert.equal(response.detail.context?.timeout, timeout)
  })

  test('RateLimitedException should include retry_after in response', ({ assert }) => {
    const apiKey = 'test-api-key'
    const retryAfter = 60
    const exception = new RateLimitedException(apiKey, retryAfter)

    assert.equal(exception.code, ErrorCode.RATE_LIMITED)
    assert.equal(exception.status, 429)

    const response = exception.getErrorResponse()
    assert.equal(response.detail.retry_after, retryAfter)
    assert.equal(response.detail.context?.apiKey, apiKey)
    assert.equal(response.detail.context?.retryAfter, retryAfter)
  })

  test('ServiceOverloadedException should include retry_after', ({ assert }) => {
    const retryAfter = 120
    const exception = new ServiceOverloadedException(retryAfter)

    assert.equal(exception.code, ErrorCode.SERVICE_OVERLOADED)
    assert.equal(exception.status, 503)

    const response = exception.getErrorResponse()
    assert.equal(response.detail.retry_after, retryAfter)
    assert.equal(response.detail.context?.retryAfter, retryAfter)
  })

  test('StorageErrorException should include operation details', ({ assert }) => {
    const operation = 'file_upload'
    const reason = 'Disk full'
    const exception = new StorageErrorException(operation, reason)

    assert.equal(exception.code, ErrorCode.STORAGE_ERROR)
    assert.equal(exception.status, 500)
    assert.include(exception.message, operation)
    assert.include(exception.message, reason)

    const response = exception.getErrorResponse()
    assert.equal(response.detail.context?.operation, operation)
    assert.equal(response.detail.context?.reason, reason)
  })

  test('WebhookFailedException should include webhook URL', ({ assert }) => {
    const webhookUrl = 'https://example.com/webhook'
    const reason = 'Connection timeout'
    const exception = new WebhookFailedException(webhookUrl, reason)

    assert.equal(exception.code, ErrorCode.WEBHOOK_FAILED)
    assert.equal(exception.status, 500)
    assert.include(exception.message, webhookUrl)
    assert.include(exception.message, reason)

    const response = exception.getErrorResponse()
    assert.equal(response.detail.context?.webhookUrl, webhookUrl)
    assert.equal(response.detail.context?.reason, reason)
  })

  test('BatchTooLargeException should include item counts', ({ assert }) => {
    const itemCount = 250
    const maxItems = 200
    const exception = new BatchTooLargeException(itemCount, maxItems)

    assert.equal(exception.code, ErrorCode.BATCH_TOO_LARGE)
    assert.equal(exception.status, 400)
    assert.include(exception.message, itemCount.toString())
    assert.include(exception.message, maxItems.toString())

    const response = exception.getErrorResponse()
    assert.equal(response.detail.context?.itemCount, itemCount)
    assert.equal(response.detail.context?.maxItems, maxItems)
  })

  test('InvalidFormatException should include valid formats', ({ assert }) => {
    const format = 'gif'
    const validFormats = ['png', 'jpeg', 'webp']
    const exception = new InvalidFormatException(format, validFormats)

    assert.equal(exception.code, ErrorCode.INVALID_FORMAT)
    assert.equal(exception.status, 400)
    assert.include(exception.message, format)
    assert.include(exception.message, validFormats.join(', '))

    const response = exception.getErrorResponse()
    assert.equal(response.detail.context?.format, format)
    assert.deepEqual(response.detail.context?.validFormats, validFormats)
  })

  test('InvalidDimensionsException should include dimensions', ({ assert }) => {
    const width = 6000
    const height = 4000
    const exception = new InvalidDimensionsException(width, height)

    assert.equal(exception.code, ErrorCode.INVALID_DIMENSIONS)
    assert.equal(exception.status, 400)
    assert.include(exception.message, `${width}x${height}`)

    const response = exception.getErrorResponse()
    assert.equal(response.detail.context?.width, width)
    assert.equal(response.detail.context?.height, height)
  })

  test('UnauthorizedException should handle optional reason', ({ assert }) => {
    const reason = 'Invalid token'
    const exception = new UnauthorizedException(reason)

    assert.equal(exception.code, ErrorCode.UNAUTHORIZED)
    assert.equal(exception.status, 401)
    assert.include(exception.message, reason)

    const response = exception.getErrorResponse()
    assert.equal(response.detail.context?.reason, reason)
  })

  test('InvalidApiKeyException should mask API key in context', ({ assert }) => {
    const apiKey = 'sk-1234567890abcdef'
    const exception = new InvalidApiKeyException(apiKey)

    assert.equal(exception.code, ErrorCode.INVALID_API_KEY)
    assert.equal(exception.status, 401)

    const response = exception.getErrorResponse()
    assert.equal(response.detail.context?.apiKey, 'sk-12345...')
  })

  test('CacheErrorException should include operation details', ({ assert }) => {
    const operation = 'get'
    const reason = 'Redis connection failed'
    const exception = new CacheErrorException(operation, reason)

    assert.equal(exception.code, ErrorCode.CACHE_ERROR)
    assert.equal(exception.status, 500)
    assert.include(exception.message, operation)
    assert.include(exception.message, reason)

    const response = exception.getErrorResponse()
    assert.equal(response.detail.context?.operation, operation)
    assert.equal(response.detail.context?.reason, reason)
  })

  test('QueueErrorException should include operation details', ({ assert }) => {
    const operation = 'add_job'
    const reason = 'Queue is full'
    const exception = new QueueErrorException(operation, reason)

    assert.equal(exception.code, ErrorCode.QUEUE_ERROR)
    assert.equal(exception.status, 500)
    assert.include(exception.message, operation)
    assert.include(exception.message, reason)

    const response = exception.getErrorResponse()
    assert.equal(response.detail.context?.operation, operation)
    assert.equal(response.detail.context?.reason, reason)
  })

  test('BrowserErrorException should include operation details', ({ assert }) => {
    const operation = 'page_navigation'
    const reason = 'Navigation timeout'
    const exception = new BrowserErrorException(operation, reason)

    assert.equal(exception.code, ErrorCode.BROWSER_ERROR)
    assert.equal(exception.status, 500)
    assert.include(exception.message, operation)
    assert.include(exception.message, reason)

    const response = exception.getErrorResponse()
    assert.equal(response.detail.context?.operation, operation)
    assert.equal(response.detail.context?.reason, reason)
  })

  test('ImgProxyErrorException should include operation details', ({ assert }) => {
    const operation = 'url_generation'
    const reason = 'Invalid configuration'
    const exception = new ImgProxyErrorException(operation, reason)

    assert.equal(exception.code, ErrorCode.IMGPROXY_ERROR)
    assert.equal(exception.status, 500)
    assert.include(exception.message, operation)
    assert.include(exception.message, reason)

    const response = exception.getErrorResponse()
    assert.equal(response.detail.context?.operation, operation)
    assert.equal(response.detail.context?.reason, reason)
  })

  test('Exception should handle additional context', ({ assert }) => {
    const url = 'https://example.com'
    const additionalContext = {
      userId: 123,
      batchId: 'batch-456',
      timestamp: new Date(),
    }
    const exception = new InvalidUrlException(url, additionalContext)

    const response = exception.getErrorResponse()
    assert.equal(response.detail.context?.url, url)
    assert.equal(response.detail.context?.userId, 123)
    assert.equal(response.detail.context?.batchId, 'batch-456')
    assert.instanceOf(response.detail.context?.timestamp, Date)
  })
})
