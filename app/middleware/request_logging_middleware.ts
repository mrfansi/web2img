import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import logger from '@adonisjs/core/services/logger'
import { randomUUID } from 'node:crypto'

/**
 * Request logging middleware for API endpoints
 * Logs request details and response times with correlation IDs
 */
export default class RequestLoggingMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const { request, response } = ctx
    const startTime = Date.now()

    // Generate correlation ID for request tracking
    const correlationId = randomUUID()
    ctx.correlationId = correlationId

    // Log incoming request
    logger.info('Incoming API request', {
      correlationId,
      method: request.method(),
      url: request.url(),
      userAgent: request.header('user-agent'),
      ip: request.ip(),
      apiKey: ctx.apiKey?.name || 'unknown',
    })

    try {
      // Process request
      await next()

      const processingTime = Date.now() - startTime
      const statusCode = response.getStatus()

      // Log successful response
      logger.info('API request completed', {
        correlationId,
        method: request.method(),
        url: request.url(),
        statusCode,
        processingTime,
        apiKey: ctx.apiKey?.name || 'unknown',
      })
    } catch (error) {
      const processingTime = Date.now() - startTime

      // Log error response
      logger.error('API request failed', {
        correlationId,
        method: request.method(),
        url: request.url(),
        error: error.message,
        processingTime,
        apiKey: ctx.apiKey?.name || 'unknown',
      })

      throw error
    }
  }
}
