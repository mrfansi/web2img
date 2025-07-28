import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export enum ErrorLevel {
  ERROR = 'error',
  WARN = 'warn',
  FATAL = 'fatal',
}

export default class ErrorLog extends BaseModel {
  static table = 'error_logs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare level: ErrorLevel

  @column()
  declare message: string

  @column()
  declare stack: string | null

  @column()
  declare context: string | null // JSON string

  @column()
  declare endpoint: string | null

  @column()
  declare method: string | null

  @column()
  declare userAgent: string | null

  @column()
  declare ipAddress: string | null

  @column()
  declare correlationId: string | null

  @column()
  declare apiKeyId: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  /**
   * Log an error
   */
  static async logError(data: {
    level: ErrorLevel
    message: string
    stack?: string
    context?: Record<string, any>
    endpoint?: string
    method?: string
    userAgent?: string
    ipAddress?: string
    correlationId?: string
    apiKeyId?: number
  }): Promise<ErrorLog> {
    return await ErrorLog.create({
      level: data.level,
      message: data.message,
      stack: data.stack || null,
      context: data.context ? JSON.stringify(data.context) : null,
      endpoint: data.endpoint || null,
      method: data.method || null,
      userAgent: data.userAgent || null,
      ipAddress: data.ipAddress || null,
      correlationId: data.correlationId || null,
      apiKeyId: data.apiKeyId || null,
    })
  }

  /**
   * Get recent errors
   */
  static async getRecentErrors(limit: number = 100, level?: ErrorLevel) {
    const query = ErrorLog.query().orderBy('created_at', 'desc').limit(limit)

    if (level) {
      query.where('level', level)
    }

    return await query.exec()
  }

  /**
   * Get error statistics
   */
  static async getErrorStats(timeframe: 'hour' | 'day' | 'week' = 'day') {
    const now = DateTime.now()
    let startTime: DateTime

    switch (timeframe) {
      case 'hour':
        startTime = now.minus({ hours: 1 })
        break
      case 'day':
        startTime = now.minus({ days: 1 })
        break
      case 'week':
        startTime = now.minus({ weeks: 1 })
        break
    }

    const errors = await ErrorLog.query()
      .where('created_at', '>=', startTime.toJSDate())
      .orderBy('created_at', 'desc')

    const totalErrors = errors.length
    const errorsByLevel = errors.reduce(
      (acc, error) => {
        acc[error.level] = (acc[error.level] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    const errorsByEndpoint = errors
      .filter((e) => e.endpoint)
      .reduce(
        (acc, error) => {
          const endpoint = error.endpoint!
          acc[endpoint] = (acc[endpoint] || 0) + 1
          return acc
        },
        {} as Record<string, number>
      )

    // Group errors by hour for trending
    const errorTrend = errors.reduce(
      (acc, error) => {
        const hour = error.createdAt.startOf('hour').toISO()
        if (hour) {
          acc[hour] = (acc[hour] || 0) + 1
        }
        return acc
      },
      {} as Record<string, number>
    )

    return {
      totalErrors,
      errorsByLevel,
      errorsByEndpoint,
      errorTrend,
      timeframe,
      periodStart: startTime.toISO(),
      periodEnd: now.toISO(),
    }
  }

  /**
   * Clean up old error logs (older than specified days)
   */
  static async cleanup(daysToKeep: number = 30) {
    const cutoffDate = DateTime.now().minus({ days: daysToKeep })

    const deletedCount = await ErrorLog.query()
      .where('created_at', '<', cutoffDate.toJSDate())
      .delete()

    return deletedCount
  }

  /**
   * Get parsed context
   */
  get parsedContext(): Record<string, any> | null {
    if (!this.context) return null
    try {
      return JSON.parse(this.context)
    } catch {
      return null
    }
  }
}
