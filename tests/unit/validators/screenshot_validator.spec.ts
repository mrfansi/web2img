import { test } from '@japa/runner'
import {
  singleScreenshotValidator,
  batchScreenshotValidator,
  batchStatusValidator,
  validateBatchRequest,
  validateSingleScreenshotRequest,
  validateWebhookAuth,
  validateRecurrence,
  validateScheduledTime,
  validateBatchDimensions,
} from '#validators/screenshot_validator'

test.group('Single Screenshot Validator', () => {
  test('should validate valid single screenshot request', async ({ assert }) => {
    const data = {
      url: 'https://example.com',
      format: 'png',
      width: 1280,
      height: 720,
      timeout: 30000,
      cache: true,
    }

    const result = await singleScreenshotValidator.validate(data)

    assert.equal(result.url, 'https://example.com')
    assert.equal(result.format, 'png')
    assert.equal(result.width, 1280)
    assert.equal(result.height, 720)
    assert.equal(result.timeout, 30000)
    assert.isTrue(result.cache)
  })

  test('should validate minimal single screenshot request', async ({ assert }) => {
    const data = {
      url: 'https://example.com',
    }

    const result = await singleScreenshotValidator.validate(data)

    assert.equal(result.url, 'https://example.com')
    assert.isUndefined(result.format)
    assert.isUndefined(result.width)
    assert.isUndefined(result.height)
  })

  test('should reject invalid URL', async ({ assert }) => {
    const data = {
      url: 'not-a-url',
    }

    await assert.rejects(() => singleScreenshotValidator.validate(data))
  })

  test('should reject invalid format', async ({ assert }) => {
    const data = {
      url: 'https://example.com',
      format: 'gif',
    }

    await assert.rejects(() => singleScreenshotValidator.validate(data))
  })

  test('should reject width out of range', async ({ assert }) => {
    const data = {
      url: 'https://example.com',
      width: 6000,
    }

    await assert.rejects(() => singleScreenshotValidator.validate(data))
  })

  test('should reject height out of range', async ({ assert }) => {
    const data = {
      url: 'https://example.com',
      height: 0,
    }

    await assert.rejects(() => singleScreenshotValidator.validate(data))
  })

  test('should reject timeout out of range', async ({ assert }) => {
    const data = {
      url: 'https://example.com',
      timeout: 3000, // Less than 5000
    }

    await assert.rejects(() => singleScreenshotValidator.validate(data))
  })
})

test.group('Batch Screenshot Validator', () => {
  test('should validate valid batch request', async ({ assert }) => {
    const data = {
      items: [
        {
          id: 'item-1',
          url: 'https://example.com',
          format: 'png',
          width: 1280,
          height: 720,
        },
        {
          id: 'item-2',
          url: 'https://google.com',
        },
      ],
      config: {
        parallel: 3,
        timeout: 30000,
        webhook_url: 'https://webhook.example.com',
        webhook_auth: 'Bearer token123',
        cache: true,
        priority: 'high',
      },
    }

    const result = await batchScreenshotValidator.validate(data)

    assert.equal(result.items.length, 2)
    assert.equal(result.items[0].id, 'item-1')
    assert.equal(result.items[0].url, 'https://example.com')
    assert.equal(result.config?.parallel, 3)
    assert.equal(result.config?.webhook_url, 'https://webhook.example.com')
  })

  test('should validate minimal batch request', async ({ assert }) => {
    const data = {
      items: [
        {
          id: 'item-1',
          url: 'https://example.com',
        },
      ],
    }

    const result = await batchScreenshotValidator.validate(data)

    assert.equal(result.items.length, 1)
    assert.isUndefined(result.config)
  })

  test('should reject empty items array', async ({ assert }) => {
    const data = {
      items: [],
    }

    await assert.rejects(() => batchScreenshotValidator.validate(data))
  })

  test('should reject too many items', async ({ assert }) => {
    const items = Array.from({ length: 201 }, (_, i) => ({
      id: `item-${i}`,
      url: 'https://example.com',
    }))

    const data = { items }

    await assert.rejects(() => batchScreenshotValidator.validate(data))
  })

  test('should reject invalid item URL', async ({ assert }) => {
    const data = {
      items: [
        {
          id: 'item-1',
          url: 'invalid-url',
        },
      ],
    }

    await assert.rejects(() => batchScreenshotValidator.validate(data))
  })

  test('should reject missing item id', async ({ assert }) => {
    const data = {
      items: [
        {
          url: 'https://example.com',
        },
      ],
    }

    await assert.rejects(() => batchScreenshotValidator.validate(data))
  })

  test('should reject invalid parallel value', async ({ assert }) => {
    const data = {
      items: [
        {
          id: 'item-1',
          url: 'https://example.com',
        },
      ],
      config: {
        parallel: 100, // Too high
      },
    }

    await assert.rejects(() => batchScreenshotValidator.validate(data))
  })

  test('should reject invalid priority', async ({ assert }) => {
    const data = {
      items: [
        {
          id: 'item-1',
          url: 'https://example.com',
        },
      ],
      config: {
        priority: 'urgent', // Invalid priority
      },
    }

    await assert.rejects(() => batchScreenshotValidator.validate(data))
  })
})

test.group('Batch Status Validator', () => {
  test('should validate valid job_id', async ({ assert }) => {
    const data = {
      job_id: 'job-123',
    }

    const result = await batchStatusValidator.validate(data)

    assert.equal(result.job_id, 'job-123')
  })

  test('should reject empty job_id', async ({ assert }) => {
    const data = {
      job_id: '',
    }

    await assert.rejects(() => batchStatusValidator.validate(data))
  })
})

test.group('Custom Validation Functions', () => {
  test('validateWebhookAuth should pass when both webhook and webhook_auth are provided', ({
    assert,
  }) => {
    const data = {
      config: {
        webhook_url: 'https://example.com/webhook',
        webhook_auth: 'Bearer token',
      },
    }

    assert.doesNotThrow(() => validateWebhookAuth(data))
  })

  test('validateWebhookAuth should pass when neither webhook nor webhook_auth are provided', ({
    assert,
  }) => {
    const data = {
      config: {},
    }

    assert.doesNotThrow(() => validateWebhookAuth(data))
  })

  test('validateWebhookAuth should throw when webhook is provided without webhook_auth', ({
    assert,
  }) => {
    const data = {
      config: {
        webhook_url: 'https://example.com/webhook',
      },
    }

    assert.throws(
      () => validateWebhookAuth(data),
      'webhook_auth is required when webhook is provided'
    )
  })

  test('validateRecurrence should pass for valid hourly recurrence', ({ assert }) => {
    const data = {
      config: {
        recurrence: 'hourly',
        recurrence_interval: 2,
      },
    }

    assert.doesNotThrow(() => validateRecurrence(data))
  })

  test('validateRecurrence should pass for valid custom recurrence with cron', ({ assert }) => {
    const data = {
      config: {
        recurrence: 'custom',
        recurrence_cron: '0 0 * * *',
      },
    }

    assert.doesNotThrow(() => validateRecurrence(data))
  })

  test('validateRecurrence should throw when custom recurrence lacks cron', ({ assert }) => {
    const data = {
      config: {
        recurrence: 'custom',
      },
    }

    assert.throws(
      () => validateRecurrence(data),
      'recurrence_cron is required when recurrence is "custom"'
    )
  })

  test('validateRecurrence should throw when non-custom recurrence has cron', ({ assert }) => {
    const data = {
      config: {
        recurrence: 'daily',
        recurrence_cron: '0 0 * * *',
      },
    }

    assert.throws(
      () => validateRecurrence(data),
      'recurrence_cron can only be used when recurrence is "custom"'
    )
  })

  test('validateRecurrence should throw when recurrence_count is too high', ({ assert }) => {
    const data = {
      config: {
        recurrence: 'daily',
        recurrence_count: 2000,
      },
    }

    assert.throws(() => validateRecurrence(data), 'recurrence_count cannot exceed 1000')
  })

  test('validateScheduledTime should pass for future time', ({ assert }) => {
    const futureTime = new Date(Date.now() + 3600000) // 1 hour from now
    const data = {
      config: {
        scheduled_time: futureTime.toISOString(),
      },
    }

    assert.doesNotThrow(() => validateScheduledTime(data))
  })

  test('validateScheduledTime should throw for past time', ({ assert }) => {
    const pastTime = new Date(Date.now() - 3600000) // 1 hour ago
    const data = {
      config: {
        scheduled_time: pastTime.toISOString(),
      },
    }

    assert.throws(() => validateScheduledTime(data), 'scheduled_time must be in the future')
  })

  test('validateBatchDimensions should pass for reasonable dimensions', ({ assert }) => {
    const data = {
      items: [
        {
          id: 'item-1',
          url: 'https://example.com',
          width: 1920,
          height: 1080,
        },
      ],
    }

    assert.doesNotThrow(() => validateBatchDimensions(data))
  })

  test('validateBatchDimensions should throw for excessive dimensions', ({ assert }) => {
    const data = {
      items: [
        {
          id: 'item-1',
          url: 'https://example.com',
          width: 10000,
          height: 10000, // 100 megapixels
        },
      ],
    }

    assert.throws(
      () => validateBatchDimensions(data),
      'Item item-1: dimensions too large (max 25 megapixels)'
    )
  })
})

test.group('Comprehensive Validation Functions', () => {
  test('validateSingleScreenshotRequest should pass for valid request', async ({ assert }) => {
    const data = {
      url: 'https://example.com',
      width: 1920,
      height: 1080,
    }

    const result = await validateSingleScreenshotRequest(data)

    assert.equal(result.url, 'https://example.com')
    assert.equal(result.width, 1920)
    assert.equal(result.height, 1080)
  })

  test('validateSingleScreenshotRequest should throw for excessive dimensions', async ({
    assert,
  }) => {
    const data = {
      url: 'https://example.com',
      width: 10000,
      height: 10000, // 100 megapixels
    }

    await assert.rejects(() => validateSingleScreenshotRequest(data))
  })

  test('validateBatchRequest should pass for valid request', async ({ assert }) => {
    const data = {
      items: [
        {
          id: 'item-1',
          url: 'https://example.com',
        },
      ],
      config: {
        webhook_url: 'https://webhook.example.com',
        webhook_auth: 'Bearer token',
      },
    }

    const result = await validateBatchRequest(data)

    assert.equal(result.items.length, 1)
    assert.equal(result.config?.webhook_url, 'https://webhook.example.com')
  })

  test('validateBatchRequest should throw for missing webhook_auth', async ({ assert }) => {
    const data = {
      items: [
        {
          id: 'item-1',
          url: 'https://example.com',
        },
      ],
      config: {
        webhook_url: 'https://webhook.example.com',
      },
    }

    await assert.rejects(
      () => validateBatchRequest(data),
      'webhook_auth is required when webhook is provided'
    )
  })

  test('validateBatchRequest should throw for invalid recurrence', async ({ assert }) => {
    const data = {
      items: [
        {
          id: 'item-1',
          url: 'https://example.com',
        },
      ],
      config: {
        recurrence: 'custom',
        // Missing recurrence_cron
      },
    }

    await assert.rejects(
      () => validateBatchRequest(data),
      'recurrence_cron is required when recurrence is "custom"'
    )
  })

  test('validateBatchRequest should throw for past scheduled_time', async ({ assert }) => {
    const pastTime = new Date(Date.now() - 3600000) // 1 hour ago
    const data = {
      items: [
        {
          id: 'item-1',
          url: 'https://example.com',
        },
      ],
      config: {
        scheduled_time: pastTime.toISOString(),
      },
    }

    await assert.rejects(() => validateBatchRequest(data), 'scheduled_time must be in the future')
  })

  test('validateBatchRequest should throw for excessive item dimensions', async ({ assert }) => {
    const data = {
      items: [
        {
          id: 'item-1',
          url: 'https://example.com',
          width: 10000,
          height: 10000,
        },
      ],
    }

    await assert.rejects(() => validateBatchRequest(data))
  })
})
