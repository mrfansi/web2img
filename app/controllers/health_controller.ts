import { HttpContext } from '@adonisjs/core/http'
import { HealthCheckService, HealthStatus } from '#services/health_check_service'
import { MetricsService } from '#services/metrics_service'
import ErrorLoggingService from '#services/error_logging_service'

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
   */
  /**
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
      uptime: health.uptime,
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
   */
  /**
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
      case 'queues':
        componentHealth = await this.healthCheckService.checkQueueHealth()
        break
      default:
        response.status(404)
        return {
          error: 'Component not found',
          availableComponents: ['database', 'redis', 'browser', 'storage', 'imgproxy', 'queues'],
        }
    }

    const statusCode = this.getHttpStatusFromHealth(componentHealth.status)
    response.status(statusCode)

    return {
      component,
      ...componentHealth,
      timestamp: new Date(),
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
          .map(([name]) => name),
      }
    }

    return {
      ready: true,
      status: health.status,
      timestamp: new Date(),
    }
  }

  /**
   * Liveness probe endpoint (for Kubernetes/Docker)
   * GET /health/live
   */
  public async live({ request, response }: HttpContext) {
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
          external: memoryUsage.external,
        },
        timestamp: new Date(),
      }
    } catch (error) {
      // Log error to both application logger and database
      await ErrorLoggingService.logControllerError(
        'HealthController',
        'alive',
        error,
        {
          endpoint: request.url(),
          method: request.method(),
          userAgent: request.header('user-agent'),
          ipAddress: request.ip(),
        }
      )

      response.status(500)
      return {
        alive: false,
        error: error.message,
        timestamp: new Date(),
      }
    }
  }

  /**
   * Debug environment variables (temporary endpoint)
   * GET /debug/env
   */
  public async debugEnv({ }: HttpContext) {
    return {
      NODE_ENV: process.env.NODE_ENV,
      REDIS_HOST: process.env.REDIS_HOST,
      REDIS_PORT: process.env.REDIS_PORT,
      SCREENSHOT_QUEUE_CONCURRENCY: process.env.SCREENSHOT_QUEUE_CONCURRENCY,
      SCREENSHOT_QUEUE_REMOVE_ON_COMPLETE: process.env.SCREENSHOT_QUEUE_REMOVE_ON_COMPLETE,
      SCREENSHOT_QUEUE_REMOVE_ON_FAIL: process.env.SCREENSHOT_QUEUE_REMOVE_ON_FAIL,
      SCREENSHOT_TIMEOUT: process.env.SCREENSHOT_TIMEOUT,
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Check recent screenshot job results (temporary endpoint)
   * GET /debug/screenshot-jobs
   */
  public async debugScreenshotJobs({ }: HttpContext) {
    try {
      const queueService = (await import('#services/queue_service')).default

      // Get the screenshot queue directly
      const screenshotQueue = queueService.getQueue('screenshot')

      // Get recent completed screenshot jobs
      const completedJobs = await screenshotQueue.getCompleted(0, 9) // Get last 10 jobs

      const jobDetails = []
      for (const job of completedJobs) {
        jobDetails.push({
          id: job.id,
          name: job.name,
          finishedOn: job.finishedOn,
          processedOn: job.processedOn,
          returnvalue: job.returnvalue,
          data: job.data,
          progress: job.progress,
          failedReason: job.failedReason,
        })
      }

      return {
        success: true,
        totalJobs: completedJobs.length,
        jobs: jobDetails,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      }
    }
  }

  /**
   * Test job status retrieval (temporary endpoint)
   * GET /debug/test-job-status/:jobId
   */
  public async testJobStatus({ params }: HttpContext) {
    try {
      const { jobId } = params
      const queueService = (await import('#services/queue_service')).default

      // Test getting job status the same way batch worker does
      const jobStatus = await queueService.getJobStatus(jobId, 'screenshot')

      // Also get the job directly from the queue
      const screenshotQueue = queueService.getQueue('screenshot')
      const directJob = await screenshotQueue.getJob(jobId)

      return {
        success: true,
        jobId,
        jobStatus,
        directJob: directJob ? {
          id: directJob.id,
          name: directJob.name,
          finishedOn: directJob.finishedOn,
          processedOn: directJob.processedOn,
          returnvalue: directJob.returnvalue,
          data: directJob.data,
          progress: directJob.progress,
          failedReason: directJob.failedReason,
        } : null,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      }
    }
  }

  /**
   * Test waitForScreenshotJob method directly (temporary endpoint)
   * GET /debug/test-wait-job/:jobId
   */
  public async testWaitJob({ params }: HttpContext) {
    try {
      const { jobId } = params
      // Simulate what waitForScreenshotJob does
      const queueService = (await import('#services/queue_service')).default
      const jobStatus = await queueService.getJobStatus(jobId, 'screenshot')

      let result = null
      let error = null

      if (!jobStatus) {
        error = 'Job not found'
      } else if (jobStatus.finishedOn && jobStatus.returnvalue) {
        result = jobStatus.returnvalue
      } else if (jobStatus.finishedOn && !jobStatus.returnvalue && !jobStatus.failedReason) {
        error = 'Job completed but returned no result'
      } else if (jobStatus.failedReason) {
        error = jobStatus.failedReason
      } else {
        error = 'Job still processing or unknown state'
      }

      return {
        success: true,
        jobId,
        jobStatus,
        result,
        error,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      }
    }
  }

  /**
   * Test batch job processing (temporary endpoint)
   * POST /debug/test-batch
   */
  public async testBatch({ }: HttpContext) {
    try {
      // Import required services
      const BatchJob = (await import('#models/batch_job')).default
      const queueService = (await import('#services/queue_service')).default
      const { getScreenshotQueueWorker } = await import('#services/screenshot_queue_worker')
      const { getBatchQueueWorker } = await import('#services/batch_queue_worker')

      // Check worker status
      const screenshotWorker = getScreenshotQueueWorker()
      const batchWorker = getBatchQueueWorker()

      const workerStatus = {
        screenshot: {
          running: screenshotWorker.getWorker().isRunning(),
          paused: screenshotWorker.getWorker().isPaused(),
        },
        batch: {
          running: batchWorker.getWorker().isRunning(),
          paused: batchWorker.getWorker().isPaused(),
        },
      }

      // Get queue metrics
      const [screenshotMetrics, batchMetrics] = await Promise.all([
        queueService.getQueueMetrics('screenshot'),
        queueService.getQueueMetrics('batch'),
      ])

      // Create a test batch job
      const testBatch = await BatchJob.createBatchJob(1, {
        parallel: 1,
        timeout: 30000,
      })

      // Prepare batch job data for queue (this was missing!)
      const batchJobData = {
        id: testBatch.id.toString(),
        items: [
          {
            id: 'debug-test-item',
            url: 'https://httpbin.org/html',
            format: 'png' as const,
            width: 800,
            height: 600,
          },
        ],
        config: {
          parallel: 1,
          timeout: 30000,
        },
        apiKeyId: 'debug-test-key',
      }

      // Add the batch job to the queue (this was the missing step!)
      const queueJob = await queueService.addBatchJob(batchJobData)

      return {
        success: true,
        testBatchId: testBatch.id,
        queueJobId: queueJob.id,
        workerStatus,
        queueMetrics: {
          screenshot: screenshotMetrics,
          batch: batchMetrics,
        },
        message: 'Test batch job created AND queued. It should start processing now.',
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      }
    }
  }

  /**
   * Metrics endpoint
   * GET /metrics
   */
  public async metrics({ request, response }: HttpContext) {
    try {
      const dashboard = await this.metricsService.getMetricsDashboard()
      return dashboard
    } catch (error) {
      // Log error to both application logger and database
      await ErrorLoggingService.logControllerError(
        'HealthController',
        'metrics',
        error,
        {
          endpoint: request.url(),
          method: request.method(),
          userAgent: request.header('user-agent'),
          ipAddress: request.ip(),
        }
      )

      response.status(500)
      return {
        error: 'Failed to retrieve metrics',
        message: error.message,
        timestamp: new Date(),
      }
    }
  }

  /**
   * Request metrics endpoint
   * GET /metrics/requests
   */
  public async requestMetrics({ request, response }: HttpContext) {
    try {
      const metrics = await this.metricsService.getRequestMetrics()
      return {
        ...metrics,
        timestamp: new Date(),
      }
    } catch (error) {
      // Log error to both application logger and database
      await ErrorLoggingService.logControllerError(
        'HealthController',
        'requestMetrics',
        error,
        {
          endpoint: request.url(),
          method: request.method(),
          userAgent: request.header('user-agent'),
          ipAddress: request.ip(),
        }
      )

      response.status(500)
      return {
        error: 'Failed to retrieve request metrics',
        message: error.message,
        timestamp: new Date(),
      }
    }
  }

  /**
   * Processing metrics endpoint
   * GET /metrics/processing
   */
  public async processingMetrics({ request, response }: HttpContext) {
    try {
      const metrics = await this.metricsService.getProcessingMetrics()
      return {
        ...metrics,
        timestamp: new Date(),
      }
    } catch (error) {
      // Log error to both application logger and database
      await ErrorLoggingService.logControllerError(
        'HealthController',
        'processingMetrics',
        error,
        {
          endpoint: request.url(),
          method: request.method(),
          userAgent: request.header('user-agent'),
          ipAddress: request.ip(),
        }
      )

      response.status(500)
      return {
        error: 'Failed to retrieve processing metrics',
        message: error.message,
        timestamp: new Date(),
      }
    }
  }

  /**
   * System metrics endpoint
   * GET /metrics/system
   */
  public async systemMetrics({ request, response }: HttpContext) {
    try {
      const metrics = await this.metricsService.getSystemMetrics()
      return {
        ...metrics,
        timestamp: new Date(),
      }
    } catch (error) {
      // Log error to both application logger and database
      await ErrorLoggingService.logControllerError(
        'HealthController',
        'systemMetrics',
        error,
        {
          endpoint: request.url(),
          method: request.method(),
          userAgent: request.header('user-agent'),
          ipAddress: request.ip(),
        }
      )

      response.status(500)
      return {
        error: 'Failed to retrieve system metrics',
        message: error.message,
        timestamp: new Date(),
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
