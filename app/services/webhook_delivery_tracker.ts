import logger from '@adonisjs/core/services/logger'
import redisService from '#services/redis_service'
import type { WebhookDeliveryResult } from './webhook_service.js'

/**
 * Webhook delivery status for tracking
 */
export interface WebhookDeliveryStatus {
  id: string
  url: string
  jobId: string
  status: 'pending' | 'delivered' | 'failed' | 'retrying'
  attempts: number
  maxRetries: number
  lastAttemptAt: Date
  createdAt: Date
  completedAt?: Date
  lastError?: string
  deliveryResults: WebhookDeliveryResult[]
}

/**
 * Webhook delivery statistics
 */
export interface WebhookDeliveryStats {
  totalDeliveries: number
  successfulDeliveries: number
  failedDeliveries: number
  averageAttempts: number
  successRate: number
  commonErrors: Array<{
    error: string
    count: number
  }>
}

/**
 * Webhook delivery tracker for monitoring and alerting
 * Tracks webhook delivery status, retry attempts, and provides statistics
 */
export class WebhookDeliveryTracker {
  private static instance: WebhookDeliveryTracker
  private readonly keyPrefix = 'webhook:delivery:'
  private readonly statsKey = 'webhook:stats'
  private readonly alertThreshold = 0.8 // Alert if success rate drops below 80%
  private readonly maxTrackingDays = 7 // Keep tracking data for 7 days

  /**
   * Get singleton instance of WebhookDeliveryTracker
   */
  public static getInstance(): WebhookDeliveryTracker {
    if (!WebhookDeliveryTracker.instance) {
      WebhookDeliveryTracker.instance = new WebhookDeliveryTracker()
    }
    return WebhookDeliveryTracker.instance
  }

  /**
   * Start tracking a webhook delivery
   */
  public async startTracking(
    id: string,
    url: string,
    jobId: string,
    maxRetries: number = 5
  ): Promise<void> {
    const status: WebhookDeliveryStatus = {
      id,
      url,
      jobId,
      status: 'pending',
      attempts: 0,
      maxRetries,
      lastAttemptAt: new Date(),
      createdAt: new Date(),
      deliveryResults: [],
    }

    try {
      await redisService.executeCommand(async () => {
        const key = this.keyPrefix + id
        const ttl = this.maxTrackingDays * 24 * 60 * 60 // 7 days in seconds

        await redisService.getClient().setex(key, ttl, JSON.stringify(status))

        logger.info('Started tracking webhook delivery', {
          id,
          url,
          jobId,
          maxRetries,
        })
      }, 'start webhook tracking')
    } catch (error) {
      logger.error('Failed to start webhook tracking', { id, url, jobId, error })
    }
  }

  /**
   * Update webhook delivery status with attempt result
   */
  public async updateDeliveryStatus(id: string, result: WebhookDeliveryResult): Promise<void> {
    try {
      await redisService.executeCommand(async () => {
        const key = this.keyPrefix + id
        const statusData = await redisService.getClient().get(key)

        if (!statusData) {
          logger.warn('Webhook delivery status not found for update', { id })
          return
        }

        const status: WebhookDeliveryStatus = JSON.parse(statusData)

        // Update status
        status.attempts = result.attempt
        status.lastAttemptAt = result.deliveredAt
        status.deliveryResults.push(result)

        if (result.success) {
          status.status = 'delivered'
          status.completedAt = result.deliveredAt
        } else if (result.attempt >= status.maxRetries) {
          status.status = 'failed'
          status.completedAt = result.deliveredAt
          status.lastError = result.error
        } else {
          status.status = 'retrying'
          status.lastError = result.error
        }

        // Save updated status
        const ttl = this.maxTrackingDays * 24 * 60 * 60
        await redisService.getClient().setex(key, ttl, JSON.stringify(status))

        // Update statistics
        await this.updateStats(status)

        // Check for alerting conditions
        if (status.status === 'failed') {
          await this.checkAlertConditions(status)
        }

        logger.info('Updated webhook delivery status', {
          id,
          status: status.status,
          attempt: result.attempt,
          success: result.success,
        })
      }, 'update webhook delivery status')
    } catch (error) {
      logger.error('Failed to update webhook delivery status', { id, error })
    }
  }

  /**
   * Get webhook delivery status by ID
   */
  public async getDeliveryStatus(id: string): Promise<WebhookDeliveryStatus | null> {
    try {
      return await redisService.executeCommand(async () => {
        const key = this.keyPrefix + id
        const statusData = await redisService.getClient().get(key)

        if (!statusData) {
          return null
        }

        const status: WebhookDeliveryStatus = JSON.parse(statusData)

        // Convert date strings back to Date objects
        status.createdAt = new Date(status.createdAt)
        status.lastAttemptAt = new Date(status.lastAttemptAt)
        if (status.completedAt) {
          status.completedAt = new Date(status.completedAt)
        }

        status.deliveryResults = status.deliveryResults.map((result) => ({
          ...result,
          deliveredAt: new Date(result.deliveredAt),
        }))

        return status
      }, 'get webhook delivery status')
    } catch (error) {
      logger.error('Failed to get webhook delivery status', { id, error })
      return null
    }
  }

  /**
   * Get webhook delivery statistics
   */
  public async getDeliveryStats(): Promise<WebhookDeliveryStats> {
    try {
      return await redisService.executeCommand(async () => {
        const statsData = await redisService.getClient().get(this.statsKey)

        if (!statsData) {
          return {
            totalDeliveries: 0,
            successfulDeliveries: 0,
            failedDeliveries: 0,
            averageAttempts: 0,
            successRate: 0,
            commonErrors: [],
          }
        }

        return JSON.parse(statsData)
      }, 'get webhook delivery stats')
    } catch (error) {
      logger.error('Failed to get webhook delivery stats', { error })
      return {
        totalDeliveries: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        averageAttempts: 0,
        successRate: 0,
        commonErrors: [],
      }
    }
  }

  /**
   * Get recent failed webhook deliveries for monitoring
   */
  public async getRecentFailures(limit: number = 50): Promise<WebhookDeliveryStatus[]> {
    try {
      return await redisService.executeCommand(async () => {
        const pattern = this.keyPrefix + '*'
        const keys = await redisService.getClient().keys(pattern)

        const failures: WebhookDeliveryStatus[] = []

        for (const key of keys.slice(0, limit * 2)) {
          // Get more keys to filter
          const statusData = await redisService.getClient().get(key)
          if (statusData) {
            const status: WebhookDeliveryStatus = JSON.parse(statusData)

            if (status.status === 'failed') {
              // Convert date strings back to Date objects
              status.createdAt = new Date(status.createdAt)
              status.lastAttemptAt = new Date(status.lastAttemptAt)
              if (status.completedAt) {
                status.completedAt = new Date(status.completedAt)
              }

              failures.push(status)
            }
          }
        }

        // Sort by completion time (most recent first) and limit
        return failures
          .sort((a, b) => {
            const aTime = a.completedAt?.getTime() || 0
            const bTime = b.completedAt?.getTime() || 0
            return bTime - aTime
          })
          .slice(0, limit)
      }, 'get recent webhook failures')
    } catch (error) {
      logger.error('Failed to get recent webhook failures', { error })
      return []
    }
  }

  /**
   * Clean up old webhook delivery tracking data
   */
  public async cleanupOldData(): Promise<number> {
    try {
      return await redisService.executeCommand(async () => {
        const pattern = this.keyPrefix + '*'
        const keys = await redisService.getClient().keys(pattern)

        let cleanedCount = 0
        const cutoffTime = Date.now() - this.maxTrackingDays * 24 * 60 * 60 * 1000

        for (const key of keys) {
          const statusData = await redisService.getClient().get(key)
          if (statusData) {
            const status: WebhookDeliveryStatus = JSON.parse(statusData)
            const createdTime = new Date(status.createdAt).getTime()

            if (createdTime < cutoffTime) {
              await redisService.getClient().del(key)
              cleanedCount++
            }
          }
        }

        logger.info('Cleaned up old webhook delivery data', { cleanedCount })
        return cleanedCount
      }, 'cleanup old webhook data')
    } catch (error) {
      logger.error('Failed to cleanup old webhook data', { error })
      return 0
    }
  }

  /**
   * Update delivery statistics
   */
  private async updateStats(status: WebhookDeliveryStatus): Promise<void> {
    try {
      const statsData = await redisService.getClient().get(this.statsKey)
      let stats: WebhookDeliveryStats = statsData
        ? JSON.parse(statsData)
        : {
            totalDeliveries: 0,
            successfulDeliveries: 0,
            failedDeliveries: 0,
            averageAttempts: 0,
            successRate: 0,
            commonErrors: [],
          }

      // Update counters only when delivery is complete
      if (status.status === 'delivered' || status.status === 'failed') {
        const wasAlreadyCounted = status.deliveryResults.length > 1

        if (!wasAlreadyCounted) {
          stats.totalDeliveries++

          if (status.status === 'delivered') {
            stats.successfulDeliveries++
          } else {
            stats.failedDeliveries++

            // Track common errors
            if (status.lastError) {
              const existingError = stats.commonErrors.find((e) => e.error === status.lastError)
              if (existingError) {
                existingError.count++
              } else {
                stats.commonErrors.push({ error: status.lastError, count: 1 })
              }

              // Keep only top 10 most common errors
              stats.commonErrors = stats.commonErrors.sort((a, b) => b.count - a.count).slice(0, 10)
            }
          }

          // Recalculate derived stats
          stats.successRate =
            stats.totalDeliveries > 0 ? stats.successfulDeliveries / stats.totalDeliveries : 0

          // Calculate average attempts (simplified)
          const totalAttempts = stats.successfulDeliveries + stats.failedDeliveries * 5 // Assume failed ones used max retries
          stats.averageAttempts =
            stats.totalDeliveries > 0 ? totalAttempts / stats.totalDeliveries : 0
        }
      }

      // Save updated stats with TTL
      const ttl = this.maxTrackingDays * 24 * 60 * 60
      await redisService.getClient().setex(this.statsKey, ttl, JSON.stringify(stats))
    } catch (error) {
      logger.error('Failed to update webhook stats', { error })
    }
  }

  /**
   * Check conditions for alerting
   */
  private async checkAlertConditions(status: WebhookDeliveryStatus): Promise<void> {
    try {
      const stats = await this.getDeliveryStats()

      // Alert if success rate drops below threshold
      if (stats.totalDeliveries >= 10 && stats.successRate < this.alertThreshold) {
        logger.error('Webhook delivery success rate alert', {
          successRate: stats.successRate,
          threshold: this.alertThreshold,
          totalDeliveries: stats.totalDeliveries,
          failedDeliveries: stats.failedDeliveries,
        })
      }

      // Alert for specific webhook failure
      logger.warn('Webhook delivery failed after all retries', {
        id: status.id,
        url: status.url,
        jobId: status.jobId,
        attempts: status.attempts,
        lastError: status.lastError,
        duration: status.completedAt
          ? status.completedAt.getTime() - status.createdAt.getTime()
          : 0,
      })
    } catch (error) {
      logger.error('Failed to check webhook alert conditions', { error })
    }
  }
}

// Export singleton instance
export default WebhookDeliveryTracker.getInstance()
