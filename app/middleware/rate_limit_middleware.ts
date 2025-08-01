import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import redis from '@adonisjs/redis/services/main'
import { DateTime } from 'luxon'

/**
 * Rate limiting middleware using sliding window algorithm
 * Requires API key authentication middleware to run first
 */
export default class RateLimitMiddleware {
  /**
   * Window size in seconds (default: 1 hour)
   */
  private windowSize = 3600

  /**
   * Handle rate limiting for authenticated API key
   */
  async handle(ctx: HttpContext, next: NextFn) {
    const { response } = ctx

    // Ensure API key is available (should be set by API key auth middleware)
    if (!ctx.apiKey) {
      return response.status(500).json({
        detail: {
          error: 'internal_error',
          message: 'Rate limiting requires API key authentication',
        },
      })
    }

    const apiKey = ctx.apiKey
    const rateLimit = apiKey.rateLimit
    const currentTime = DateTime.now().toUnixInteger()
    const windowStart = currentTime - this.windowSize

    // Redis key for this API key's rate limit window
    const redisKey = `rate_limit:${apiKey.key}`

    try {
      // Use Redis pipeline for atomic operations
      const pipeline = redis.pipeline()

      // Remove expired entries (older than window)
      pipeline.zremrangebyscore(redisKey, '-inf', windowStart)

      // Count current requests in window
      pipeline.zcard(redisKey)

      // Add current request timestamp
      pipeline.zadd(redisKey, currentTime, `${currentTime}-${Math.random()}`)

      // Set expiration for cleanup
      pipeline.expire(redisKey, this.windowSize + 60)

      const results = await pipeline.exec()

      if (!results) {
        throw new Error('Redis pipeline execution failed')
      }

      // Get count after cleanup but before adding current request
      const currentCount = results[1][1] as number

      // Check if rate limit exceeded
      if (currentCount >= rateLimit) {
        // Remove the request we just added since it's over the limit
        await redis.zrem(redisKey, `${currentTime}-${Math.random()}`)

        // Calculate retry after (time until oldest request expires)
        const oldestEntries = await redis.zrange(redisKey, 0, 0, 'WITHSCORES')
        let retryAfter = this.windowSize

        if (oldestEntries.length >= 2) {
          const oldestTimestamp = parseInt(oldestEntries[1] as string)
          retryAfter = Math.max(1, oldestTimestamp + this.windowSize - currentTime)
        }

        // Set rate limit headers
        response.header('X-RateLimit-Limit', rateLimit.toString())
        response.header('X-RateLimit-Remaining', '0')
        response.header('X-RateLimit-Reset', (currentTime + retryAfter).toString())
        response.header('Retry-After', retryAfter.toString())

        return response.status(429).json({
          detail: {
            error: 'rate_limited',
            message: `Rate limit exceeded. Maximum ${rateLimit} requests per hour allowed.`,
            retry_after: retryAfter,
          },
        })
      }

      // Set rate limit headers for successful request
      const remaining = Math.max(0, rateLimit - (currentCount + 1))
      response.header('X-RateLimit-Limit', rateLimit.toString())
      response.header('X-RateLimit-Remaining', remaining.toString())
      response.header('X-RateLimit-Reset', (currentTime + this.windowSize).toString())

      return next()
    } catch (error) {
      // Log error but don't block request on Redis failure
      console.error('Rate limiting error:', error)

      // Set basic headers and continue
      response.header('X-RateLimit-Limit', rateLimit.toString())
      response.header('X-RateLimit-Remaining', rateLimit.toString())

      return next()
    }
  }

  /**
   * Get current rate limit status for an API key
   */
  async getRateLimitStatus(apiKey: string): Promise<{
    limit: number
    remaining: number
    reset: number
    current: number
  }> {
    const currentTime = DateTime.now().toUnixInteger()
    const windowStart = currentTime - this.windowSize
    const redisKey = `rate_limit:${apiKey}`

    try {
      // Clean up expired entries and get current count
      await redis.zremrangebyscore(redisKey, '-inf', windowStart)
      const currentCount = await redis.zcard(redisKey)

      // Get API key details (this would need to be passed or looked up)
      // For now, return with a default limit
      const limit = 1000 // This should come from the API key

      return {
        limit,
        remaining: Math.max(0, limit - currentCount),
        reset: currentTime + this.windowSize,
        current: currentCount,
      }
    } catch (error) {
      console.error('Error getting rate limit status:', error)
      return {
        limit: 1000,
        remaining: 1000,
        reset: currentTime + this.windowSize,
        current: 0,
      }
    }
  }
}
