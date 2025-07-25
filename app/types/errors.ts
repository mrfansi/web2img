/**
 * Error types and interfaces for the screenshot system
 */

/**
 * Screenshot system error codes
 */
export enum ErrorCode {
  INVALID_URL = 'invalid_url',
  SCREENSHOT_FAILED = 'screenshot_failed',
  TIMEOUT = 'timeout',
  RATE_LIMITED = 'rate_limited',
  SERVICE_OVERLOADED = 'service_overloaded',
  STORAGE_ERROR = 'storage_error',
  WEBHOOK_FAILED = 'webhook_failed',
  BATCH_TOO_LARGE = 'batch_too_large',
  INVALID_FORMAT = 'invalid_format',
  INVALID_DIMENSIONS = 'invalid_dimensions',
  UNAUTHORIZED = 'unauthorized',
  INVALID_API_KEY = 'invalid_api_key',
  CACHE_ERROR = 'cache_error',
  QUEUE_ERROR = 'queue_error',
  BROWSER_ERROR = 'browser_error',
  IMGPROXY_ERROR = 'imgproxy_error'
}

/**
 * Standardized error response interface
 */
export interface ErrorResponse {
  detail: {
    error: ErrorCode
    message: string
    retry_after?: number
    context?: Record<string, any>
  }
}

/**
 * Screenshot system exception interface
 */
export interface ScreenshotException extends Error {
  code: ErrorCode
  statusCode: number
  context?: Record<string, any>
}

/**
 * Error context for logging and debugging
 */
export interface ErrorContext {
  url?: string
  jobId?: string
  batchId?: string
  itemId?: string
  apiKey?: string
  timestamp: Date
  requestId?: string
}