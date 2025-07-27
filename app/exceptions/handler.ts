import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import { HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import { ScreenshotException } from '#exceptions/screenshot_exceptions'
import { CorrelationService } from '#services/correlation_service'
import { ErrorCode } from '#types/errors'

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    const correlationId = CorrelationService.getOrCreateCorrelationId(ctx)

    // Handle screenshot-specific exceptions
    if (error instanceof ScreenshotException) {
      return this.handleScreenshotException(error, ctx, correlationId)
    }

    // Handle validation errors
    if (this.isValidationError(error)) {
      return this.handleValidationError(error, ctx, correlationId)
    }

    // Handle authentication errors
    if (this.isAuthenticationError(error)) {
      return this.handleAuthenticationError(error, ctx, correlationId)
    }

    // Handle other known AdonisJS exceptions
    if (this.isHttpException(error)) {
      return this.handleHttpException(error, ctx, correlationId)
    }

    // Handle unknown errors
    return this.handleUnknownError(error, ctx, correlationId)
  }

  /**
   * Handle screenshot-specific exceptions
   */
  private async handleScreenshotException(
    error: ScreenshotException, 
    ctx: HttpContext, 
    correlationId: string
  ) {
    const errorResponse = error.getErrorResponse()
    
    // Add correlation ID to error response
    errorResponse.detail.context = {
      ...errorResponse.detail.context,
      correlationId
    }

    ctx.response.status(error.status || 500)
    return ctx.response.json(errorResponse)
  }

  /**
   * Handle validation errors
   */
  private async handleValidationError(error: any, ctx: HttpContext, correlationId: string) {
    const errorResponse = {
      detail: {
        error: ErrorCode.INVALID_URL, // Default to invalid URL for validation errors
        message: 'Validation failed',
        context: {
          correlationId,
          errors: error.messages || error.message
        }
      }
    }

    ctx.response.status(400)
    return ctx.response.json(errorResponse)
  }

  /**
   * Handle authentication errors
   */
  private async handleAuthenticationError(error: any, ctx: HttpContext, correlationId: string) {
    const errorResponse = {
      detail: {
        error: ErrorCode.UNAUTHORIZED,
        message: error.message || 'Authentication failed',
        context: {
          correlationId
        }
      }
    }

    ctx.response.status(401)
    return ctx.response.json(errorResponse)
  }

  /**
   * Handle HTTP exceptions
   */
  private async handleHttpException(error: any, ctx: HttpContext, correlationId: string) {
    const status = error.status || 500
    const errorCode = this.mapStatusToErrorCode(status)
    
    const errorResponse = {
      detail: {
        error: errorCode,
        message: error.message || 'An error occurred',
        context: {
          correlationId
        }
      }
    }

    ctx.response.status(status)
    return ctx.response.json(errorResponse)
  }

  /**
   * Handle unknown errors
   */
  private async handleUnknownError(_error: unknown, ctx: HttpContext, correlationId: string) {
    const errorResponse = {
      detail: {
        error: ErrorCode.SERVICE_OVERLOADED,
        message: 'An unexpected error occurred',
        context: {
          correlationId
        }
      }
    }

    ctx.response.status(500)
    return ctx.response.json(errorResponse)
  }

  /**
   * Check if error is a validation error
   */
  private isValidationError(error: any): boolean {
    return error.code === 'E_VALIDATION_ERROR' || 
           error.name === 'ValidationError' ||
           (error.messages && Array.isArray(error.messages))
  }

  /**
   * Check if error is an authentication error
   */
  private isAuthenticationError(error: any): boolean {
    return error.code === 'E_UNAUTHORIZED_ACCESS' ||
           error.name === 'AuthenticationError' ||
           (error.status === 401)
  }

  /**
   * Check if error is an HTTP exception
   */
  private isHttpException(error: any): boolean {
    return error.status && typeof error.status === 'number'
  }

  /**
   * Map HTTP status codes to error codes
   */
  private mapStatusToErrorCode(status: number): ErrorCode {
    switch (status) {
      case 400:
        return ErrorCode.INVALID_URL
      case 401:
        return ErrorCode.UNAUTHORIZED
      case 408:
        return ErrorCode.TIMEOUT
      case 429:
        return ErrorCode.RATE_LIMITED
      case 503:
        return ErrorCode.SERVICE_OVERLOADED
      default:
        return ErrorCode.SERVICE_OVERLOADED
    }
  }

  /**
   * The method is used to report error to the logging service or
   * the third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    const correlationId = CorrelationService.getOrCreateCorrelationId(ctx)
    const errorContext = CorrelationService.createErrorContext(ctx)

    // Log screenshot exceptions with full context
    if (error instanceof ScreenshotException) {
      logger.error('Screenshot exception occurred', {
        error: {
          code: error.code,
          message: error.message,
          stack: error.stack,
          context: error.context
        },
        request: errorContext,
        correlationId
      })
      return
    }

    // Log other errors with context
    logger.error('Unhandled exception occurred', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      },
      request: errorContext,
      correlationId
    })

    return super.report(error, ctx)
  }
}
