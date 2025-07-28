import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import ApiKey from '#models/api_key'

export default class ApiKeyUsage extends BaseModel {
  static table = 'api_key_usage'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare apiKeyId: number

  @column()
  declare endpoint: string

  @column()
  declare method: string

  @column()
  declare statusCode: number

  @column()
  declare responseTime: number

  @column()
  declare userAgent: string | null

  @column()
  declare ipAddress: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => ApiKey)
  declare apiKey: BelongsTo<typeof ApiKey>

  /**
   * Record API key usage
   */
  static async recordUsage(
    apiKeyId: number,
    endpoint: string,
    method: string,
    statusCode: number,
    responseTime: number,
    userAgent?: string,
    ipAddress?: string
  ): Promise<ApiKeyUsage> {
    return await ApiKeyUsage.create({
      apiKeyId,
      endpoint,
      method,
      statusCode,
      responseTime,
      userAgent,
      ipAddress,
    })
  }

  /**
   * Get usage statistics for an API key
   */
  static async getUsageStats(apiKeyId: number, timeframe: 'hour' | 'day' | 'week' = 'day') {
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

    const usage = await ApiKeyUsage.query()
      .where('api_key_id', apiKeyId)
      .where('created_at', '>=', startTime.toJSDate())
      .orderBy('created_at', 'desc')

    const totalRequests = usage.length
    const successfulRequests = usage.filter((u) => u.statusCode >= 200 && u.statusCode < 400).length
    const errorRequests = usage.filter((u) => u.statusCode >= 400).length
    const avgResponseTime =
      totalRequests > 0 ? usage.reduce((sum, u) => sum + u.responseTime, 0) / totalRequests : 0

    // Group by endpoint
    const endpointStats = usage.reduce(
      (acc, u) => {
        if (!acc[u.endpoint]) {
          acc[u.endpoint] = { count: 0, errors: 0, avgResponseTime: 0 }
        }
        acc[u.endpoint].count++
        if (u.statusCode >= 400) {
          acc[u.endpoint].errors++
        }
        return acc
      },
      {} as Record<string, { count: number; errors: number; avgResponseTime: number }>
    )

    // Calculate average response times per endpoint
    Object.keys(endpointStats).forEach((endpoint) => {
      const endpointUsage = usage.filter((u) => u.endpoint === endpoint)
      endpointStats[endpoint].avgResponseTime =
        endpointUsage.length > 0
          ? endpointUsage.reduce((sum, u) => sum + u.responseTime, 0) / endpointUsage.length
          : 0
    })

    return {
      totalRequests,
      successfulRequests,
      errorRequests,
      errorRate: totalRequests > 0 ? (errorRequests / totalRequests) * 100 : 0,
      avgResponseTime,
      endpointStats,
      timeframe,
      periodStart: startTime.toISO(),
      periodEnd: now.toISO(),
    }
  }

  /**
   * Get recent usage for an API key
   */
  static async getRecentUsage(apiKeyId: number, limit: number = 50) {
    return await ApiKeyUsage.query()
      .where('api_key_id', apiKeyId)
      .orderBy('created_at', 'desc')
      .limit(limit)
  }
}
