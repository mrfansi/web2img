import { Redis } from 'ioredis'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'

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
  private client: Redis | null = null
  private isShuttingDown = false
  private openConnections: Set<Redis> = new Set()

  private constructor() { }

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
  public getClient(): Redis {
    if (!this.client) {
      this.client = this.createRedisClient()
      this.setupEventListeners(this.client, 'main')
      this.trackConnection(this.client)
    }
    return this.client
  }

  /**
   * Create a duplicate connection for BullMQ or other use cases that need dedicated connections
   */
  public duplicate(): Redis {
    const baseClient = this.getClient()
    const duplicateClient = baseClient.duplicate()
    this.setupEventListeners(duplicateClient, 'duplicate')
    this.trackConnection(duplicateClient)
    return duplicateClient
  }

  /**
   * Create a duplicate connection without keyPrefix for BullMQ
   * BullMQ manages its own prefixing and doesn't support ioredis keyPrefix
   */
  public duplicateForBullMQ(): Redis {
    // Create a new Redis connection specifically for BullMQ without keyPrefix
    const config = {
      host: env.get('REDIS_HOST'),
      port: env.get('REDIS_PORT'),
      password: env.get('REDIS_PASSWORD'),
      db: env.get('REDIS_DB'),
      // NOTE: No keyPrefix for BullMQ - it manages its own prefixing
      // Connection settings for reliability
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true, // Don't connect immediately, wait for first command
      // Keepalive settings
      keepAlive: 30000,
      // Timeout settings
      connectTimeout: 10000,
      commandTimeout: 5000,
    }

    const bullmqClient = new Redis(config)
    this.setupEventListeners(bullmqClient, 'bullmq-duplicate')
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
    return Array.from(this.openConnections).map(client => ({
      status: client.status
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
        logger.warn('CentralRedisManager: Error during connection quit, forcing disconnect', { error })
        try {
          connection.disconnect()
        } catch (disconnectError) {
          logger.error('CentralRedisManager: Error during forced disconnect', {
            error: disconnectError
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
   * Create a new Redis client with configuration from environment variables
   */
  private createRedisClient(): Redis {
    const config = {
      host: env.get('REDIS_HOST'),
      port: env.get('REDIS_PORT'),
      password: env.get('REDIS_PASSWORD'),
      db: env.get('REDIS_DB'),
      keyPrefix: 'web2img:',
      // Connection settings for reliability
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true, // Don't connect immediately, wait for first command
      // Keepalive settings
      keepAlive: 30000,
      // Timeout settings
      connectTimeout: 10000,
      commandTimeout: 5000,
    }

    logger.info('CentralRedisManager: Creating Redis client', {
      host: config.host,
      port: config.port,
      db: config.db,
      keyPrefix: config.keyPrefix,
    })

    return new Redis(config)
  }

  /**
   * Track a Redis connection for leak detection
   */
  private trackConnection(client: Redis): void {
    this.openConnections.add(client)
    logger.info(`CentralRedisManager: Tracking connection (total: ${this.openConnections.size})`)
  }

  /**
   * Stop tracking a Redis connection
   */
  private untrackConnection(client: Redis): void {
    this.openConnections.delete(client)
    logger.info(`CentralRedisManager: Stopped tracking connection (total: ${this.openConnections.size})`)
  }

  /**
   * Setup event listeners for Redis connection monitoring
   */
  private setupEventListeners(client: Redis, clientType: string): void {
    client.on('connect', () => {
      logger.info(`CentralRedisManager: Redis ${clientType} client connected`)
    })

    client.on('ready', () => {
      logger.info(`CentralRedisManager: Redis ${clientType} client ready`)
    })

    client.on('error', (error) => {
      logger.error(`CentralRedisManager: Redis ${clientType} client error`, {
        error: error.message,
        stack: error.stack
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
