import User from '#models/user'
import { CreateUserData, UpdateUserData } from '#validators/auth_validators'
import { UserData } from '#types/api_responses'
import logger from '@adonisjs/core/services/logger'

/**
 * User service for handling user CRUD operations
 */
export class UserService {
  /**
   * Get all users with pagination support
   */
  async getAllUsers(options: {
    page?: number
    limit?: number
    orderBy?: string
    orderDirection?: 'asc' | 'desc'
  } = {}): Promise<UserData[]> {
    const {
      page = 1,
      limit = 50,
      orderBy = 'createdAt',
      orderDirection = 'desc'
    } = options

    console.log('UserService.getAllUsers called with options:', options)

    const users = await User.query()
      .select('id', 'fullName', 'email', 'createdAt')
      .orderBy(orderBy, orderDirection)
      .limit(limit)
      .offset((page - 1) * limit)

    console.log('UserService.getAllUsers found users:', users.length)

    return users.map(user => this.transformUserData(user))
  }

  /**
   * Get user by ID
   */
  async getUserById(id: number): Promise<UserData | null> {
    const user = await User.find(id)
    return user ? this.transformUserData(user) : null
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    return await User.findBy('email', email)
  }

  /**
   * Create a new user
   */
  async createUser(userData: CreateUserData): Promise<UserData> {
    // Check if user already exists
    const existingUser = await this.getUserByEmail(userData.email)
    if (existingUser) {
      throw new Error('USER_EXISTS')
    }

    const user = await User.create({
      fullName: userData.fullName,
      email: userData.email.toLowerCase(),
      password: userData.password
    })

    logger.info(`User created successfully: ${user.email}`)

    return this.transformUserData(user)
  }

  /**
   * Update user
   */
  async updateUser(id: number, userData: UpdateUserData): Promise<UserData> {
    const user = await User.findOrFail(id)

    if (userData.email && userData.email !== user.email) {
      const existingUser = await this.getUserByEmail(userData.email)
      if (existingUser && existingUser.id !== id) {
        throw new Error('USER_EXISTS')
      }
    }

    user.merge({
      ...(userData.fullName && { fullName: userData.fullName }),
      ...(userData.email && { email: userData.email.toLowerCase() })
    })

    await user.save()

    logger.info(`User updated successfully: ${user.email}`)

    return this.transformUserData(user)
  }

  /**
   * Delete user
   */
  async deleteUser(id: number): Promise<void> {
    const user = await User.find(id)
    if (!user) {
      throw new Error('USER_NOT_FOUND')
    }

    await user.delete()

    logger.info(`User deleted successfully: ${user.email}`)
  }

  /**
   * Check if user exists
   */
  async userExists(email: string): Promise<boolean> {
    const user = await this.getUserByEmail(email)
    return !!user
  }

  /**
   * Get user count
   */
  async getUserCount(): Promise<number> {
    const result = await User.query().count('* as total').first()
    return result?.$extras.total || 0
  }

  /**
   * Transform user model to UserData
   */
  private transformUserData(user: User): UserData {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      createdAt: user.createdAt.toISO()
    }
  }

  /**
   * Search users by name or email
   */
  async searchUsers(query: string, limit: number = 20): Promise<UserData[]> {
    const users = await User.query()
      .select('id', 'fullName', 'email', 'createdAt')
      .where('fullName', 'like', `%${query}%`)
      .orWhere('email', 'like', `%${query}%`)
      .orderBy('createdAt', 'desc')
      .limit(limit)

    return users.map(user => this.transformUserData(user))
  }
}
