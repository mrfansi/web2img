import { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import vine from '@vinejs/vine'

/**
 * Authentication controller for dashboard login/registration
 */
export default class AuthController {
    /**
     * Login validator
     */
    private loginValidator = vine.compile(
        vine.object({
            email: vine.string().email(),
            password: vine.string().minLength(1)
        })
    )

    /**
     * User creation validator (for dashboard)
     */
    private createUserValidator = vine.compile(
        vine.object({
            fullName: vine.string().minLength(1).maxLength(100),
            email: vine.string().email(),
            password: vine.string().minLength(6).maxLength(100)
        })
    )

    /**
     * Show login page
     * GET /auth/login
     */
    public async showLogin({ response }: HttpContext) {
        const html = this.getLoginHTML()
        response.header('Content-Type', 'text/html')
        return html
    }

    /**
     * Handle login
     * POST /auth/login
     */
    public async login({ request, response }: HttpContext) {
        try {
            const { email, password } = await request.validateUsing(this.loginValidator)

            const user = await User.verifyCredentials(email, password)
            const token = await User.accessTokens.create(user)

            // Set session cookie
            response.cookie('auth_token', token.value!.release(), {
                httpOnly: true,
                secure: false, // Set to true in production with HTTPS
                sameSite: 'lax',
                maxAge: 24 * 60 * 60 * 1000 // 24 hours
            })

            return response.redirect('/dashboard')
        } catch (error) {
            return response.redirect('/auth/login?error=Invalid email or password')
        }
    }

    /**
     * Handle logout
     * POST /auth/logout
     */
    public async logout({ response }: HttpContext) {
        // Simply clear the cookie - the token will expire naturally
        response.clearCookie('auth_token')
        return response.redirect('/auth/login')
    }

    /**
     * Create user from dashboard
     * POST /dashboard/api/users
     */
    public async createUser({ request, response }: HttpContext) {
        try {
            const { fullName, email, password } = await request.validateUsing(this.createUserValidator)

            // Check if user already exists
            const existingUser = await User.findBy('email', email)
            if (existingUser) {
                response.status(400)
                return {
                    detail: {
                        error: 'user_exists',
                        message: 'User with this email already exists'
                    }
                }
            }

            const user = await User.create({
                fullName,
                email,
                password
            })

            return {
                success: true,
                data: {
                    id: user.id,
                    fullName: user.fullName,
                    email: user.email,
                    createdAt: user.createdAt
                }
            }
        } catch (error) {
            console.error('User creation error:', error)
            response.status(500)
            return {
                detail: {
                    error: 'user_creation_failed',
                    message: 'Failed to create user'
                }
            }
        }
    }

    /**
     * Get all users
     * GET /dashboard/api/users
     */
    public async getUsers({ response }: HttpContext) {
        try {
            const users = await User.query()
                .select('id', 'fullName', 'email', 'createdAt')
                .orderBy('createdAt', 'desc')

            return {
                success: true,
                data: users.map(user => ({
                    id: user.id,
                    fullName: user.fullName,
                    email: user.email,
                    createdAt: user.createdAt
                }))
            }
        } catch (error) {
            console.error('Failed to fetch users:', error)
            response.status(500)
            return {
                detail: {
                    error: 'users_fetch_failed',
                    message: 'Failed to fetch users'
                }
            }
        }
    }

    /**
     * Login page HTML template
     */
    private getLoginHTML() {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - Web2Img Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 min-h-screen">
    <div class="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div class="max-w-md w-full space-y-8">
            <div>
                <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
                    Web2Img Dashboard
                </h2>
                <p class="mt-2 text-center text-sm text-gray-600">
                    Sign in to your account
                </p>
                <p class="mt-1 text-center text-xs text-gray-500">
                    Need an account? Contact your administrator
                </p>
            </div>

            <!-- Login Form -->
            <div class="bg-white rounded-lg shadow-md p-6" id="login-form">
                <h3 class="text-lg font-medium text-gray-900 mb-4">Sign In</h3>
                <form action="/auth/login" method="POST" class="space-y-4">
                    <div>
                        <label for="login-email" class="block text-sm font-medium text-gray-700">Email</label>
                        <input type="email" id="login-email" name="email" required
                               class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
                    </div>
                    <div>
                        <label for="login-password" class="block text-sm font-medium text-gray-700">Password</label>
                        <input type="password" id="login-password" name="password" required
                               class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
                    </div>
                    <button type="submit"
                            class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                        Sign In
                    </button>
                </form>
            </div>
                </div>
            </div>

            <!-- Error/Success Messages -->
            <div id="message-container" class="hidden">
                <div class="rounded-md p-4" id="message">
                    <div class="text-sm" id="message-text"></div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const urlParams = new URLSearchParams(window.location.search);
        const error = urlParams.get('error');
        const success = urlParams.get('success');
        
        if (error || success) {
            const messageContainer = document.getElementById('message-container');
            const message = document.getElementById('message');
            const messageText = document.getElementById('message-text');
            
            messageContainer.classList.remove('hidden');
            
            if (error) {
                message.className = 'rounded-md p-4 bg-red-50 border border-red-200';
                messageText.className = 'text-sm text-red-800';
                messageText.textContent = error;
            } else if (success) {
                message.className = 'rounded-md p-4 bg-green-50 border border-green-200';
                messageText.className = 'text-sm text-green-800';
                messageText.textContent = success;
            }
        }
    </script>
</body>
</html>
        `
    }
}
