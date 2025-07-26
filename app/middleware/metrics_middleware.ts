import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { MetricsService } from '#services/metrics_service'
import { CorrelationService } from '#services/correlation_service'

/**
 * Middleware to collect HTTP request metrics
 */
export default class MetricsMiddleware {
  private metricsService = new MetricsService()

  async handle(ctx: HttpContext, next: NextFn) {
    const startTime = Date.now()
    const correlationId = CorrelationService.getOrCreateCorrelationId(ctx)
    
    // Get request information
    const method = ctx.request.method()
    const route = ctx.route?.pattern || ctx.request.url()
    
    try {
      // Process the request
      await next()
      
      // Record successful request metrics
      const duration = Date.now() - startTime
      const statusCode = ctx.response.getStatus()
      
      await this.recordRequestMetrics(method, route, statusCode, duration, correlationId)
      
    } catch (error) {
      // Record error metrics
      const duration = Date.now() - startTime
      const statusCode = error.status || 500
      
      await this.recordRequestMetrics(method, route, statusCode, duration, correlationId, true)
      
      // Re-throw the error
      throw error
    }
  }

  /**
   * Record request metrics
   */
  private async recordRequestMetrics(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
    correlationId: string,
    isError: boolean = false
  ): Promise<void> {
    const labels = {
      method,
      route,
      status: statusCode.toString()
    }

    // Record total requests
    await this.metricsService.incrementCounter('http_requests_total', 1, labels)
    
    // Record request duration
    await this.metricsService.recordHistogram('http_request_duration', duration, labels)
    
    // Record errors if applicable
    if (isError || statusCode >= 400) {
      await this.metricsService.incrementCounter('http_requests_errors', 1, labels)
    }
    
    // Record status code specific metrics
    await this.metricsService.incrementCounter('http_requests_total', 1, { status: statusCode.toString() })
    
    // Update active requests gauge (approximate)
    await this.metricsService.setGauge('http_active_requests', 0) // Would need more sophisticated tracking
  }
}