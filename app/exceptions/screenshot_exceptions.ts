import { Exception } from '@adonisjs/core/exceptions'
import { ErrorCode } from '#types/errors'

/**
 * Base screenshot exception class
 */
export abstract class ScreenshotException extends Exception {
  public code: ErrorCode
  public context?: Record<string, any>

  constructor(message: string, code: ErrorCode, statusCode: number, context?: Record<string, any>) {
    super(message, { status: statusCode, code: code })
    this.code = code
    this.context = context
  }

  /**
   * Get standardized error response
   */
  public getErrorResponse(retryAfter?: number) {
    return {
      detail: {
        error: this.code,
        message: this.message,
        retry_after: retryAfter,
        context: this.context,
      },
    }
  }
}

/**
 * Invalid URL exception
 */
export class InvalidUrlException extends ScreenshotException {
  constructor(url: string, context?: Record<string, any>) {
    super(`Invalid or malformed URL: ${url}`, ErrorCode.INVALID_URL, 400, { url, ...context })
  }
}

/**
 * Screenshot capture failed exception
 */
export class ScreenshotFailedException extends ScreenshotException {
  constructor(url: string, reason?: string, context?: Record<string, any>) {
    super(
      `Failed to capture screenshot for ${url}${reason ? `: ${reason}` : ''}`,
      ErrorCode.SCREENSHOT_FAILED,
      500,
      { url, reason, ...context }
    )
  }
}

/**
 * Request timeout exception
 */
export class TimeoutException extends ScreenshotException {
  constructor(url: string, timeout: number, context?: Record<string, any>) {
    super(`Request timed out after ${timeout}s for URL: ${url}`, ErrorCode.TIMEOUT, 408, {
      url,
      timeout,
      ...context,
    })
  }
}

/**
 * Rate limit exceeded exception
 */
export class RateLimitedException extends ScreenshotException {
  constructor(apiKey: string, retryAfter: number, context?: Record<string, any>) {
    super('Rate limit exceeded', ErrorCode.RATE_LIMITED, 429, { apiKey, retryAfter, ...context })
  }

  public getErrorResponse() {
    return super.getErrorResponse(this.context?.retryAfter)
  }
}

/**
 * Service overloaded exception
 */
export class ServiceOverloadedException extends ScreenshotException {
  constructor(retryAfter: number = 60, context?: Record<string, any>) {
    super(
      'Service is currently overloaded, please try again later',
      ErrorCode.SERVICE_OVERLOADED,
      503,
      { retryAfter, ...context }
    )
  }

  public getErrorResponse() {
    return super.getErrorResponse(this.context?.retryAfter)
  }
}

/**
 * Storage error exception
 */
export class StorageErrorException extends ScreenshotException {
  constructor(operation: string, reason?: string, context?: Record<string, any>) {
    super(
      `Storage operation failed: ${operation}${reason ? ` - ${reason}` : ''}`,
      ErrorCode.STORAGE_ERROR,
      500,
      { operation, reason, ...context }
    )
  }
}

/**
 * Webhook delivery failed exception
 */
export class WebhookFailedException extends ScreenshotException {
  constructor(webhookUrl: string, reason?: string, context?: Record<string, any>) {
    super(
      `Webhook delivery failed for ${webhookUrl}${reason ? `: ${reason}` : ''}`,
      ErrorCode.WEBHOOK_FAILED,
      500,
      { webhookUrl, reason, ...context }
    )
  }
}

/**
 * Batch too large exception
 */
export class BatchTooLargeException extends ScreenshotException {
  constructor(itemCount: number, maxItems: number, context?: Record<string, any>) {
    super(
      `Batch contains ${itemCount} items, maximum allowed is ${maxItems}`,
      ErrorCode.BATCH_TOO_LARGE,
      400,
      { itemCount, maxItems, ...context }
    )
  }
}

/**
 * Invalid format exception
 */
export class InvalidFormatException extends ScreenshotException {
  constructor(format: string, validFormats: string[], context?: Record<string, any>) {
    super(
      `Invalid format '${format}'. Valid formats are: ${validFormats.join(', ')}`,
      ErrorCode.INVALID_FORMAT,
      400,
      { format, validFormats, ...context }
    )
  }
}

/**
 * Invalid dimensions exception
 */
export class InvalidDimensionsException extends ScreenshotException {
  constructor(width: number, height: number, context?: Record<string, any>) {
    super(
      `Invalid dimensions: ${width}x${height}. Width and height must be between 1 and 5000 pixels`,
      ErrorCode.INVALID_DIMENSIONS,
      400,
      { width, height, ...context }
    )
  }
}

/**
 * Unauthorized exception
 */
export class UnauthorizedException extends ScreenshotException {
  constructor(reason?: string, context?: Record<string, any>) {
    super(`Unauthorized${reason ? `: ${reason}` : ''}`, ErrorCode.UNAUTHORIZED, 401, {
      reason,
      ...context,
    })
  }
}

/**
 * Invalid API key exception
 */
export class InvalidApiKeyException extends ScreenshotException {
  constructor(apiKey?: string, context?: Record<string, any>) {
    super('Invalid or expired API key', ErrorCode.INVALID_API_KEY, 401, {
      apiKey: apiKey ? `${apiKey.substring(0, 8)}...` : undefined,
      ...context,
    })
  }
}

/**
 * Cache error exception
 */
export class CacheErrorException extends ScreenshotException {
  constructor(operation: string, reason?: string, context?: Record<string, any>) {
    super(
      `Cache operation failed: ${operation}${reason ? ` - ${reason}` : ''}`,
      ErrorCode.CACHE_ERROR,
      500,
      { operation, reason, ...context }
    )
  }
}

/**
 * Queue error exception
 */
export class QueueErrorException extends ScreenshotException {
  constructor(operation: string, reason?: string, context?: Record<string, any>) {
    super(
      `Queue operation failed: ${operation}${reason ? ` - ${reason}` : ''}`,
      ErrorCode.QUEUE_ERROR,
      500,
      { operation, reason, ...context }
    )
  }
}

/**
 * Browser error exception
 */
export class BrowserErrorException extends ScreenshotException {
  constructor(operation: string, reason?: string, context?: Record<string, any>) {
    super(
      `Browser operation failed: ${operation}${reason ? ` - ${reason}` : ''}`,
      ErrorCode.BROWSER_ERROR,
      500,
      { operation, reason, ...context }
    )
  }
}

/**
 * ImgProxy error exception
 */
export class ImgProxyErrorException extends ScreenshotException {
  constructor(operation: string, reason?: string, context?: Record<string, any>) {
    super(
      `ImgProxy operation failed: ${operation}${reason ? ` - ${reason}` : ''}`,
      ErrorCode.IMGPROXY_ERROR,
      500,
      { operation, reason, ...context }
    )
  }
}
