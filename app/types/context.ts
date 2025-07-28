import type ApiKey from '#models/api_key'
import type User from '#models/user'

declare module '@adonisjs/core/http' {
  interface HttpContext {
    apiKey?: ApiKey
    user?: User
    correlationId?: string
  }
}
