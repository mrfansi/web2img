import logger from '@adonisjs/core/services/logger'
import ErrorLog, { ErrorLevel } from '#models/error_log'
import type { HttpContext } from '@adonisjs/core/http'

export interface ErrorLogOptions {
  level?: ErrorLevel
  context?: Record<string, any>
  endpoint?: string
  method?: string
  userAgent?: string
  ipAddress?: string
  correlationId?: string
  apiKeyId?: number | null
}

/**
 * Service for logging errors to both application logger and database
 */
export class ErrorLoggingService {
  /**
   * Log an error to both application logger and database
   */
  static async logError(
    error: Error | string,
    options: ErrorLogOptions = {},
    ctx?: HttpContext
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : error
    const errorStack = error instanceof Error ? error.stack : undefined
    const level = options.level || ErrorLevel.ERROR

    // Extract context information from HttpContext if provided
    let contextData = options.context || {}
    let endpoint = options.endpoint
    let method = options.method
    let userAgent = options.userAgent
    let ipAddress = options.ipAddress
    let correlationId = options.correlationId
    let apiKeyId = options.apiKeyId

    if (ctx) {
      endpoint = endpoint || ctx.request.url()
      method = method || ctx.request.method()
      userAgent = userAgent || ctx.request.header('user-agent')
      ipAddress = ipAddress || ctx.request.ip()
      correlationId = correlationId || ctx.correlationId
      apiKeyId = apiKeyId || ctx.apiKey?.id || null
    }

    // Log to application logger
    logger.error('Error occurred', {
      level,
      message: errorMessage,
      stack: errorStack,
      context: contextData,
      endpoint,
      method,
      userAgent,
      ipAddress,
      correlationId,
      apiKeyId,
    })

    // Save to database for dashboard
    try {
      await ErrorLog.logError({
        level,
        message: errorMessage,
        stack: errorStack,
        context: contextData,
        endpoint,
        method,
        userAgent,
        ipAddress,
        correlationId,
        apiKeyId,
      })
    } catch (dbError) {
      logger.error('Failed to save error to database', {
        originalError: errorMessage,
        dbError: dbError instanceof Error ? dbError.message : String(dbError),
      })
    }
  }

  /**
   * Log a warning to both application logger and database
   */
  static async logWarning(
    message: string,
    options: ErrorLogOptions = {},
    ctx?: HttpContext
  ): Promise<void> {
    await this.logError(message, { ...options, level: ErrorLevel.WARN }, ctx)
  }

  /**
   * Log a fatal error to both application logger and database
   */
  static async logFatal(
    error: Error | string,
    options: ErrorLogOptions = {},
    ctx?: HttpContext
  ): Promise<void> {
    await this.logError(error, { ...options, level: ErrorLevel.FATAL }, ctx)
  }

  /**
   * Log an HTTP error based on status code
   */
  static async logHttpError(
    statusCode: number,
    message: string,
    options: ErrorLogOptions = {},
    ctx?: HttpContext
  ): Promise<void> {
    const level = statusCode >= 500 ? ErrorLevel.ERROR : ErrorLevel.WARN
    const errorMessage = `HTTP ${statusCode}: ${message}`

    await this.logError(errorMessage, {
      ...options,
      level,
      context: {
        ...options.context,
        statusCode,
      },
    }, ctx)
  }

  /**
   * Log a controller error with standardized format
   */
  static async logControllerError(
    controllerName: string,
    methodName: string,
    error: Error | string,
    options: ErrorLogOptions = {},
    ctx?: HttpContext
  ): Promise<void> {
    const contextData = {
      ...options.context,
      controller: controllerName,
      method: methodName,
    }

    await this.logError(error, {
      ...options,
      context: contextData,
    }, ctx)
  }
}

export default ErrorLoggingService
