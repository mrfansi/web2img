import User from '#models/user'
import { LoginData } from '#validators/auth_validators'
import logger from '@adonisjs/core/services/logger'

/**
 * Authentication service for handling login/logout operations
 */
export class AuthService {
  /**
   * Authenticate user with email and password
   */
  async authenticateUser(credentials: LoginData): Promise<{ user: User; token: any }> {
    try {
      const user = await User.verifyCredentials(credentials.email, credentials.password)
      const token = await User.accessTokens.create(user)
      
      logger.info(`User authenticated successfully: ${user.email}`)
      
      return { user, token }
    } catch (error) {
      logger.warn(`Authentication failed for email: ${credentials.email}`)
      throw error
    }
  }

  /**
   * Create authentication cookie configuration
   */
  createCookieConfig() {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }

  /**
   * Generate login redirect URL with error
   */
  getLoginErrorUrl(error: string): string {
    return `/auth/login?error=${encodeURIComponent(error)}`
  }

  /**
   * Generate login redirect URL with success message
   */
  getLoginSuccessUrl(message?: string): string {
    const url = '/auth/login'
    return message ? `${url}?success=${encodeURIComponent(message)}` : url
  }

  /**
   * Get dashboard URL
   */
  getDashboardUrl(): string {
    return '/dashboard'
  }

  /**
   * Validate token (for future use)
   */
  async validateToken(token: string): Promise<User | null> {
    try {
      // This would implement token validation logic
      // For now, this is a placeholder
      return null
    } catch (error) {
      logger.error('Token validation failed:', error)
      return null
    }
  }

  /**
   * Revoke token (for future use)
   */
  async revokeToken(token: string): Promise<void> {
    try {
      // This would implement token revocation logic
      // For now, this is a placeholder
      logger.info('Token revoked')
    } catch (error) {
      logger.error('Token revocation failed:', error)
      throw error
    }
  }
}
