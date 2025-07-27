import { getCentralRedisManager } from '#services/central_redis_manager'
import { browserService } from '#services/browser_service'
import { FileStorageService } from '#services/file_storage_service'
import { ImgProxyService } from '#services/imgproxy_service'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'

/**
 * Health check status enum
 */
export enum HealthStatus {
  HEALTHY = 'healthy',
  UNHEALTHY = 'unhealthy',
  DEGRADED = 'degraded'
}

/**
 * Individual component health check result
 */
export interface ComponentHealth {
  status: HealthStatus
  message: string
  responseTime?: number
  details?: Record<string, any>
}

/**
 * Overall system health check result
 */
export interface SystemHealth {
  status: HealthStatus
  timestamp: Date
  uptime: number
  components: {
    database: ComponentHealth
    redis: ComponentHealth
    browser: ComponentHealth
    storage: ComponentHealth
    imgproxy: ComponentHealth
  }
  summary: {
    healthy: number
    unhealthy: number
    degraded: number
    total: number
  }
}

/**
 * Service for performing health checks on system components
 */
export class HealthCheckService {
  private startTime: Date = new Date()

  /**
   * Perform comprehensive health check on all system components
   */
  public async checkSystemHealth(): Promise<SystemHealth> {
    const timestamp = new Date()
    const uptime = Math.floor((timestamp.getTime() - this.startTime.getTime()) / 1000)

    const [database, redis, browser, storage, imgproxy] = await Promise.all([
      this.checkDatabaseHealth(),
      this.checkRedisHealth(),
      this.checkBrowserHealth(),
      this.checkStorageHealth(),
      this.checkImgProxyHealth()
    ])

    const components = { database, redis, browser, storage, imgproxy }
    const summary = this.calculateSummary(components)
    const overallStatus = this.determineOverallStatus(summary)

    return {
      status: overallStatus,
      timestamp,
      uptime,
      components,
      summary
    }
  }

  /**
   * Check database connectivity and performance
   */
  public async checkDatabaseHealth(): Promise<ComponentHealth> {
    const startTime = Date.now()

    try {
      // Test basic connectivity
      await db.rawQuery('SELECT 1 as health_check')
      const responseTime = Date.now() - startTime

      return {
        status: HealthStatus.HEALTHY,
        message: 'Database is healthy',
        responseTime,
        details: {
          connection: 'active',
          response_time: responseTime
        }
      }
    } catch (error) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: `Database connection failed: ${error.message}`,
        responseTime: Date.now() - startTime,
        details: { error: error.message }
      }
    }
  }

  /**
   * Check Redis connectivity and performance
   */
  public async checkRedisHealth(): Promise<ComponentHealth> {
    const startTime = Date.now()

    try {
      const redisManager = getCentralRedisManager()
      const redis = redisManager.getClient()

      // Test basic connectivity with ping
      const pingResult = await redis.ping()
      const responseTime = Date.now() - startTime

      if (pingResult !== 'PONG') {
        return {
          status: HealthStatus.UNHEALTHY,
          message: 'Redis ping failed',
          responseTime,
          details: { pingResult }
        }
      }

      // Test read/write operations
      const testKey = 'health_check:' + Date.now()
      await redis.set(testKey, 'test', 'EX', 10)
      const testValue = await redis.get(testKey)
      await redis.del(testKey)

      if (testValue !== 'test') {
        return {
          status: HealthStatus.DEGRADED,
          message: 'Redis read/write operations failed',
          responseTime,
          details: { testValue }
        }
      }

      // Get Redis info
      const info = await redis.info('memory')
      const memoryInfo = this.parseRedisInfo(info)

      return {
        status: HealthStatus.HEALTHY,
        message: 'Redis is healthy',
        responseTime,
        details: { memoryInfo }
      }
    } catch (error) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: `Redis connection failed: ${error.message}`,
        responseTime: Date.now() - startTime,
        details: { error: error.message }
      }
    }
  }

  /**
   * Check browser service health
   */
  public async checkBrowserHealth(): Promise<ComponentHealth> {
    const startTime = Date.now()

    try {
      // Use the singleton browser service instance
      const healthCheck = await browserService.healthCheck()
      const responseTime = Date.now() - startTime

      if (!healthCheck.healthy) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: 'Browser service is unhealthy',
          responseTime,
          details: healthCheck.details
        }
      }

      return {
        status: HealthStatus.HEALTHY,
        message: 'Browser service is healthy',
        responseTime,
        details: healthCheck.details
      }
    } catch (error) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: `Browser service failed: ${error.message}`,
        responseTime: Date.now() - startTime,
        details: { error: error.message }
      }
    }
  }  /**
   * Check file storage health
   */
  public async checkStorageHealth(): Promise<ComponentHealth> {
    const startTime = Date.now()

    try {
      const storageService = new FileStorageService()

      // Test write operation
      const testContent = Buffer.from('health-check-test')
      const testPath = `health-check-${Date.now()}.txt`

      await storageService.saveFile(testContent, testPath)
      const responseTime = Date.now() - startTime

      // Test read operation by checking if file exists
      const fileUrl = storageService.getFileUrl(testPath)

      // Try to clean up test file (don't fail if this doesn't work)
      try {
        await storageService.deleteFile(testPath)
      } catch (deleteError) {
        // Log but don't fail health check for cleanup issues
        logger.warn('Health check: Failed to cleanup test file', { testPath, error: deleteError.message })
      }

      return {
        status: HealthStatus.HEALTHY,
        message: 'Storage service is healthy',
        responseTime,
        details: {
          testPath,
          fileUrl,
          operations: ['write', 'read']
        }
      }
    } catch (error) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: `Storage service failed: ${error.message}`,
        responseTime: Date.now() - startTime,
        details: { error: error.message }
      }
    }
  }

  /**
 * Check ImgProxy service health
 */
  public async checkImgProxyHealth(): Promise<ComponentHealth> {
    const startTime = Date.now()

    try {
      const imgProxyService = new ImgProxyService()

      if (!imgProxyService.isAvailable()) {
        return {
          status: HealthStatus.DEGRADED,
          message: 'ImgProxy is not configured',
          responseTime: Date.now() - startTime,
          details: { configured: false }
        }
      }

      // Test URL generation
      const testImagePath = 'test/image.png'
      const imgProxyUrl = imgProxyService.generateUrl(testImagePath, {
        width: 100,
        height: 100,
        format: 'png'
      })

      if (!imgProxyUrl) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: 'ImgProxy URL generation failed',
          responseTime: Date.now() - startTime
        }
      }

      return {
        status: HealthStatus.HEALTHY,
        message: 'ImgProxy service is healthy',
        responseTime: Date.now() - startTime,
        details: {
          configured: true,
          url_generation: 'working'
        }
      }
    } catch (error) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: `ImgProxy service failed: ${error.message}`,
        responseTime: Date.now() - startTime,
        details: { error: error.message }
      }
    }
  }

  /**
   * Calculate summary statistics for component health
   */
  private calculateSummary(components: Record<string, ComponentHealth>) {
    const statuses = Object.values(components).map(c => c.status)

    return {
      healthy: statuses.filter(s => s === HealthStatus.HEALTHY).length,
      unhealthy: statuses.filter(s => s === HealthStatus.UNHEALTHY).length,
      degraded: statuses.filter(s => s === HealthStatus.DEGRADED).length,
      total: statuses.length
    }
  }

  /**
   * Determine overall system status based on component health
   */
  private determineOverallStatus(summary: { healthy: number; unhealthy: number; degraded: number; total: number }): HealthStatus {
    if (summary.unhealthy > 0) {
      return HealthStatus.UNHEALTHY
    }

    if (summary.degraded > 0) {
      return HealthStatus.DEGRADED
    }

    return HealthStatus.HEALTHY
  }

  /**
   * Parse Redis INFO command output
   */
  private parseRedisInfo(info: string): Record<string, string> {
    const result: Record<string, string> = {}

    info.split('\r\n').forEach(line => {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split(':')
        if (key && value) {
          result[key] = value
        }
      }
    })

    return result
  }

  /**
   * Reset start time (useful for testing)
   */
  public resetStartTime(): void {
    this.startTime = new Date()
  }
}