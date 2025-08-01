import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import logger from '@adonisjs/core/services/logger'
import { randomUUID } from 'node:crypto'
import ErrorLog, { ErrorLevel } from '#models/error_log'

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

      // Log HTTP errors (4xx, 5xx) to database for dashboard
      if (statusCode >= 400) {
        const errorLevel = statusCode >= 500 ? ErrorLevel.ERROR : ErrorLevel.WARN
        const message = `HTTP ${statusCode} - ${request.method()} ${request.url()}`

        try {
          await ErrorLog.logError({
            level: errorLevel,
            message,
            context: {
              statusCode,
              processingTime,
              apiKey: ctx.apiKey?.name || 'unknown',
              responseBody: response.hasLazyBody ? null : response.getBody(),
            },
            endpoint: request.url(),
            method: request.method(),
            userAgent: request.header('user-agent'),
            ipAddress: request.ip(),
            correlationId,
            apiKeyId: ctx.apiKey?.id || null,
          })
        } catch (dbError) {
          logger.error('Failed to save HTTP error to database', { dbError })
        }
      }
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

      // Save request-level errors to database for dashboard
      try {
        await ErrorLog.logError({
          level: ErrorLevel.ERROR,
          message: `Request failed: ${error.message}`,
          stack: error.stack,
          context: {
            processingTime,
            apiKey: ctx.apiKey?.name || 'unknown',
            errorName: error.name,
          },
          endpoint: request.url(),
          method: request.method(),
          userAgent: request.header('user-agent'),
          ipAddress: request.ip(),
          correlationId,
          apiKeyId: ctx.apiKey?.id || null,
        })
      } catch (dbError) {
        logger.error('Failed to save request error to database', { dbError })
      }

      throw error
    }
  }
}
