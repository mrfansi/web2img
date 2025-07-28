/**
 * Standard API response interfaces
 */

export interface ApiSuccessResponse<T = any> {
  success: true
  data: T
  message?: string
}

export interface ApiErrorResponse {
  success?: false
  detail: {
    error: string
    message: string
    code?: string
  }
}

export type ApiResponse<T = any> = ApiSuccessResponse<T> | ApiErrorResponse

/**
 * User-related response types
 */
export interface UserData {
  id: number
  fullName: string | null
  email: string
  createdAt: string | Date
}

export interface CreateUserResponse extends ApiSuccessResponse<UserData> {}

export interface GetUsersResponse extends ApiSuccessResponse<UserData[]> {}

export interface DeleteUserResponse extends ApiSuccessResponse<null> {
  message: string
}

/**
 * Authentication response types
 */
export interface LoginSuccessResponse {
  success: true
  redirectUrl: string
}

export interface LogoutResponse {
  success: true
  redirectUrl: string
}

/**
 * Error types
 */
export enum ErrorCodes {
  USER_EXISTS = 'user_exists',
  USER_NOT_FOUND = 'user_not_found',
  USER_CREATION_FAILED = 'user_creation_failed',
  USER_DELETION_FAILED = 'user_deletion_failed',
  USERS_FETCH_FAILED = 'users_fetch_failed',
  INVALID_CREDENTIALS = 'invalid_credentials',
  VALIDATION_ERROR = 'validation_error',
  INTERNAL_ERROR = 'internal_error',
}

/**
 * Common error messages
 */
export const ErrorMessages = {
  [ErrorCodes.USER_EXISTS]: 'User with this email already exists',
  [ErrorCodes.USER_NOT_FOUND]: 'User not found',
  [ErrorCodes.USER_CREATION_FAILED]: 'Failed to create user',
  [ErrorCodes.USER_DELETION_FAILED]: 'Failed to delete user',
  [ErrorCodes.USERS_FETCH_FAILED]: 'Failed to fetch users',
  [ErrorCodes.INVALID_CREDENTIALS]: 'Invalid email or password',
  [ErrorCodes.VALIDATION_ERROR]: 'Validation failed',
  [ErrorCodes.INTERNAL_ERROR]: 'Internal server error',
} as const
