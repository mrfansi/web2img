import vine from '@vinejs/vine'

/**
 * Authentication validation schemas
 */

/**
 * Login validation schema
 */
export const loginValidator = vine.compile(
  vine.object({
    email: vine.string().email().normalizeEmail(),
    password: vine.string().minLength(1).maxLength(255),
  })
)

/**
 * User creation validation schema
 */
export const createUserValidator = vine.compile(
  vine.object({
    fullName: vine.string().trim().minLength(1).maxLength(100),
    email: vine.string().email().normalizeEmail().maxLength(254),
    password: vine.string().minLength(6).maxLength(100),
  })
)

/**
 * User update validation schema (for future use)
 */
export const updateUserValidator = vine.compile(
  vine.object({
    fullName: vine.string().trim().minLength(1).maxLength(100).optional(),
    email: vine.string().email().normalizeEmail().maxLength(254).optional(),
  })
)

/**
 * Password change validation schema (for future use)
 */
export const changePasswordValidator = vine.compile(
  vine.object({
    currentPassword: vine.string().minLength(1),
    newPassword: vine.string().minLength(6).maxLength(100),
    confirmPassword: vine.string().sameAs('newPassword'),
  })
)

/**
 * Type definitions for validated data
 */
export interface LoginData {
  email: string
  password: string
}

export interface CreateUserData {
  fullName: string
  email: string
  password: string
}

export interface UpdateUserData {
  fullName?: string
  email?: string
}

export interface ChangePasswordData {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}
