import logger from '@adonisjs/core/services/logger'
import webhookDeliveryTracker from './webhook_delivery_tracker.js'
import type { WebhookDeliveryStats, WebhookDeliveryStatus } from './webhook_delivery_tracker.js'

/**
 * Webhook monitoring alert levels
 */
export type AlertLevel = 'info' | 'warning' | 'error' | 'critical'

/**
 * Webhook monitoring alert
 */
export interface WebhookAlert {
  level: AlertLevel
  title: string
  message: string
  timestamp: Date
  data?: any
}

/**
 * Webhook monitoring configuration
 */
export interface WebhookMonitorConfig {
  successRateThreshold: number // Alert if success rate drops below this (0-1)
  failureCountThreshold: number // Alert if failures exceed this count in time window
  timeWindowMinutes: number // Time window for failure count monitoring
  checkIntervalMinutes: number // How often to run monitoring checks
}

/**
 * Webhook monitoring service for alerting and health checks
 * Monitors webhook delivery performance and generates alerts
 */
export class WebhookMonitor {
  private static instance: WebhookMonitor
  private config: WebhookMonitorConfig
  private monitoringInterval?: NodeJS.Timeout
  private isMonitoring = false

  constructor() {
    this.config = {
      successRateThreshold: 0.8, // 80%
      failureCountThreshold: 10,
      timeWindowMinutes: 60, // 1 hour
      checkIntervalMinutes: 15, // Check every 15 minutes
    }
  }

  /**
   * Get singleton instance of WebhookMonitor
   */
  public static getInstance(): WebhookMonitor {
    if (!WebhookMonitor.instance) {
      WebhookMonitor.instance = new WebhookMonitor()
    }
    return WebhookMonitor.instance
  }

  /**
   * Start monitoring webhook deliveries
   */
  public startMonitoring(config?: Partial<WebhookMonitorConfig>): void {
    if (this.isMonitoring) {
      logger.warn('Webhook monitoring is already running')
      return
    }

    if (config) {
      this.config = { ...this.config, ...config }
    }

    this.isMonitoring = true

    logger.info('Starting webhook monitoring', {
      config: this.config,
    })

    // Run initial check
    this.runMonitoringCheck()

    // Schedule periodic checks
    this.monitoringInterval = setInterval(
      () => this.runMonitoringCheck(),
      this.config.checkIntervalMinutes * 60 * 1000
    )
  }

  /**
   * Stop monitoring webhook deliveries
   */
  public stopMonitoring(): void {
    if (!this.isMonitoring) {
      return
    }

    this.isMonitoring = false

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
      this.monitoringInterval = undefined
    }

    logger.info('Stopped webhook monitoring')
  }

  /**
   * Get current webhook health status
   */
  public async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy'
    stats: WebhookDeliveryStats
    alerts: WebhookAlert[]
  }> {
    const stats = await webhookDeliveryTracker.getDeliveryStats()
    const alerts = await this.checkForAlerts(stats)

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'

    // Determine overall health status
    const criticalAlerts = alerts.filter((a) => a.level === 'critical')
    const errorAlerts = alerts.filter((a) => a.level === 'error')

    if (criticalAlerts.length > 0) {
      status = 'unhealthy'
    } else if (errorAlerts.length > 0 || stats.successRate < this.config.successRateThreshold) {
      status = 'degraded'
    }

    return {
      status,
      stats,
      alerts,
    }
  }

  /**
   * Get recent webhook failures for investigation
   */
  public async getFailureReport(limit: number = 20): Promise<{
    recentFailures: WebhookDeliveryStatus[]
    commonIssues: Array<{
      issue: string
      count: number
      examples: string[]
    }>
    recommendations: string[]
  }> {
    const recentFailures = await webhookDeliveryTracker.getRecentFailures(limit)
    const stats = await webhookDeliveryTracker.getDeliveryStats()

    // Analyze common issues
    const commonIssues = stats.commonErrors.map((error) => ({
      issue: error.error,
      count: error.count,
      examples: recentFailures
        .filter((f) => f.lastError === error.error)
        .slice(0, 3)
        .map((f) => f.url),
    }))

    // Generate recommendations
    const recommendations = this.generateRecommendations(stats, recentFailures)

    return {
      recentFailures,
      commonIssues,
      recommendations,
    }
  }

  /**
   * Run monitoring check and generate alerts
   */
  private async runMonitoringCheck(): Promise<void> {
    try {
      logger.debug('Running webhook monitoring check')

      const stats = await webhookDeliveryTracker.getDeliveryStats()
      const alerts = await this.checkForAlerts(stats)

      // Log alerts
      for (const alert of alerts) {
        this.logAlert(alert)
      }

      // Cleanup old tracking data
      await webhookDeliveryTracker.cleanupOldData()

      logger.debug('Webhook monitoring check completed', {
        alertsGenerated: alerts.length,
        successRate: stats.successRate,
        totalDeliveries: stats.totalDeliveries,
      })
    } catch (error) {
      logger.error('Webhook monitoring check failed', { error })
    }
  }

  /**
   * Check for alert conditions
   */
  private async checkForAlerts(stats: WebhookDeliveryStats): Promise<WebhookAlert[]> {
    const alerts: WebhookAlert[] = []

    // Check success rate
    if (stats.totalDeliveries >= 10 && stats.successRate < this.config.successRateThreshold) {
      alerts.push({
        level: stats.successRate < 0.5 ? 'critical' : 'error',
        title: 'Low Webhook Success Rate',
        message: `Webhook success rate is ${(stats.successRate * 100).toFixed(1)}%, below threshold of ${(this.config.successRateThreshold * 100).toFixed(1)}%`,
        timestamp: new Date(),
        data: {
          successRate: stats.successRate,
          threshold: this.config.successRateThreshold,
          totalDeliveries: stats.totalDeliveries,
          failedDeliveries: stats.failedDeliveries,
        },
      })
    }

    // Check for high failure count
    if (stats.failedDeliveries > this.config.failureCountThreshold) {
      alerts.push({
        level: 'warning',
        title: 'High Webhook Failure Count',
        message: `${stats.failedDeliveries} webhook deliveries have failed, exceeding threshold of ${this.config.failureCountThreshold}`,
        timestamp: new Date(),
        data: {
          failedDeliveries: stats.failedDeliveries,
          threshold: this.config.failureCountThreshold,
        },
      })
    }

    // Check for common errors
    const topError = stats.commonErrors[0]
    if (topError && topError.count > 5) {
      alerts.push({
        level: 'warning',
        title: 'Common Webhook Error Detected',
        message: `Error "${topError.error}" has occurred ${topError.count} times`,
        timestamp: new Date(),
        data: {
          error: topError.error,
          count: topError.count,
        },
      })
    }

    // Check average attempts
    if (stats.averageAttempts > 2.5) {
      alerts.push({
        level: 'info',
        title: 'High Average Retry Attempts',
        message: `Average webhook delivery attempts is ${stats.averageAttempts.toFixed(1)}, indicating potential reliability issues`,
        timestamp: new Date(),
        data: {
          averageAttempts: stats.averageAttempts,
        },
      })
    }

    return alerts
  }

  /**
   * Log alert with appropriate level
   */
  private logAlert(alert: WebhookAlert): void {
    const logData = {
      title: alert.title,
      message: alert.message,
      data: alert.data,
    }

    switch (alert.level) {
      case 'critical':
        logger.fatal('Webhook monitoring alert', logData)
        break
      case 'error':
        logger.error('Webhook monitoring alert', logData)
        break
      case 'warning':
        logger.warn('Webhook monitoring alert', logData)
        break
      case 'info':
      default:
        logger.info('Webhook monitoring alert', logData)
        break
    }
  }

  /**
   * Generate recommendations based on failure patterns
   */
  private generateRecommendations(
    stats: WebhookDeliveryStats,
    recentFailures: WebhookDeliveryStatus[]
  ): string[] {
    const recommendations: string[] = []

    // Success rate recommendations
    if (stats.successRate < 0.8) {
      recommendations.push('Consider reviewing webhook endpoint reliability and response times')
    }

    // Common error recommendations
    const timeoutErrors = stats.commonErrors.filter(
      (e) =>
        e.error.toLowerCase().includes('timeout') || e.error.toLowerCase().includes('timed out')
    )

    if (timeoutErrors.length > 0) {
      recommendations.push('Increase webhook timeout values or optimize endpoint response times')
    }

    const connectionErrors = stats.commonErrors.filter(
      (e) =>
        e.error.toLowerCase().includes('connection') || e.error.toLowerCase().includes('network')
    )

    if (connectionErrors.length > 0) {
      recommendations.push('Check network connectivity and DNS resolution for webhook endpoints')
    }

    const authErrors = stats.commonErrors.filter(
      (e) =>
        e.error.toLowerCase().includes('401') ||
        e.error.toLowerCase().includes('403') ||
        e.error.toLowerCase().includes('unauthorized')
    )

    if (authErrors.length > 0) {
      recommendations.push('Verify webhook authentication credentials and permissions')
    }

    // High retry recommendations
    if (stats.averageAttempts > 2) {
      recommendations.push(
        'Consider implementing exponential backoff with jitter to reduce server load'
      )
    }

    // URL pattern recommendations
    const urlPatterns = new Set(recentFailures.map((f) => new URL(f.url).hostname))
    if (urlPatterns.size < recentFailures.length / 2) {
      recommendations.push(
        'Multiple failures from same domains detected - consider endpoint health monitoring'
      )
    }

    return recommendations
  }

  /**
   * Update monitoring configuration
   */
  public updateConfig(config: Partial<WebhookMonitorConfig>): void {
    this.config = { ...this.config, ...config }

    logger.info('Updated webhook monitoring configuration', {
      config: this.config,
    })

    // Restart monitoring with new config if currently running
    if (this.isMonitoring) {
      this.stopMonitoring()
      this.startMonitoring()
    }
  }

  /**
   * Get current monitoring configuration
   */
  public getConfig(): WebhookMonitorConfig {
    return { ...this.config }
  }

  /**
   * Check if monitoring is currently active
   */
  public isActive(): boolean {
    return this.isMonitoring
  }
}

// Export singleton instance
export default WebhookMonitor.getInstance()
