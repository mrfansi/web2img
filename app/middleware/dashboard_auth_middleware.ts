import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import User from '#models/user'

/**
 * Dashboard authentication middleware
 * Checks for auth_token cookie and validates it
 */
export default class DashboardAuthMiddleware {
    async handle(ctx: HttpContext, next: NextFn) {
        const { request, response } = ctx

        // Get token from cookie
        const token = request.cookie('auth_token')

        if (!token) {
            return response.redirect('/auth/login')
        }

        try {
            // Verify the token
            const accessToken = await User.accessTokens.verify(token)

            if (!accessToken) {
                response.clearCookie('auth_token')
                return response.redirect('/auth/login')
            }

            // Token is valid, continue
            await next()
        } catch (error) {
            // Token is invalid, clear it and redirect
            response.clearCookie('auth_token')
            return response.redirect('/auth/login')
        }
    }
}
