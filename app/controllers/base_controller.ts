import { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { 
  ApiResponse, 
  ApiSuccessResponse, 
  ApiErrorResponse, 
  ErrorCodes, 
  ErrorMessages 
} from '#types/api_responses'

/**
 * Base controller with common patterns and error handling
 */
export default abstract class BaseController {
  /**
   * Create a success response
   */
  protected success<T>(data: T, message?: string): ApiSuccessResponse<T> {
    return {
      success: true,
      data,
      ...(message && { message })
    }
  }

  /**
   * Create an error response
   */
  protected error(
    errorCode: ErrorCodes,
    customMessage?: string,
    statusCode: number = 400
  ): { response: ApiErrorResponse; statusCode: number } {
    return {
      response: {
        detail: {
          error: errorCode,
          message: customMessage || ErrorMessages[errorCode],
          code: errorCode
        }
      },
      statusCode
    }
  }

  /**
   * Handle async operations with consistent error handling
   */
  protected async handleAsync<T>(
    operation: () => Promise<T>,
    context: string,
    { response }: HttpContext
  ): Promise<ApiResponse<T>> {
    try {
      const result = await operation()
      return this.success(result)
    } catch (error) {
      logger.error(`${context} failed:`, error)
      
      // Handle specific error types
      if (error.code === 'E_ROW_NOT_FOUND') {
        const { response: errorResponse, statusCode } = this.error(
          ErrorCodes.USER_NOT_FOUND,
          undefined,
          404
        )
        response.status(statusCode)
        return errorResponse
      }

      if (error.code === 'ER_DUP_ENTRY' || error.constraint === 'users_email_unique') {
        const { response: errorResponse, statusCode } = this.error(
          ErrorCodes.USER_EXISTS,
          undefined,
          409
        )
        response.status(statusCode)
        return errorResponse
      }

      // Default internal server error
      const { response: errorResponse, statusCode } = this.error(
        ErrorCodes.INTERNAL_ERROR,
        undefined,
        500
      )
      response.status(statusCode)
      return errorResponse
    }
  }

  /**
   * Validate request data and handle validation errors
   */
  protected async validateRequest<T>(
    request: HttpContext['request'],
    validator: any,
    response: HttpContext['response']
  ): Promise<{ data: T | null; error: ApiErrorResponse | null }> {
    try {
      const data = await request.validateUsing(validator)
      return { data: data as T, error: null }
    } catch (error) {
      logger.warn('Validation failed:', error.messages || error.message)
      
      const { response: errorResponse, statusCode } = this.error(
        ErrorCodes.VALIDATION_ERROR,
        error.messages ? Object.values(error.messages).flat().join(', ') : error.message,
        422
      )
      
      response.status(statusCode)
      return { data: null, error: errorResponse }
    }
  }

  /**
   * Log and return internal server error
   */
  protected internalError(
    context: string,
    error: any,
    response: HttpContext['response']
  ): ApiErrorResponse {
    logger.error(`${context}:`, error)
    
    const { response: errorResponse, statusCode } = this.error(
      ErrorCodes.INTERNAL_ERROR,
      undefined,
      500
    )
    
    response.status(statusCode)
    return errorResponse
  }
}
