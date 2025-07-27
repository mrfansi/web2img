import { HttpContext } from '@adonisjs/core/http'
import BaseController from '#controllers/base_controller'
import { UserService } from '#services/user_service'
import { createUserValidator, CreateUserData } from '#validators/auth_validators'
import {
  GetUsersResponse,
  CreateUserResponse,
  DeleteUserResponse,
  ErrorCodes
} from '#types/api_responses'

/**
 * Users controller for user management operations
 */
export default class UsersController extends BaseController {
  private userService = new UserService()

  /**
   * @swagger
   * /dashboard/api/users:
   *   get:
   *     summary: Get all users
   *     description: Retrieve a list of all users with pagination support
   *     tags:
   *       - Users
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           minimum: 1
   *         description: Page number for pagination
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *         description: Number of users per page
   *     responses:
   *       200:
   *         description: List of users
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/GetUsersResponse'
   *       500:
   *         description: Internal server error
   */
  /**
   * Get all users
   * GET /dashboard/api/users
   */
  public async index(ctx: HttpContext): Promise<GetUsersResponse> {
    console.log('UsersController.index called')
    const page = ctx.request.input('page', 1)
    const limit = Math.min(ctx.request.input('limit', 50), 100) // Cap at 100

    console.log('UsersController.index - page:', page, 'limit:', limit)

    return this.handleAsync(
      () => this.userService.getAllUsers({ page, limit }),
      'Get users',
      ctx
    ) as Promise<GetUsersResponse>
  }

  /**
   * @swagger
   * /dashboard/api/users:
   *   post:
   *     summary: Create a new user
   *     description: Create a new user account
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - fullName
   *               - email
   *               - password
   *             properties:
   *               fullName:
   *                 type: string
   *                 minLength: 1
   *                 maxLength: 100
   *                 description: User's full name
   *               email:
   *                 type: string
   *                 format: email
   *                 maxLength: 254
   *                 description: User's email address
   *               password:
   *                 type: string
   *                 minLength: 6
   *                 maxLength: 100
   *                 description: User's password
   *     responses:
   *       201:
   *         description: User created successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/CreateUserResponse'
   *       400:
   *         description: User already exists
   *       422:
   *         description: Validation error
   *       500:
   *         description: Internal server error
   */
  /**
   * Create a new user
   * POST /dashboard/api/users
   */
  public async store(ctx: HttpContext): Promise<CreateUserResponse> {
    // Validate request data
    const { data: userData, error } = await this.validateRequest<CreateUserData>(
      ctx.request,
      createUserValidator,
      ctx.response
    )

    if (error) {
      return error as any
    }

    const result = await this.handleAsync(
      async () => {
        const user = await this.userService.createUser(userData!)
        ctx.response.status(201)
        return user
      },
      'Create user',
      ctx
    )

    return result as CreateUserResponse
  }

  /**
   * @swagger
   * /dashboard/api/users/{id}:
   *   get:
   *     summary: Get user by ID
   *     description: Retrieve a specific user by their ID
   *     tags:
   *       - Users
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: User ID
   *     responses:
   *       200:
   *         description: User details
   *       404:
   *         description: User not found
   *       500:
   *         description: Internal server error
   */
  /**
   * Get user by ID
   * GET /dashboard/api/users/:id
   */
  public async show(ctx: HttpContext) {
    return this.handleAsync(
      async () => {
        const user = await this.userService.getUserById(ctx.params.id)
        if (!user) {
          const { response: errorResponse, statusCode } = this.error(
            ErrorCodes.USER_NOT_FOUND,
            undefined,
            404
          )
          ctx.response.status(statusCode)
          return errorResponse
        }
        return user
      },
      'Get user',
      ctx
    )
  }

  /**
   * @swagger
   * /dashboard/api/users/{id}:
   *   delete:
   *     summary: Delete user
   *     description: Delete a user account
   *     tags:
   *       - Users
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *         description: User ID
   *     responses:
   *       200:
   *         description: User deleted successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/DeleteUserResponse'
   *       404:
   *         description: User not found
   *       500:
   *         description: Internal server error
   */
  /**
   * Delete user
   * DELETE /dashboard/api/users/:id
   */
  public async destroy(ctx: HttpContext): Promise<DeleteUserResponse> {
    const result = await this.handleAsync(
      async () => {
        await this.userService.deleteUser(ctx.params.id)
        return null
      },
      'Delete user',
      ctx
    )

    if ('success' in result) {
      return {
        success: true,
        data: null,
        message: 'User deleted successfully'
      }
    }

    return result as any
  }
}
