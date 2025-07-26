import { HttpContext } from '@adonisjs/core/http'
import { HealthCheckService, HealthStatus } from '#services/health_check_service'
import { MetricsService } from '#services/metrics_service'

/**
 * Controller for health checks and metrics endpoints
 */
export default class HealthController {
  private healthCheckService = new HealthCheckService()
  private metricsService = new MetricsService()

  /**
   * @swagger
   * /health:
   *   get:
   *     summary: Basic health check
   *     description: Returns the overall system health status
   *     tags:
   *       - Health & Monitoring
   *     responses:
   *       200:
   *         description: System is healthy
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/HealthResponse'
   *             example:
   *               status: "healthy"
   *               timestamp: "2025-07-26T12:00:00Z"
   *               uptime: 3600.5
   *       503:
   *         description: System is unhealthy
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/HealthResponse'
   *             example:
   *               status: "unhealthy"
   *               timestamp: "2025-07-26T12:00:00Z"
   *               uptime: 3600.5
   *
   * Basic health check endpoint
   * GET /health
   */
  public async health({ response }: HttpContext) {
    const health = await this.healthCheckService.checkSystemHealth()

    // Set appropriate HTTP status based on health
    const statusCode = this.getHttpStatusFromHealth(health.status)
    response.status(statusCode)

    return {
      status: health.status,
      timestamp: health.timestamp,
      uptime: health.uptime
    }
  }

  /**
   * @swagger
   * /health/detailed:
   *   get:
   *     summary: Detailed health check
   *     description: Returns detailed health information for all system components
   *     tags:
   *       - Health & Monitoring
   *     responses:
   *       200:
   *         description: Detailed health information
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/DetailedHealthResponse'
   *             example:
   *               status: "healthy"
   *               timestamp: "2025-07-26T12:00:00Z"
   *               uptime: 3600.5
   *               components:
   *                 database:
   *                   status: "healthy"
   *                   response_time: 15.2
   *                   details:
   *                     connection_count: 5
   *                     query_performance: "good"
   *                 redis:
   *                   status: "healthy"
   *                   response_time: 2.1
   *                   details:
   *                     memory_usage: "45%"
   *                     connected_clients: 3
   *                 queues:
   *                   status: "healthy"
   *                   details:
   *                     active_jobs: 12
   *                     pending_jobs: 0
   *                     failed_jobs: 0
   *       503:
   *         description: One or more components are unhealthy
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/DetailedHealthResponse'
   *
   * Detailed health check endpoint
   * GET /health/detailed
   */
  public async detailedHealth({ response }: HttpContext) {
    const health = await this.healthCheckService.checkSystemHealth()

    // Set appropriate HTTP status based on health
    const statusCode = this.getHttpStatusFromHealth(health.status)
    response.status(statusCode)

    return health
  }

  /**
   * Individual component health checks
   * GET /health/:component
   */
  public async componentHealth({ params, response }: HttpContext) {
    const { component } = params
    let componentHealth

    switch (component) {
      case 'database':
        componentHealth = await this.healthCheckService.checkDatabaseHealth()
        break
      case 'redis':
        componentHealth = await this.healthCheckService.checkRedisHealth()
        break
      case 'browser':
        componentHealth = await this.healthCheckService.checkBrowserHealth()
        break
      case 'storage':
        componentHealth = await this.healthCheckService.checkStorageHealth()
        break
      case 'imgproxy':
        componentHealth = await this.healthCheckService.checkImgProxyHealth()
        break
      default:
        response.status(404)
        return {
          error: 'Component not found',
          availableComponents: ['database', 'redis', 'browser', 'storage', 'imgproxy']
        }
    }

    const statusCode = this.getHttpStatusFromHealth(componentHealth.status)
    response.status(statusCode)

    return {
      component,
      ...componentHealth,
      timestamp: new Date()
    }
  }

  /**
   * Readiness probe endpoint (for Kubernetes/Docker)
   * GET /health/ready
   */
  public async ready({ response }: HttpContext) {
    const health = await this.healthCheckService.checkSystemHealth()

    // System is ready if it's healthy or degraded (but not unhealthy)
    const isReady = health.status !== HealthStatus.UNHEALTHY

    if (!isReady) {
      response.status(503)
      return {
        ready: false,
        status: health.status,
        unhealthyComponents: Object.entries(health.components)
          .filter(([, component]) => component.status === HealthStatus.UNHEALTHY)
          .map(([name]) => name)
      }
    }

    return {
      ready: true,
      status: health.status,
      timestamp: new Date()
    }
  }

  /**
   * Liveness probe endpoint (for Kubernetes/Docker)
   * GET /health/live
   */
  public async live({ response }: HttpContext) {
    // Basic liveness check - if we can respond, we're alive
    try {
      const uptime = process.uptime()
      const memoryUsage = process.memoryUsage()

      return {
        alive: true,
        uptime,
        memoryUsage: {
          heapUsed: memoryUsage.heapUsed,
          heapTotal: memoryUsage.heapTotal,
          external: memoryUsage.external
        },
        timestamp: new Date()
      }
    } catch (error) {
      response.status(500)
      return {
        alive: false,
        error: error.message,
        timestamp: new Date()
      }
    }
  }

  /**
   * Metrics endpoint
   * GET /metrics
   */
  public async metrics({ response }: HttpContext) {
    try {
      const dashboard = await this.metricsService.getMetricsDashboard()
      return dashboard
    } catch (error) {
      response.status(500)
      return {
        error: 'Failed to retrieve metrics',
        message: error.message,
        timestamp: new Date()
      }
    }
  }

  /**
   * Request metrics endpoint
   * GET /metrics/requests
   */
  public async requestMetrics({ response }: HttpContext) {
    try {
      const metrics = await this.metricsService.getRequestMetrics()
      return {
        ...metrics,
        timestamp: new Date()
      }
    } catch (error) {
      response.status(500)
      return {
        error: 'Failed to retrieve request metrics',
        message: error.message,
        timestamp: new Date()
      }
    }
  }

  /**
   * Processing metrics endpoint
   * GET /metrics/processing
   */
  public async processingMetrics({ response }: HttpContext) {
    try {
      const metrics = await this.metricsService.getProcessingMetrics()
      return {
        ...metrics,
        timestamp: new Date()
      }
    } catch (error) {
      response.status(500)
      return {
        error: 'Failed to retrieve processing metrics',
        message: error.message,
        timestamp: new Date()
      }
    }
  }

  /**
   * System metrics endpoint
   * GET /metrics/system
   */
  public async systemMetrics({ response }: HttpContext) {
    try {
      const metrics = await this.metricsService.getSystemMetrics()
      return {
        ...metrics,
        timestamp: new Date()
      }
    } catch (error) {
      response.status(500)
      return {
        error: 'Failed to retrieve system metrics',
        message: error.message,
        timestamp: new Date()
      }
    }
  }

  /**
   * Convert health status to HTTP status code
   */
  private getHttpStatusFromHealth(status: HealthStatus): number {
    switch (status) {
      case HealthStatus.HEALTHY:
        return 200
      case HealthStatus.DEGRADED:
        return 200 // Still operational
      case HealthStatus.UNHEALTHY:
        return 503
      default:
        return 500
    }
  }
}