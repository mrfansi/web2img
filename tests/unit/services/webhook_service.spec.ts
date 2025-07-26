import { test } from '@japa/runner'
import { WebhookService } from '#services/webhook_service'
import type { WebhookPayload } from '#services/webhook_service'
import type { WebhookData } from '../../../app/types/screenshot.js'

// Mock fetch globally
const mockFetch = {
  ok: true,
  status: 200,
  text: async () => 'OK',
  json: async () => ({}),
}

global.fetch = async () => mockFetch as any

test.group('WebhookService', (group) => {
  let webhookService: WebhookService

  group.setup(() => {
    webhookService = WebhookService.getInstance()
  })

  group.teardown(() => {
    // Reset fetch mock
    global.fetch = async () => mockFetch as any
  })

  test('should be a singleton', ({ assert }) => {
    const instance1 = WebhookService.getInstance()
    const instance2 = WebhookService.getInstance()

    assert.strictEqual(instance1, instance2)
  })

  test('should validate webhook URLs correctly', ({ assert }) => {
    // Valid URLs
    assert.isTrue(webhookService.validateWebhookUrl('https://example.com/webhook'))
    assert.isTrue(webhookService.validateWebhookUrl('http://api.example.com/hooks'))
    assert.isTrue(webhookService.validateWebhookUrl('https://subdomain.example.org/path/to/webhook'))

    // Invalid URLs
    assert.isFalse(webhookService.validateWebhookUrl('ftp://example.com/webhook'))
    assert.isFalse(webhookService.validateWebhookUrl('javascript:alert(1)'))
    assert.isFalse(webhookService.validateWebhookUrl('not-a-url'))
    assert.isFalse(webhookService.validateWebhookUrl(''))

    // Localhost and private IPs should be rejected
    assert.isFalse(webhookService.validateWebhookUrl('http://localhost/webhook'))
    assert.isFalse(webhookService.validateWebhookUrl('https://127.0.0.1/webhook'))
    assert.isFalse(webhookService.validateWebhookUrl('http://192.168.1.1/webhook'))
    assert.isFalse(webhookService.validateWebhookUrl('https://10.0.0.1/webhook'))
    assert.isFalse(webhookService.validateWebhookUrl('http://172.16.0.1/webhook'))
  })

  test('should create batch completion payload correctly', ({ assert }) => {
    const jobId = 'test-job-123'
    const createdAt = new Date('2024-01-01T10:00:00Z')
    const completedAt = new Date('2024-01-01T10:05:00Z')
    const results = [
      {
        itemId: 'item-1',
        status: 'success' as const,
        url: 'https://example.com/image1.png',
        cached: false,
        processingTime: 2000
      },
      {
        itemId: 'item-2',
        status: 'error' as const,
        error: 'Failed to capture screenshot',
        processingTime: 1500
      }
    ]

    const payload = webhookService.createBatchCompletionPayload(
      jobId,
      'completed',
      2,
      1,
      1,
      createdAt,
      completedAt,
      results
    )

    assert.equal(payload.job_id, jobId)
    assert.equal(payload.status, 'completed')
    assert.equal(payload.total, 2)
    assert.equal(payload.completed, 1)
    assert.equal(payload.failed, 1)
    assert.equal(payload.created_at, '2024-01-01T10:00:00.000Z')
    assert.equal(payload.completed_at, '2024-01-01T10:05:00.000Z')
    assert.equal(payload.processing_time, 300000) // 5 minutes in milliseconds
    assert.deepEqual(payload.results, results)
  })

  test('should send webhook successfully', async ({ assert }) => {
    // Mock successful response
    global.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => 'OK'
    }) as any

    const payload: WebhookPayload = {
      job_id: 'test-job',
      status: 'completed',
      total: 1,
      completed: 1,
      failed: 0,
      created_at: '2024-01-01T10:00:00Z',
      completed_at: '2024-01-01T10:01:00Z',
      processing_time: 60000,
      results: []
    }

    const result = await webhookService.sendWebhook(
      'https://example.com/webhook',
      payload
    )

    assert.isTrue(result.success)
    assert.equal(result.statusCode, 200)
    assert.equal(result.attempt, 1)
    assert.isUndefined(result.error)
    assert.instanceOf(result.deliveredAt, Date)
  })

  test('should send webhook with authentication header', async ({ assert }) => {
    let capturedHeaders: Record<string, string> = {}

    // Mock fetch to capture headers
    global.fetch = async (_input: string | URL | Request, options: any) => {
      capturedHeaders = options?.headers || {}
      return {
        ok: true,
        status: 200,
        text: async () => 'OK'
      } as Response
    }

    const payload: WebhookPayload = {
      job_id: 'test-job',
      status: 'completed',
      total: 1,
      completed: 1,
      failed: 0,
      created_at: '2024-01-01T10:00:00Z',
      completed_at: '2024-01-01T10:01:00Z',
      processing_time: 60000,
      results: []
    }

    await webhookService.sendWebhook(
      'https://example.com/webhook',
      payload,
      'Bearer secret-token'
    )

    assert.equal(capturedHeaders['Authorization'], 'Bearer secret-token')
    assert.equal(capturedHeaders['Content-Type'], 'application/json')
    assert.equal(capturedHeaders['User-Agent'], 'web2img-webhook/1.0')
  })

  test('should handle webhook delivery failure', async ({ assert }) => {
    // Mock failed response
    global.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    }) as any

    const payload: WebhookPayload = {
      job_id: 'test-job',
      status: 'completed',
      total: 1,
      completed: 1,
      failed: 0,
      created_at: '2024-01-01T10:00:00Z',
      completed_at: '2024-01-01T10:01:00Z',
      processing_time: 60000,
      results: []
    }

    const result = await webhookService.sendWebhook(
      'https://example.com/webhook',
      payload
    )

    assert.isFalse(result.success)
    assert.equal(result.statusCode, 500)
    assert.equal(result.attempt, 1)
    assert.equal(result.error, 'HTTP 500: Internal Server Error')
  })

  test('should handle network errors', async ({ assert }) => {
    // Mock network error
    global.fetch = async () => {
      throw new Error('Network error')
    }

    const payload: WebhookPayload = {
      job_id: 'test-job',
      status: 'completed',
      total: 1,
      completed: 1,
      failed: 0,
      created_at: '2024-01-01T10:00:00Z',
      completed_at: '2024-01-01T10:01:00Z',
      processing_time: 60000,
      results: []
    }

    const result = await webhookService.sendWebhook(
      'https://example.com/webhook',
      payload
    )

    assert.isFalse(result.success)
    assert.isUndefined(result.statusCode)
    assert.equal(result.error, 'Network error')
  })

  test('should reject invalid webhook URLs', async ({ assert }) => {
    const payload: WebhookPayload = {
      job_id: 'test-job',
      status: 'completed',
      total: 1,
      completed: 1,
      failed: 0,
      created_at: '2024-01-01T10:00:00Z',
      completed_at: '2024-01-01T10:01:00Z',
      processing_time: 60000,
      results: []
    }

    const result = await webhookService.sendWebhook('invalid-url', payload)

    assert.isFalse(result.success)
    assert.include(result.error!, 'Invalid webhook URL')
  })

  test('should retry webhook delivery with exponential backoff', async ({ assert }) => {
    let attemptCount = 0
    const delays: number[] = []
    let lastCallTime = Date.now()

    // Mock failed responses for first 2 attempts, then success
    global.fetch = async () => {
      const currentTime = Date.now()
      if (attemptCount > 0) {
        delays.push(currentTime - lastCallTime)
      }
      lastCallTime = currentTime
      attemptCount++

      if (attemptCount <= 2) {
        return {
          ok: false,
          status: 500,
          text: async () => 'Server Error'
        } as any
      }

      return {
        ok: true,
        status: 200,
        text: async () => 'OK'
      } as any
    }

    const webhookData: WebhookData = {
      url: 'https://example.com/webhook',
      payload: {
        job_id: 'test-job',
        status: 'completed',
        total: 1,
        completed: 1,
        failed: 0,
        created_at: '2024-01-01T10:00:00Z',
        completed_at: '2024-01-01T10:01:00Z',
        processing_time: 60000,
        results: []
      },
      maxRetries: 5
    }

    const result = await webhookService.retryWebhook(webhookData, 1)

    assert.isTrue(result.success)
    assert.equal(result.attempt, 3) // Should succeed on 3rd attempt
    assert.equal(attemptCount, 3)

    // Check that delays follow exponential backoff pattern (with some tolerance)
    assert.isAbove(delays[0], 800) // ~1000ms for attempt 2 (with tolerance)
    assert.isBelow(delays[0], 2200) // Allow for some variance
    assert.isAbove(delays[1], 1800) // ~2000ms for attempt 3 (with tolerance)
    assert.isBelow(delays[1], 4200) // Allow for some variance
  }).timeout(10000)

  test('should stop retrying after max attempts', async ({ assert }) => {
    let attemptCount = 0

    // Mock always failing responses
    global.fetch = async () => {
      attemptCount++
      return {
        ok: false,
        status: 500,
        text: async () => 'Server Error'
      } as any
    }

    const webhookData: WebhookData = {
      url: 'https://example.com/webhook',
      payload: {
        job_id: 'test-job',
        status: 'completed',
        total: 1,
        completed: 1,
        failed: 0,
        created_at: '2024-01-01T10:00:00Z',
        completed_at: '2024-01-01T10:01:00Z',
        processing_time: 60000,
        results: []
      },
      maxRetries: 3
    }

    const result = await webhookService.retryWebhook(webhookData, 4) // Start at attempt 4

    assert.isFalse(result.success)
    assert.equal(result.attempt, 4)
    assert.include(result.error!, 'Maximum retry attempts')
    assert.equal(attemptCount, 0) // Should not make any HTTP calls
  }).timeout(1000)

  test('should deliver webhook with automatic retry and tracking', async ({ assert }) => {
    let attemptCount = 0

    // Mock failed first attempt, then success
    global.fetch = async () => {
      attemptCount++
      if (attemptCount === 1) {
        return {
          ok: false,
          status: 503,
          text: async () => 'Service Unavailable'
        } as any
      }

      return {
        ok: true,
        status: 200,
        text: async () => 'OK'
      } as any
    }

    const webhookData: WebhookData = {
      url: 'https://example.com/webhook',
      payload: {
        job_id: 'test-job-tracking',
        status: 'completed',
        total: 1,
        completed: 1,
        failed: 0,
        created_at: '2024-01-01T10:00:00Z',
        completed_at: '2024-01-01T10:01:00Z',
        processing_time: 60000,
        results: []
      },
      maxRetries: 3
    }

    const result = await webhookService.deliverWebhook(webhookData)

    assert.isTrue(result.success)
    assert.equal(result.attempt, 2) // Should succeed on 2nd attempt
    assert.equal(attemptCount, 2)
  }).timeout(5000)

  test('should not retry if maxRetries is 1', async ({ assert }) => {
    let attemptCount = 0

    // Mock always failing responses
    global.fetch = async () => {
      attemptCount++
      return {
        ok: false,
        status: 500,
        text: async () => 'Server Error'
      } as any
    }

    const webhookData: WebhookData = {
      url: 'https://example.com/webhook',
      payload: {
        job_id: 'test-job',
        status: 'completed',
        total: 1,
        completed: 1,
        failed: 0,
        created_at: '2024-01-01T10:00:00Z',
        completed_at: '2024-01-01T10:01:00Z',
        processing_time: 60000,
        results: []
      },
      maxRetries: 1
    }

    const result = await webhookService.deliverWebhook(webhookData)

    assert.isFalse(result.success)
    assert.equal(result.attempt, 1)
    assert.equal(attemptCount, 1) // Should only make one attempt
  })
})