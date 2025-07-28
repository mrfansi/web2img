import redis from '@adonisjs/redis/services/main'
import { Redis } from 'ioredis'
import logger from '@adonisjs/core/services/logger'
import config from '@adonisjs/core/services/config'

// Type for AdonisJS Redis connection - this is what redis.connection() actually returns
export type RedisConnection = ReturnType<typeof redis.connection>

/**
 * CentralRedisManager - A singleton class for managing Redis connections
 *
 * Provides a centralized way to manage Redis connections with:
 * - Lazy initialization of a shared ioredis instance
 * - Connection duplication for BullMQ and other use cases
 * - Graceful shutdown capabilities
 * - Test-friendly reset functionality
 * - Comprehensive logging of connection events
 */
export class CentralRedisManager {
  private static instance: CentralRedisManager | null = null
  private client: RedisConnection | null = null
  private isShuttingDown = false
  private openConnections: Set<RedisConnection | Redis> = new Set()

  private constructor() {}

  /**
   * Get the singleton instance of CentralRedisManager
   */
  public static getInstance(): CentralRedisManager {
    if (!CentralRedisManager.instance) {
      CentralRedisManager.instance = new CentralRedisManager()
    }
    return CentralRedisManager.instance
  }

  /**
   * Get the shared Redis client instance (lazily initialized)
   */
  public getClient(): RedisConnection {
    if (!this.client) {
      // Get the underlying ioredis instance from AdonisJS Redis service
      this.client = redis.connection()
      this.setupEventListeners(this.client, 'main')
      this.trackConnection(this.client)
    }
    return this.client
  }

  /**
   * Create a duplicate connection for BullMQ or other use cases that need dedicated connections
   */
  public duplicate(): RedisConnection {
    // For AdonisJS, we create a new connection instance rather than duplicating
    // This provides the same isolation benefits
    const duplicateClient = redis.connection()
    this.setupEventListeners(duplicateClient, 'duplicate')
    this.trackConnection(duplicateClient)
    return duplicateClient
  }

  /**
   * Create a raw ioredis connection for services that need direct ioredis access
   */
  public duplicateRawRedis(): Redis {
    // Create a new Redis connection using ioredis directly with the same config
    const redisConfig = config.get<any>('redis')
    const connectionConfig = redisConfig.connections.main

    const rawClient = new Redis({
      host: connectionConfig.host,
      port: connectionConfig.port,
      password: connectionConfig.password,
      db: connectionConfig.db,
      keyPrefix: connectionConfig.keyPrefix || '',
    })

    this.setupEventListenersForIORedis(rawClient, 'raw-duplicate')
    this.trackConnection(rawClient)
    return rawClient
  }

  /**
   * Create a duplicate connection without keyPrefix for BullMQ
   * BullMQ manages its own prefixing and doesn't support ioredis keyPrefix
   */
  public duplicateForBullMQ(): Redis {
    // For BullMQ, we need the raw ioredis instance, not the AdonisJS wrapper
    // Create a new Redis connection using ioredis directly with the same config
    const redisConfig = config.get<any>('redis')
    const connectionConfig = redisConfig.connections.main

    const bullmqClient = new Redis({
      host: connectionConfig.host,
      port: connectionConfig.port,
      password: connectionConfig.password,
      db: connectionConfig.db,
      // BullMQ specific settings - no keyPrefix
      keyPrefix: '',
      maxRetriesPerRequest: null, // Required by BullMQ
      lazyConnect: true, // Don't connect immediately, wait for first command
    })

    this.setupEventListenersForIORedis(bullmqClient, 'bullmq-duplicate')
    this.trackConnection(bullmqClient)
    return bullmqClient
  }

  /**
   * Get the count of currently open Redis connections
   * Used primarily for leak detection in tests
   */
  public getOpenConnectionsCount(): number {
    return this.openConnections.size
  }

  /**
   * Get a list of open connection statuses for debugging
   */
  public getOpenConnectionsInfo(): Array<{ status: string }> {
    return Array.from(this.openConnections).map((client) => ({
      status: client.status,
    }))
  }

  /**
   * Gracefully shutdown all Redis connections
   */
  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return
    }

    this.isShuttingDown = true
    logger.info('CentralRedisManager: Starting graceful shutdown')

    // Close all tracked connections
    const connections = Array.from(this.openConnections)
    for (const connection of connections) {
      try {
        await connection.quit()
        logger.info('CentralRedisManager: Connection gracefully quit')
      } catch (error) {
        logger.warn('CentralRedisManager: Error during connection quit, forcing disconnect', {
          error,
        })
        try {
          connection.disconnect()
        } catch (disconnectError) {
          logger.error('CentralRedisManager: Error during forced disconnect', {
            error: disconnectError,
          })
        }
      }
    }

    // Clear the connections set
    this.openConnections.clear()

    if (this.client) {
      this.client = null
    }

    this.isShuttingDown = false
    logger.info('CentralRedisManager: Shutdown complete')
  }

  /**
   * Force reset the manager (primarily for testing)
   * This will close connections and reset the singleton instance
   */
  public static async forceReset(): Promise<void> {
    if (CentralRedisManager.instance) {
      await CentralRedisManager.instance.shutdown()
      CentralRedisManager.instance = null
    }
  }

  /**
   * Perform health check on Redis connection
   */
  public async healthCheck(): Promise<{ healthy: boolean; details?: any; error?: string }> {
    try {
      const client = this.getClient()
      const startTime = Date.now()

      // Test basic connectivity with ping
      const pingResult = await client.ping()
      const responseTime = Date.now() - startTime

      if (pingResult !== 'PONG') {
        return {
          healthy: false,
          error: 'Redis ping failed',
          details: { pingResult, responseTime },
        }
      }

      // Test basic read/write operation
      const testKey = 'health_check:' + Date.now()
      await client.set(testKey, 'test', 'EX', 10)
      const testValue = await client.get(testKey)
      await client.del(testKey)

      if (testValue !== 'test') {
        return {
          healthy: false,
          error: 'Redis read/write test failed',
          details: { testValue, responseTime },
        }
      }

      return {
        healthy: true,
        details: {
          responseTime,
          openConnections: this.getOpenConnectionsCount(),
          connectionInfo: this.getOpenConnectionsInfo(),
        },
      }
    } catch (error) {
      return {
        healthy: false,
        error: error.message || 'Redis health check failed',
        details: {
          openConnections: this.getOpenConnectionsCount(),
          isShuttingDown: this.isShuttingDown,
        },
      }
    }
  }

  /**
   * Track a Redis connection for leak detection
   */
  private trackConnection(client: RedisConnection | Redis): void {
    this.openConnections.add(client)
    logger.info(`CentralRedisManager: Tracking connection (total: ${this.openConnections.size})`)
  }

  /**
   * Stop tracking a Redis connection
   */
  private untrackConnection(client: RedisConnection | Redis): void {
    this.openConnections.delete(client)
    logger.info(
      `CentralRedisManager: Stopped tracking connection (total: ${this.openConnections.size})`
    )
  }

  /**
   * Setup event listeners for Redis connection monitoring (AdonisJS connections)
   */
  private setupEventListeners(client: RedisConnection, clientType: string): void {
    client.on('connect', () => {
      logger.info(`CentralRedisManager: Redis ${clientType} client connected`)
    })

    client.on('ready', () => {
      logger.info(`CentralRedisManager: Redis ${clientType} client ready`)
    })

    client.on('error', (error: any) => {
      logger.error(`CentralRedisManager: Redis ${clientType} client error`, {
        error: error?.message || String(error),
        stack: error?.stack || undefined,
      })
    })

    client.on('close', () => {
      logger.info(`CentralRedisManager: Redis ${clientType} client connection closed`)
      this.untrackConnection(client)
    })

    client.on('reconnecting', (ms: any) => {
      logger.warn(`CentralRedisManager: Redis ${clientType} client reconnecting in ${ms}ms`)
    })

    client.on('end', () => {
      logger.info(`CentralRedisManager: Redis ${clientType} client connection ended`)
      this.untrackConnection(client)
    })
  }

  /**
   * Setup event listeners for ioredis connections (raw Redis instances for BullMQ)
   */
  private setupEventListenersForIORedis(client: Redis, clientType: string): void {
    client.on('connect', () => {
      logger.info(`CentralRedisManager: Redis ${clientType} client connected`)
    })

    client.on('ready', () => {
      logger.info(`CentralRedisManager: Redis ${clientType} client ready`)
    })

    client.on('error', (error: any) => {
      logger.error(`CentralRedisManager: Redis ${clientType} client error`, {
        error: error?.message || String(error),
        stack: error?.stack || undefined,
      })
    })

    client.on('close', () => {
      logger.info(`CentralRedisManager: Redis ${clientType} client connection closed`)
      this.untrackConnection(client)
    })

    client.on('reconnecting', (ms: any) => {
      logger.warn(`CentralRedisManager: Redis ${clientType} client reconnecting in ${ms}ms`)
    })

    client.on('end', () => {
      logger.info(`CentralRedisManager: Redis ${clientType} client connection ended`)
      this.untrackConnection(client)
    })
  }
}

// Export a convenience function to get the singleton instance
export const getCentralRedisManager = (): CentralRedisManager => {
  return CentralRedisManager.getInstance()
}

// Export default instance for easy importing
export default CentralRedisManager.getInstance()
