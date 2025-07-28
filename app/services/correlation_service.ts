import { randomUUID } from 'node:crypto'
import { HttpContext } from '@adonisjs/core/http'

/**
 * Service for managing correlation IDs across requests
 */
export class CorrelationService {
  private static readonly CORRELATION_ID_HEADER = 'x-correlation-id'
  private static readonly REQUEST_ID_HEADER = 'x-request-id'

  /**
   * Generate a new correlation ID
   */
  public static generateCorrelationId(): string {
    return randomUUID()
  }

  /**
   * Get or create correlation ID from HTTP context
   */
  public static getOrCreateCorrelationId(ctx: HttpContext): string {
    // Check if correlation ID is already in the request headers
    let correlationId = ctx.request.header(this.CORRELATION_ID_HEADER)

    if (!correlationId) {
      // Check if there's a request ID we can use
      correlationId = ctx.request.header(this.REQUEST_ID_HEADER)
    }

    if (!correlationId) {
      // Generate a new correlation ID
      correlationId = this.generateCorrelationId()
    }

    // Store in response headers for client tracking
    ctx.response.header(this.CORRELATION_ID_HEADER, correlationId)

    return correlationId
  }

  /**
   * Set correlation ID in HTTP context
   */
  public static setCorrelationId(ctx: HttpContext, correlationId: string): void {
    ctx.response.header(this.CORRELATION_ID_HEADER, correlationId)
  }

  /**
   * Get correlation ID from HTTP context
   */
  public static getCorrelationId(ctx: HttpContext): string | undefined {
    return (
      ctx.request.header(this.CORRELATION_ID_HEADER) || ctx.request.header(this.REQUEST_ID_HEADER)
    )
  }

  /**
   * Create error context with correlation ID and request information
   */
  public static createErrorContext(ctx: HttpContext, additionalContext?: Record<string, any>) {
    const correlationId = this.getOrCreateCorrelationId(ctx)

    return {
      correlationId,
      requestId: correlationId, // Use correlation ID as request ID if not provided
      method: ctx.request.method(),
      url: ctx.request.url(),
      userAgent: ctx.request.header('user-agent'),
      ip: ctx.request.ip(),
      timestamp: new Date(),
      ...additionalContext,
    }
  }
}
