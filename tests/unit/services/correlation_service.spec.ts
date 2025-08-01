import { test } from '@japa/runner'
import { CorrelationService } from '#services/correlation_service'

test.group('Correlation Service', () => {
  test('generateCorrelationId should return a valid UUID', ({ assert }) => {
    const correlationId = CorrelationService.generateCorrelationId()

    assert.isString(correlationId)
    assert.lengthOf(correlationId, 36) // UUID v4 length
    assert.match(
      correlationId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })

  test('getOrCreateCorrelationId should use existing correlation ID from header', ({ assert }) => {
    const existingId = 'existing-correlation-id'
    const ctx = {
      request: {
        header: (name: string) => (name === 'x-correlation-id' ? existingId : undefined),
      },
      response: {
        header: () => {},
      },
    } as any

    const correlationId = CorrelationService.getOrCreateCorrelationId(ctx)

    assert.equal(correlationId, existingId)
  })

  test('getOrCreateCorrelationId should use request ID if correlation ID not present', ({
    assert,
  }) => {
    const requestId = 'existing-request-id'
    const ctx = {
      request: {
        header: (name: string) => (name === 'x-request-id' ? requestId : undefined),
      },
      response: {
        header: () => {},
      },
    } as any

    const correlationId = CorrelationService.getOrCreateCorrelationId(ctx)

    assert.equal(correlationId, requestId)
  })

  test('getOrCreateCorrelationId should generate new ID if none exists', ({ assert }) => {
    const ctx = {
      request: {
        header: () => undefined,
      },
      response: {
        header: () => {},
      },
    } as any

    const correlationId = CorrelationService.getOrCreateCorrelationId(ctx)

    assert.isString(correlationId)
    assert.lengthOf(correlationId, 36)
    assert.match(
      correlationId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
  })

  test('getOrCreateCorrelationId should set response header', ({ assert }) => {
    let setHeader: string | undefined
    const ctx = {
      request: {
        header: () => undefined,
      },
      response: {
        header: (_name: string, value: string) => {
          setHeader = value
        },
      },
    } as any

    const correlationId = CorrelationService.getOrCreateCorrelationId(ctx)

    // Verify the response header was set
    assert.equal(setHeader, correlationId)
  })

  test('setCorrelationId should set response header', ({ assert }) => {
    let setHeader: string | undefined
    const ctx = {
      response: {
        header: (_name: string, value: string) => {
          setHeader = value
        },
      },
    } as any
    const correlationId = 'test-correlation-id'

    CorrelationService.setCorrelationId(ctx, correlationId)

    assert.equal(setHeader, correlationId)
  })

  test('getCorrelationId should return correlation ID from header', ({ assert }) => {
    const existingId = 'existing-correlation-id'
    const ctx = {
      request: {
        header: (name: string) => (name === 'x-correlation-id' ? existingId : undefined),
      },
    } as any

    const correlationId = CorrelationService.getCorrelationId(ctx)

    assert.equal(correlationId, existingId)
  })

  test('getCorrelationId should return request ID if correlation ID not present', ({ assert }) => {
    const requestId = 'existing-request-id'
    const ctx = {
      request: {
        header: (name: string) => (name === 'x-request-id' ? requestId : undefined),
      },
    } as any

    const correlationId = CorrelationService.getCorrelationId(ctx)

    assert.equal(correlationId, requestId)
  })

  test('getCorrelationId should return undefined if no ID present', ({ assert }) => {
    const ctx = {
      request: {
        header: () => undefined,
      },
    } as any

    const correlationId = CorrelationService.getCorrelationId(ctx)

    assert.isUndefined(correlationId)
  })

  test('createErrorContext should include request information', ({ assert }) => {
    const ctx = {
      request: {
        header: (name: string) => {
          switch (name) {
            case 'x-correlation-id':
              return 'test-correlation-id'
            case 'user-agent':
              return 'Test User Agent'
            default:
              return undefined
          }
        },
        method: () => 'POST',
        url: () => '/api/screenshot',
        ip: () => '127.0.0.1',
      },
      response: {
        header: () => {},
      },
    } as any

    const errorContext = CorrelationService.createErrorContext(ctx)

    assert.equal(errorContext.correlationId, 'test-correlation-id')
    assert.equal(errorContext.requestId, 'test-correlation-id')
    assert.equal(errorContext.method, 'POST')
    assert.equal(errorContext.url, '/api/screenshot')
    assert.equal(errorContext.userAgent, 'Test User Agent')
    assert.equal(errorContext.ip, '127.0.0.1')
    assert.instanceOf(errorContext.timestamp, Date)
  })

  test('createErrorContext should include additional context', ({ assert }) => {
    const ctx = {
      request: {
        header: () => undefined,
        method: () => 'GET',
        url: () => '/api/test',
        ip: () => '192.168.1.1',
      },
      response: {
        header: () => {},
      },
    } as any

    const additionalContext = {
      userId: 123,
      batchId: 'batch-456',
    }

    const errorContext = CorrelationService.createErrorContext(ctx, additionalContext)

    assert.isString(errorContext.correlationId)
    assert.equal((errorContext as any).userId, 123)
    assert.equal((errorContext as any).batchId, 'batch-456')
    assert.equal(errorContext.method, 'GET')
    assert.equal(errorContext.url, '/api/test')
    assert.equal(errorContext.ip, '192.168.1.1')
  })

  test('createErrorContext should generate correlation ID if not present', ({ assert }) => {
    const ctx = {
      request: {
        header: () => undefined,
        method: () => 'GET',
        url: () => '/api/test',
        ip: () => '127.0.0.1',
      },
      response: {
        header: () => {},
      },
    } as any

    const errorContext = CorrelationService.createErrorContext(ctx)

    assert.isString(errorContext.correlationId)
    assert.lengthOf(errorContext.correlationId, 36)
    assert.equal(errorContext.requestId, errorContext.correlationId)
  })
})
