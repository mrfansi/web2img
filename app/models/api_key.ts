import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import { randomBytes } from 'node:crypto'

export default class ApiKey extends BaseModel {
  static table = 'api_keys'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare key: string

  @column()
  declare name: string

  @column()
  declare userId: number

  @column()
  declare rateLimit: number

  @column()
  declare isActive: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>

  /**
   * Generate a new API key
   */
  static generateKey(): string {
    return randomBytes(32).toString('hex')
  }

  /**
   * Create a new API key for a user
   */
  static async createForUser(userId: number, name: string, rateLimit: number = 1000): Promise<ApiKey> {
    const apiKey = new ApiKey()
    apiKey.key = this.generateKey()
    apiKey.name = name
    apiKey.userId = userId
    apiKey.rateLimit = rateLimit
    apiKey.isActive = true
    
    await apiKey.save()
    return apiKey
  }

  /**
   * Find an active API key by key string
   */
  static async findByKey(key: string): Promise<ApiKey | null> {
    return await ApiKey.query()
      .where('key', key)
      .where('is_active', true)
      .preload('user')
      .first()
  }

  /**
   * Deactivate the API key
   */
  async deactivate(): Promise<void> {
    this.isActive = false
    await this.save()
  }

  /**
   * Activate the API key
   */
  async activate(): Promise<void> {
    this.isActive = true
    await this.save()
  }

  /**
   * Update the rate limit for this API key
   */
  async updateRateLimit(newLimit: number): Promise<void> {
    this.rateLimit = newLimit
    await this.save()
  }

  /**
   * Check if the API key is active
   */
  get active(): boolean {
    return this.isActive
  }
}