import { HttpContext } from '@adonisjs/core/http'
import BaseController from '#controllers/base_controller'
import { AuthService } from '#services/auth_service'
import { loginValidator, LoginData } from '#validators/auth_validators'
import { ErrorCodes } from '#types/api_responses'

/**
 * Authentication controller for login/logout operations
 */
export default class AuthController extends BaseController {
  private authService = new AuthService()

  /**
   * @swagger
   * /auth/login:
   *   get:
   *     summary: Show login page
   *     description: Display the login form for dashboard access
   *     tags:
   *       - Authentication
   *     responses:
   *       200:
   *         description: Login page HTML
   *         content:
   *           text/html:
   *             schema:
   *               type: string
   */
  /**
   * Show login page
   * GET /auth/login
   */
  public async showLogin({ view }: HttpContext) {
    return view.render('auth/login')
  }

  /**
   * @swagger
   * /auth/login:
   *   post:
   *     summary: Authenticate user
   *     description: Process login credentials and create session
   *     tags:
   *       - Authentication
   *     requestBody:
   *       required: true
   *       content:
   *         application/x-www-form-urlencoded:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *               - password
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 description: User email address
   *               password:
   *                 type: string
   *                 description: User password
   *     responses:
   *       302:
   *         description: Redirect to dashboard on success or login page on failure
   *       422:
   *         description: Validation error
   */
  /**
   * Handle login
   * POST /auth/login
   */
  public async login({ request, response }: HttpContext) {
    // Validate request data
    const { data: credentials, error } = await this.validateRequest<LoginData>(
      request,
      loginValidator,
      response
    )

    if (error) {
      return response.redirect(
        this.authService.getLoginErrorUrl('Please check your email and password')
      )
    }

    try {
      // Authenticate user
      const { user, token } = await this.authService.authenticateUser(credentials!)

      // Set authentication cookie
      response.cookie(
        'auth_token',
        token.value!.release(),
        this.authService.createCookieConfig()
      )

      // Redirect to dashboard
      return response.redirect(this.authService.getDashboardUrl())
    } catch (error) {
      // Handle authentication failure
      return response.redirect(
        this.authService.getLoginErrorUrl('Invalid email or password')
      )
    }
  }

  /**
   * @swagger
   * /auth/logout:
   *   post:
   *     summary: Logout user
   *     description: Clear authentication session and redirect to login
   *     tags:
   *       - Authentication
   *     responses:
   *       302:
   *         description: Redirect to login page
   */
  /**
   * Handle logout
   * POST /auth/logout
   */
  public async logout({ response }: HttpContext) {
    // Clear authentication cookie
    response.clearCookie('auth_token')
    
    // Redirect to login page with success message
    return response.redirect(
      this.authService.getLoginSuccessUrl('You have been logged out successfully')
    )
  }
}
