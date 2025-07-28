import { createHash } from 'node:crypto'
import { Exception } from '@adonisjs/core/exceptions'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import redisService from '#services/redis_service'

/**
 * Screenshot options interface for cache key generation
 */
export interface ScreenshotOptions {
  format: 'png' | 'jpeg' | 'webp'
  width: number
  height: number
  timeout?: number
}

/**
 * Cache statistics interface
 */
export interface CacheStats {
  totalKeys: number
  memoryUsage: string
  hitRate?: number
  missRate?: number
}

/**
 * Cache service for managing screenshot caching with Redis
 * Provides get, set, delete operations with TTL management
 */
export class CacheService {
  private static instance: CacheService
  private readonly keyPrefix = 'screenshot:cache:'
  private readonly lockPrefix = 'screenshot:lock:'
  private readonly defaultTtl: number

  constructor() {
    this.defaultTtl = env.get('SCREENSHOT_CACHE_TTL', 3600) // Default 1 hour
  }

  /**
   * Get singleton instance of CacheService
   */
  public static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService()
    }
    return CacheService.instance
  }

  /**
   * Get cached screenshot URL by cache key
   */
  public async get(key: string): Promise<string | null> {
    try {
      const fullKey = this.keyPrefix + key

      return await redisService.executeCommand(
        async () => {
          const result = await redisService.getClient().get(fullKey)
          if (result) {
            logger.debug('Cache hit', { key: fullKey })
          } else {
            logger.debug('Cache miss', { key: fullKey })
          }
          return result
        },
        'cache get'
      )
    } catch (error) {
      logger.error('Cache get operation failed', { key, error })
      return null // Return null on cache errors to allow fallback
    }
  }

  /**
   * Get cache expiration time for a key
   */
  public async getExpirationTime(key: string): Promise<Date | null> {
    try {
      const fullKey = this.keyPrefix + key

      return await redisService.executeCommand(
        async () => {
          const ttl = await redisService.getClient().ttl(fullKey)
          if (ttl > 0) {
            return new Date(Date.now() + (ttl * 1000))
          }
          return null
        },
        'cache get expiration'
      )
    } catch (error) {
      logger.error('Cache expiration check failed', { key, error })
      return null
    }
  }

  /**
   * Get default cache TTL in seconds
   */
  public getDefaultTtl(): number {
    return this.defaultTtl
  }

  /**
   * Set cached screenshot URL with TTL
   */
  public async set(key: string, value: string, ttl?: number): Promise<void> {
    try {
      const fullKey = this.keyPrefix + key
      const cacheTtl = ttl || this.defaultTtl

      await redisService.executeCommand(
        async () => {
          await redisService.getClient().setex(fullKey, cacheTtl, value)
          logger.debug('Cache set', { key: fullKey, ttl: cacheTtl })
        },
        'cache set'
      )
    } catch (error) {
      logger.error('Cache set operation failed', { key, value, ttl, error })
      // Don't throw error for cache set failures to avoid breaking the main flow
    }
  }

  /**
   * Delete cached screenshot
   */
  public async del(key: string): Promise<void> {
    try {
      const fullKey = this.keyPrefix + key

      await redisService.executeCommand(
        async () => {
          const result = await redisService.getClient().del(fullKey)
          logger.debug('Cache delete', { key: fullKey, deleted: result > 0 })
        },
        'cache delete'
      )
    } catch (error) {
      logger.error('Cache delete operation failed', { key, error })
      // Don't throw error for cache delete failures
    }
  }

  /**
   * Generate cache key using URL and screenshot options
   * Uses original URL for consistent caching across transformations
   */
  public generateCacheKey(url: string, options: ScreenshotOptions): string {
    // Normalize URL for consistent caching
    const normalizedUrl = this.normalizeUrl(url)

    // Create hash input from URL and options
    const hashInput = JSON.stringify({
      url: normalizedUrl,
      format: options.format,
      width: options.width,
      height: options.height
      // Note: timeout is not included in cache key as it doesn't affect the result
    })

    // Generate SHA-256 hash for cache key
    const hash = createHash('sha256').update(hashInput).digest('hex')

    logger.debug('Generated cache key', {
      url: normalizedUrl,
      options,
      key: hash.substring(0, 16) + '...'
    })

    return hash
  }

  /**
   * Check if a URL is currently being processed (to prevent duplicate processing)
   */
  public async isProcessing(url: string): Promise<boolean> {
    try {
      const lockKey = this.lockPrefix + this.normalizeUrl(url)

      return await redisService.executeCommand(
        async () => {
          const result = await redisService.getClient().exists(lockKey)
          return result === 1
        },
        'check processing lock'
      )
    } catch (error) {
      logger.error('Failed to check processing lock', { url, error })
      return false // Assume not processing on error
    }
  }

  /**
   * Set processing lock for a URL (with TTL to prevent stuck locks)
   */
  public async setProcessingLock(url: string, ttl: number = 300): Promise<void> {
    try {
      const lockKey = this.lockPrefix + this.normalizeUrl(url)
      const timestamp = Date.now().toString()

      await redisService.executeCommand(
        async () => {
          await redisService.getClient().setex(lockKey, ttl, timestamp)
          logger.debug('Set processing lock', { url, lockKey, ttl })
        },
        'set processing lock'
      )
    } catch (error) {
      logger.error('Failed to set processing lock', { url, error })
      // Don't throw error for lock failures
    }
  }

  /**
   * Remove processing lock for a URL
   */
  public async removeProcessingLock(url: string): Promise<void> {
    try {
      const lockKey = this.lockPrefix + this.normalizeUrl(url)

      await redisService.executeCommand(
        async () => {
          await redisService.getClient().del(lockKey)
          logger.debug('Removed processing lock', { url, lockKey })
        },
        'remove processing lock'
      )
    } catch (error) {
      logger.error('Failed to remove processing lock', { url, error })
      // Don't throw error for lock removal failures
    }
  }

  /**
   * Clear expired cache entries (manual cleanup)
   */
  public async clearExpired(): Promise<number> {
    try {
      return await redisService.executeCommand(
        async () => {
          const pattern = this.keyPrefix + '*'
          const keys = await redisService.getClient().keys(pattern)

          let expiredCount = 0
          for (const key of keys) {
            const ttl = await redisService.getClient().ttl(key)
            if (ttl === -1) { // Key exists but has no TTL
              await redisService.getClient().del(key)
              expiredCount++
            }
          }

          logger.info('Cleared expired cache entries', { count: expiredCount })
          return expiredCount
        },
        'clear expired cache'
      )
    } catch (error) {
      logger.error('Failed to clear expired cache entries', { error })
      return 0
    }
  }

  /**
   * Get cache statistics
   */
  public async getStats(): Promise<CacheStats> {
    try {
      return await redisService.executeCommand(
        async () => {
          const pattern = this.keyPrefix + '*'
          const keys = await redisService.getClient().keys(pattern)
          const info = await redisService.getConnectionInfo()

          return {
            totalKeys: keys.length,
            memoryUsage: info.usedMemory
          }
        },
        'get cache stats'
      )
    } catch (error) {
      logger.error('Failed to get cache stats', { error })
      throw new Exception('Failed to get cache statistics', {
        status: 500,
        code: 'CACHE_STATS_FAILED',
        cause: error
      })
    }
  }

  /**
   * Flush all cache entries (use with caution)
   */
  public async flush(): Promise<void> {
    try {
      await redisService.executeCommand(
        async () => {
          const pattern = this.keyPrefix + '*'
          const keys = await redisService.getClient().keys(pattern)

          if (keys.length > 0) {
            await redisService.getClient().del(...keys)
            logger.info('Flushed cache entries', { count: keys.length })
          }
        },
        'flush cache'
      )
    } catch (error) {
      logger.error('Failed to flush cache', { error })
      throw new Exception('Failed to flush cache', {
        status: 500,
        code: 'CACHE_FLUSH_FAILED',
        cause: error
      })
    }
  }

  /**
   * Perform health check on cache service
   */
  public async healthCheck(): Promise<{ healthy: boolean; details?: any; error?: string }> {
    try {
      const startTime = Date.now()

      // Test basic cache operations
      const testKey = 'health_check_' + Date.now()
      const testValue = 'health_check_value'

      // Test set operation
      await this.set(testKey, testValue, 60)

      // Test get operation
      const retrievedValue = await this.get(testKey)

      // Test delete operation
      await this.del(testKey)

      const responseTime = Date.now() - startTime

      if (retrievedValue !== testValue) {
        return {
          healthy: false,
          error: 'Cache read/write test failed',
          details: {
            expected: testValue,
            retrieved: retrievedValue,
            responseTime
          }
        }
      }

      // Get cache statistics
      const stats = await this.getStats()

      return {
        healthy: true,
        details: {
          responseTime,
          cacheStats: stats,
          redisHealthy: redisService.isConnectionHealthy(),
          defaultTtl: this.defaultTtl
        }
      }
    } catch (error) {
      return {
        healthy: false,
        error: error.message || 'Cache health check failed',
        details: {
          redisHealthy: redisService.isConnectionHealthy()
        }
      }
    }
  }

  /**
   * Normalize URL for consistent caching
   * Removes query parameters that don't affect screenshot content
   */
  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url)

      // Remove common tracking parameters that don't affect content
      const paramsToRemove = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'fbclid', 'gclid', 'ref', 'source', '_ga', '_gid'
      ]

      paramsToRemove.forEach(param => {
        urlObj.searchParams.delete(param)
      })

      // Sort remaining parameters for consistency
      urlObj.searchParams.sort()

      return urlObj.toString()
    } catch (error) {
      logger.warn('Failed to normalize URL, using original', { url, error })
      return url
    }
  }
}

// Export singleton instance
export default CacheService.getInstance()