import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import ApiKey from '#models/api_key'

/**
 * API Key authentication middleware
 * Validates X-API-Key header and enriches request context with API key data
 */
export default class ApiKeyAuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const { request, response } = ctx

    // Extract API key from X-API-Key header
    const apiKeyHeader = request.header('X-API-Key')

    if (!apiKeyHeader) {
      return response.status(401).json({
        detail: {
          error: 'missing_api_key',
          message: 'X-API-Key header is required',
        },
      })
    }

    // Validate API key against database
    const apiKey = await ApiKey.findByKey(apiKeyHeader)

    if (!apiKey) {
      return response.status(401).json({
        detail: {
          error: 'invalid_api_key',
          message: 'Invalid or inactive API key',
        },
      })
    }

    // Enrich request context with authenticated API key data
    ctx.apiKey = apiKey
    ctx.user = apiKey.user

    return next()
  }
}
