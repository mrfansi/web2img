import redis from '@adonisjs/redis/services/main'
import { Exception } from '@adonisjs/core/exceptions'
import logger from '@adonisjs/core/services/logger'

/**
 * Redis service wrapper that provides connection pooling,
 * health checks, and error handling for Redis operations
 */
export class RedisService {
  private static instance: RedisService
  private healthCheckInterval: NodeJS.Timeout | null = null
  private isHealthy: boolean = true

  /**
   * Get singleton instance of RedisService
   */
  public static getInstance(): RedisService {
    if (!RedisService.instance) {
      RedisService.instance = new RedisService()
    }
    return RedisService.instance
  }

  /**
   * Initialize Redis service with health monitoring
   */
  public async initialize(): Promise<void> {
    try {
      await this.healthCheck()
      this.startHealthMonitoring()
      logger.info('Redis service initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize Redis service', { error })
      throw new Exception('Redis initialization failed', {
        status: 500,
        code: 'REDIS_INIT_FAILED'
      })
    }
  }

  /**
   * Perform Redis health check
   */
  public async healthCheck(): Promise<boolean> {
    try {
      const startTime = Date.now()
      await redis.ping()
      const responseTime = Date.now() - startTime
      
      this.isHealthy = true
      logger.debug('Redis health check passed', { responseTime })
      return true
    } catch (error) {
      this.isHealthy = false
      logger.error('Redis health check failed', { error })
      return false
    }
  }

  /**
   * Get Redis connection health status
   */
  public isConnectionHealthy(): boolean {
    return this.isHealthy
  }

  /**
   * Get Redis connection info
   */
  public async getConnectionInfo(): Promise<{
    status: string
    uptime: number
    connectedClients: number
    usedMemory: string
    totalSystemMemory: string
  }> {
    try {
      const info = await redis.info('server')
      const memory = await redis.info('memory')
      const clients = await redis.info('clients')

      // Parse info strings to extract relevant data
      const serverInfo = this.parseRedisInfo(info)
      const memoryInfo = this.parseRedisInfo(memory)
      const clientInfo = this.parseRedisInfo(clients)

      return {
        status: 'connected',
        uptime: parseInt(serverInfo.uptime_in_seconds || '0'),
        connectedClients: parseInt(clientInfo.connected_clients || '0'),
        usedMemory: memoryInfo.used_memory_human || '0B',
        totalSystemMemory: memoryInfo.total_system_memory_human || '0B'
      }
    } catch (error) {
      logger.error('Failed to get Redis connection info', { error })
      throw new Exception('Failed to get Redis connection info', {
        status: 500,
        code: 'REDIS_INFO_FAILED'
      })
    }
  }

  /**
   * Get Redis client instance
   */
  public getClient() {
    return redis
  }

  /**
   * Execute Redis command with error handling
   */
  public async executeCommand<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    try {
      if (!this.isHealthy) {
        await this.healthCheck()
        if (!this.isHealthy) {
          throw new Exception(`Redis is unhealthy, cannot execute ${operationName}`, {
            status: 503,
            code: 'REDIS_UNHEALTHY'
          })
        }
      }

      return await operation()
    } catch (error) {
      logger.error(`Redis operation failed: ${operationName}`, { error })
      
      // Mark as unhealthy if connection error
      if (this.isConnectionError(error)) {
        this.isHealthy = false
      }

      throw new Exception(`Redis operation failed: ${operationName}`, {
        status: 500,
        code: 'REDIS_OPERATION_FAILED',
        cause: error
      })
    }
  }

  /**
   * Start periodic health monitoring
   */
  private startHealthMonitoring(): void {
    // Check health every 30 seconds
    this.healthCheckInterval = setInterval(async () => {
      await this.healthCheck()
    }, 30000)
  }

  /**
   * Stop health monitoring
   */
  public stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }

  /**
   * Parse Redis INFO command output
   */
  private parseRedisInfo(info: string): Record<string, string> {
    const result: Record<string, string> = {}
    const lines = info.split('\r\n')
    
    for (const line of lines) {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split(':')
        if (key && value) {
          result[key] = value
        }
      }
    }
    
    return result
  }

  /**
   * Check if error is a connection-related error
   */
  private isConnectionError(error: any): boolean {
    const connectionErrors = [
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'ECONNRESET',
      'Connection is closed'
    ]
    
    const errorMessage = error?.message || ''
    return connectionErrors.some(errorType => errorMessage.includes(errorType))
  }

  /**
   * Graceful shutdown
   */
  public async shutdown(): Promise<void> {
    this.stopHealthMonitoring()
    try {
      await redis.quit()
      logger.info('Redis service shutdown completed')
    } catch (error) {
      logger.error('Error during Redis service shutdown', { error })
    }
  }
}

// Export singleton instance
export default RedisService.getInstance()