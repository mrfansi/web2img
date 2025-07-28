import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { Secret } from '@adonisjs/core/helpers'
import User from '#models/user'
import logger from '@adonisjs/core/services/logger'

/**
 * Dashboard authentication middleware
 * Checks for auth_token cookie and validates it
 */
export default class DashboardAuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const { request, response } = ctx

    logger.info('Dashboard auth middleware - checking auth for:', request.url())

    // Get token from cookie
    const token = request.cookie('auth_token')

    if (!token) {
      return response.redirect('/auth/login')
    }

    try {
      // Create a Secret object for verification - this is how AdonisJS expects tokens
      const tokenValue = new Secret(token)
      const accessToken = await User.accessTokens.verify(tokenValue)

      if (!accessToken) {
        response.clearCookie('auth_token')
        return response.redirect('/auth/login')
      }

      // Load the user
      const user = await User.find(accessToken.tokenableId)
      if (!user) {
        response.clearCookie('auth_token')
        return response.redirect('/auth/login')
      }

      // Store user in context for dashboard controller to access
      ctx.user = user

      await next()
    } catch (error) {
      response.clearCookie('auth_token')
      return response.redirect('/auth/login')
    }
  }
}
