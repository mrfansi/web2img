import { getCentralRedisManager } from '#services/central_redis_manager'
import logger from '@adonisjs/core/services/logger'
import ErrorLoggingService from '#services/error_logging_service'

/**
 * Metric types
 */
export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  TIMER = 'timer',
}

/**
 * Metric data structure
 */
export interface Metric {
  name: string
  type: MetricType
  value: number
  timestamp: Date
  labels?: Record<string, string>
}

/**
 * Request metrics
 */
export interface RequestMetrics {
  totalRequests: number
  requestsPerSecond: number
  averageResponseTime: number
  errorRate: number
  statusCodes: Record<string, number>
}

/**
 * Processing metrics
 */
export interface ProcessingMetrics {
  screenshotsGenerated: number
  screenshotsPerSecond: number
  averageProcessingTime: number
  cacheHitRate: number
  queueDepth: number
  activeWorkers: number
}

/**
 * System metrics
 */
export interface SystemMetrics {
  memoryUsage: {
    used: number
    total: number
    percentage: number
  }
  cpuUsage: number
  diskUsage: {
    used: number
    total: number
    percentage: number
  }
}

/**
 * Combined metrics dashboard
 */
export interface MetricsDashboard {
  timestamp: Date
  requests: RequestMetrics
  processing: ProcessingMetrics
  system: SystemMetrics
}

/**
 * Service for collecting and managing application metrics
 */
export class MetricsService {
  private redis = getCentralRedisManager().getClient()
  private readonly METRICS_PREFIX = 'metrics:'
  private readonly RETENTION_SECONDS = 3600 // 1 hour

  /**
   * Record a counter metric
   */
  public async incrementCounter(
    name: string,
    value: number = 1,
    labels?: Record<string, string>
  ): Promise<void> {
    try {
      const key = this.buildMetricKey(name, MetricType.COUNTER, labels)
      await this.redis.incrby(key, value)
      await this.redis.expire(key, this.RETENTION_SECONDS)

      // Also store in time series for rate calculations
      const timeSeriesKey = `${key}:timeseries`
      const timestamp = Date.now()
      await this.redis.zadd(timeSeriesKey, timestamp, `${timestamp}:${value}`)
      await this.redis.expire(timeSeriesKey, this.RETENTION_SECONDS)
    } catch (error) {
      logger.error('Failed to increment counter metric', { name, value, labels, error })
    }
  }

  /**
   * Record a gauge metric (current value)
   */
  public async setGauge(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): Promise<void> {
    try {
      const key = this.buildMetricKey(name, MetricType.GAUGE, labels)
      await this.redis.set(key, value, 'EX', this.RETENTION_SECONDS)
    } catch (error) {
      logger.error('Failed to set gauge metric', { name, value, labels, error })
    }
  }

  /**
   * Record a histogram value (for response times, processing times, etc.)
   */
  public async recordHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): Promise<void> {
    try {
      const key = this.buildMetricKey(name, MetricType.HISTOGRAM, labels)
      const timestamp = Date.now()

      // Store individual values in a sorted set for percentile calculations
      await this.redis.zadd(key, timestamp, `${timestamp}:${value}`)
      await this.redis.expire(key, this.RETENTION_SECONDS)

      // Also maintain running statistics
      const statsKey = `${key}:stats`
      const multi = this.redis.multi()
      multi.hincrby(statsKey, 'count', 1)
      multi.hincrbyfloat(statsKey, 'sum', value)
      multi.hincrbyfloat(statsKey, 'sum_squares', value * value)
      multi.expire(statsKey, this.RETENTION_SECONDS)
      await multi.exec()
    } catch (error) {
      logger.error('Failed to record histogram metric', { name, value, labels, error })
    }
  }

  /**
   * Start a timer and return a function to stop it
   */
  public startTimer(name: string, labels?: Record<string, string>): () => Promise<void> {
    const startTime = Date.now()

    return async () => {
      const duration = Date.now() - startTime
      await this.recordHistogram(name, duration, labels)
    }
  }

  /**
   * Get request metrics
   */
  public async getRequestMetrics(): Promise<RequestMetrics> {
    try {
      const now = Date.now()
      const oneMinuteAgo = now - 60000

      // Get total requests
      const totalRequests = (await this.getCounterValue('http_requests_total')) || 0

      // Get requests per second (last minute)
      const recentRequests = await this.getTimeSeriesSum('http_requests_total', oneMinuteAgo, now)
      const requestsPerSecond = recentRequests / 60

      // Get average response time
      const responseTimeStats = await this.getHistogramStats('http_request_duration')
      const averageResponseTime = responseTimeStats ? responseTimeStats.average : 0

      // Get error rate
      const totalErrors = (await this.getCounterValue('http_requests_errors')) || 0
      const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0

      // Get status codes
      const statusCodes = await this.getStatusCodeMetrics()

      return {
        totalRequests,
        requestsPerSecond,
        averageResponseTime,
        errorRate,
        statusCodes,
      }
    } catch (error) {
      // Log error with enhanced tracing
      await ErrorLoggingService.logServiceError(
        'MetricsService',
        'getRequestMetrics',
        error,
        {
          errorCategory: 'system',
          severity: 'medium',
        }
      )
      return {
        totalRequests: 0,
        requestsPerSecond: 0,
        averageResponseTime: 0,
        errorRate: 0,
        statusCodes: {},
      }
    }
  }

  /**
   * Get processing metrics
   */
  public async getProcessingMetrics(): Promise<ProcessingMetrics> {
    try {
      const now = Date.now()
      const oneMinuteAgo = now - 60000

      // Get screenshots generated
      const screenshotsGenerated = (await this.getCounterValue('screenshots_generated')) || 0

      // Get screenshots per second (last minute)
      const recentScreenshots = await this.getTimeSeriesSum(
        'screenshots_generated',
        oneMinuteAgo,
        now
      )
      const screenshotsPerSecond = recentScreenshots / 60

      // Get average processing time
      const processingTimeStats = await this.getHistogramStats('screenshot_processing_time')
      const averageProcessingTime = processingTimeStats ? processingTimeStats.average : 0

      // Get cache hit rate
      const cacheHits = (await this.getCounterValue('cache_hits')) || 0
      const cacheMisses = (await this.getCounterValue('cache_misses')) || 0
      const totalCacheRequests = cacheHits + cacheMisses
      const cacheHitRate = totalCacheRequests > 0 ? (cacheHits / totalCacheRequests) * 100 : 0

      // Get queue depth and active workers
      const queueDepth = (await this.getGaugeValue('queue_depth')) || 0
      const activeWorkers = (await this.getGaugeValue('active_workers')) || 0

      return {
        screenshotsGenerated,
        screenshotsPerSecond,
        averageProcessingTime,
        cacheHitRate,
        queueDepth,
        activeWorkers,
      }
    } catch (error) {
      // Log error with enhanced tracing
      await ErrorLoggingService.logServiceError(
        'MetricsService',
        'getProcessingMetrics',
        error,
        {
          errorCategory: 'system',
          severity: 'medium',
        }
      )
      return {
        screenshotsGenerated: 0,
        screenshotsPerSecond: 0,
        averageProcessingTime: 0,
        cacheHitRate: 0,
        queueDepth: 0,
        activeWorkers: 0,
      }
    }
  }

  /**
   * Get system metrics
   */
  public async getSystemMetrics(): Promise<SystemMetrics> {
    try {
      const memoryUsage = process.memoryUsage()
      const totalMemory = memoryUsage.heapTotal + memoryUsage.external
      const usedMemory = memoryUsage.heapUsed

      // CPU usage would require additional monitoring, for now return 0
      const cpuUsage = 0

      // Disk usage would require filesystem monitoring, for now return placeholder
      const diskUsage = {
        used: 0,
        total: 0,
        percentage: 0,
      }

      return {
        memoryUsage: {
          used: usedMemory,
          total: totalMemory,
          percentage: (usedMemory / totalMemory) * 100,
        },
        cpuUsage,
        diskUsage,
      }
    } catch (error) {
      logger.error('Failed to get system metrics', { error })
      return {
        memoryUsage: { used: 0, total: 0, percentage: 0 },
        cpuUsage: 0,
        diskUsage: { used: 0, total: 0, percentage: 0 },
      }
    }
  }

  /**
   * Get complete metrics dashboard
   */
  public async getMetricsDashboard(): Promise<MetricsDashboard> {
    const [requests, processing, system] = await Promise.all([
      this.getRequestMetrics(),
      this.getProcessingMetrics(),
      this.getSystemMetrics(),
    ])

    return {
      timestamp: new Date(),
      requests,
      processing,
      system,
    }
  }

  /**
   * Clean up old metrics
   */
  public async cleanupOldMetrics(): Promise<void> {
    try {
      const pattern = `${this.METRICS_PREFIX}*`
      const keys = await this.redis.keys(pattern)

      for (const key of keys) {
        const ttl = await this.redis.ttl(key)
        if (ttl === -1) {
          // Key has no expiration, set one
          await this.redis.expire(key, this.RETENTION_SECONDS)
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup old metrics', { error })
    }
  }

  /**
   * Build metric key with labels
   */
  private buildMetricKey(name: string, type: MetricType, labels?: Record<string, string>): string {
    let key = `${this.METRICS_PREFIX}${type}:${name}`

    if (labels) {
      const labelString = Object.entries(labels)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(',')
      key += `:${labelString}`
    }

    return key
  }

  /**
   * Get counter value
   */
  private async getCounterValue(name: string, labels?: Record<string, string>): Promise<number> {
    const key = this.buildMetricKey(name, MetricType.COUNTER, labels)
    const value = await this.redis.get(key)
    return value ? parseInt(value, 10) : 0
  }

  /**
   * Get gauge value
   */
  private async getGaugeValue(name: string, labels?: Record<string, string>): Promise<number> {
    const key = this.buildMetricKey(name, MetricType.GAUGE, labels)
    const value = await this.redis.get(key)
    return value ? parseFloat(value) : 0
  }

  /**
   * Get histogram statistics
   */
  private async getHistogramStats(
    name: string,
    labels?: Record<string, string>
  ): Promise<{ count: number; average: number; sum: number } | null> {
    const key = this.buildMetricKey(name, MetricType.HISTOGRAM, labels)
    const statsKey = `${key}:stats`

    const stats = await this.redis.hmget(statsKey, 'count', 'sum', 'sum_squares')
    const [countStr, sumStr] = stats

    if (!countStr || !sumStr) {
      return null
    }

    const count = parseInt(countStr, 10)
    const sum = parseFloat(sumStr)
    const average = count > 0 ? sum / count : 0

    return { count, average, sum }
  }

  /**
   * Get time series sum for a given time range
   */
  private async getTimeSeriesSum(
    name: string,
    startTime: number,
    endTime: number,
    labels?: Record<string, string>
  ): Promise<number> {
    const key = this.buildMetricKey(name, MetricType.COUNTER, labels)
    const timeSeriesKey = `${key}:timeseries`

    const values = await this.redis.zrangebyscore(timeSeriesKey, startTime, endTime)

    return values.reduce((sum, entry) => {
      const [, value] = entry.split(':')
      return sum + parseInt(value, 10)
    }, 0)
  }

  /**
   * Get status code metrics
   */
  private async getStatusCodeMetrics(): Promise<Record<string, number>> {
    const pattern = `${this.METRICS_PREFIX}${MetricType.COUNTER}:http_requests_total:status=*`
    const keys = await this.redis.keys(pattern)

    const statusCodes: Record<string, number> = {}

    for (const key of keys) {
      const match = key.match(/status=(\d+)/)
      if (match) {
        const statusCode = match[1]
        const value = await this.redis.get(key)
        statusCodes[statusCode] = value ? parseInt(value, 10) : 0
      }
    }

    return statusCodes
  }
}
