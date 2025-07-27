import { HttpContext } from '@adonisjs/core/http'
import { HealthCheckService } from '#services/health_check_service'
import { MetricsService } from '#services/metrics_service'
import ApiKey from '#models/api_key'
import User from '#models/user'
import ApiKeyUsage from '#models/api_key_usage'
import ErrorLog, { ErrorLevel } from '#models/error_log'
import vine from '@vinejs/vine'

/**
 * Dashboard controller for web interface and API key management
 */
export default class DashboardController {
    private healthCheckService = new HealthCheckService()
    private metricsService = new MetricsService()

    /**
     * Create API key validator
     */
    private createApiKeyValidator = vine.compile(
        vine.object({
            name: vine.string().minLength(1).maxLength(100),
            rateLimit: vine.number().min(1).max(10000).optional()
        })
    )

    /**
     * @swagger
     * /dashboard:
     *   get:
     *     summary: Dashboard web interface
     *     description: Returns the main dashboard HTML interface for system monitoring and API key management
     *     tags:
     *       - Dashboard
     *     responses:
     *       200:
     *         description: Dashboard HTML interface
     *         content:
     *           text/html:
     *             schema:
     *               type: string
     */
    /**
     * Dashboard home page
     * GET /dashboard
     */
    public async index({ view }: HttpContext) {
        return view.render('dashboard/index')
    }

    /**
     * @swagger
     * /dashboard/api/data:
     *   get:
     *     summary: Get dashboard data
     *     description: Returns complete dashboard data including system health, metrics, and statistics
     *     tags:
     *       - Dashboard
     *     responses:
     *       200:
     *         description: Dashboard data
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 health:
     *                   type: object
     *                   properties:
     *                     status:
     *                       type: string
     *                       enum: [healthy, unhealthy, degraded]
     *                     uptime:
     *                       type: number
     *                     components:
     *                       type: object
     *                 metrics:
     *                   type: object
     *                   properties:
     *                     requests:
     *                       $ref: '#/components/schemas/RequestMetrics'
     *                     processing:
     *                       $ref: '#/components/schemas/ProcessingMetrics'
     *                     system:
     *                       $ref: '#/components/schemas/SystemMetrics'
     *                 stats:
     *                   type: object
     *                   properties:
     *                     totalApiKeys:
     *                       type: integer
     *                     activeApiKeys:
     *                       type: integer
     *                     totalUsers:
     *                       type: integer
     *       500:
     *         description: Failed to fetch dashboard data
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
    /**
     * API endpoint to get dashboard data
     * GET /dashboard/api/data
     */
    public async getDashboardData({ response }: HttpContext) {
        try {
            // Get system health
            const health = await this.healthCheckService.checkSystemHealth()

            // Get metrics
            const requestMetrics = await this.metricsService.getRequestMetrics()
            const processingMetrics = await this.metricsService.getProcessingMetrics()
            const systemMetrics = await this.metricsService.getSystemMetrics()

            // Get API key stats
            const totalApiKeys = await ApiKey.query().count('* as total').first()
            const activeApiKeys = await ApiKey.query().where('is_active', true).count('* as total').first()
            const totalUsers = await User.query().count('* as total').first()

            return {
                health: {
                    status: health.status,
                    uptime: health.uptime,
                    components: health.components
                },
                metrics: {
                    requests: requestMetrics,
                    processing: processingMetrics,
                    system: systemMetrics
                },
                stats: {
                    totalApiKeys: totalApiKeys?.$extras.total || 0,
                    activeApiKeys: activeApiKeys?.$extras.total || 0,
                    totalUsers: totalUsers?.$extras.total || 0
                }
            }
        } catch (error) {
            response.status(500)
            return {
                detail: {
                    error: 'dashboard_data_fetch_failed',
                    message: 'Failed to fetch dashboard data'
                }
            }
        }
    }

    /**
     * @swagger
     * /dashboard/api/keys:
     *   get:
     *     summary: Get all API keys
     *     description: Returns a list of all API keys with masked key values for security
     *     tags:
     *       - Dashboard
     *       - API Keys
     *     responses:
     *       200:
     *         description: List of API keys
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 data:
     *                   type: array
     *                   items:
     *                     $ref: '#/components/schemas/ApiKeyResponse'
     *       500:
     *         description: Failed to fetch API keys
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *   post:
     *     summary: Create a new API key
     *     description: Creates a new API key with specified name and rate limit
     *     tags:
     *       - Dashboard
     *       - API Keys
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - name
     *             properties:
     *               name:
     *                 type: string
     *                 minLength: 1
     *                 maxLength: 100
     *                 description: Name for the API key
     *               rateLimit:
     *                 type: integer
     *                 minimum: 1
     *                 maximum: 10000
     *                 default: 1000
     *                 description: Rate limit in requests per hour
     *           examples:
     *             basic:
     *               summary: Basic API key
     *               value:
     *                 name: "Production API Key"
     *             withRateLimit:
     *               summary: API key with custom rate limit
     *               value:
     *                 name: "High Volume API Key"
     *                 rateLimit: 5000
     *     responses:
     *       200:
     *         description: API key created successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 data:
     *                   allOf:
     *                     - $ref: '#/components/schemas/ApiKeyResponse'
     *                     - type: object
     *                       properties:
     *                         key:
     *                           type: string
     *                           description: Full API key (only shown on creation)
     *       422:
     *         description: Validation failed
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ValidationErrorResponse'
     *       500:
     *         description: Failed to create API key
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
    /**
     * Get all API keys for dashboard
     * GET /dashboard/api/keys
     */
    public async getApiKeys({ response }: HttpContext) {
        try {
            const apiKeys = await ApiKey.query()
                .preload('user')
                .orderBy('created_at', 'desc')
                .limit(50) // Limit to last 50 keys

            return {
                data: apiKeys.map(key => ({
                    id: key.id,
                    name: key.name,
                    key: `${key.key.substring(0, 8)}...${key.key.substring(key.key.length - 8)}`, // Masked key
                    rateLimit: key.rateLimit,
                    isActive: key.isActive,
                    createdAt: key.createdAt,
                    user: {
                        id: key.user.id,
                        fullName: key.user.fullName,
                        email: key.user.email
                    }
                }))
            }
        } catch (error) {
            response.status(500)
            return {
                detail: {
                    error: 'api_keys_fetch_failed',
                    message: 'Failed to fetch API keys'
                }
            }
        }
    }

    /**
     * Create a new API key
     * POST /dashboard/api/keys
     */
    public async createApiKey({ request, response }: HttpContext) {
        try {
            const data = await request.validateUsing(this.createApiKeyValidator)

            // For demo purposes, create a default user if none exists
            let user = await User.first()
            if (!user) {
                user = await User.create({
                    fullName: 'Dashboard User',
                    email: 'dashboard@web2img.local',
                    password: 'dashboard-password' // This will be hashed automatically
                })
            }

            const apiKey = await ApiKey.createForUser(
                user.id,
                data.name,
                data.rateLimit || 1000
            )

            await apiKey.load('user')

            return {
                data: {
                    id: apiKey.id,
                    name: apiKey.name,
                    key: apiKey.key, // Show full key only on creation
                    rateLimit: apiKey.rateLimit,
                    isActive: apiKey.isActive,
                    createdAt: apiKey.createdAt,
                    user: {
                        id: apiKey.user.id,
                        fullName: apiKey.user.fullName,
                        email: apiKey.user.email
                    }
                }
            }
        } catch (error) {
            if (error.messages) {
                response.status(422)
                return {
                    detail: {
                        error: 'validation_failed',
                        message: 'Validation failed',
                        errors: error.messages
                    }
                }
            }

            response.status(500)
            return {
                detail: {
                    error: 'api_key_creation_failed',
                    message: 'Failed to create API key'
                }
            }
        }
    }

    /**
     * Toggle API key active status
     * PATCH /dashboard/api/keys/:id/toggle
     */
    public async toggleApiKey({ params, response }: HttpContext) {
        try {
            const apiKey = await ApiKey.find(params.id)

            if (!apiKey) {
                response.status(404)
                return {
                    detail: {
                        error: 'api_key_not_found',
                        message: 'API key not found'
                    }
                }
            }

            if (apiKey.isActive) {
                await apiKey.deactivate()
            } else {
                await apiKey.activate()
            }

            await apiKey.load('user')

            return {
                data: {
                    id: apiKey.id,
                    name: apiKey.name,
                    key: `${apiKey.key.substring(0, 8)}...${apiKey.key.substring(apiKey.key.length - 8)}`,
                    rateLimit: apiKey.rateLimit,
                    isActive: apiKey.isActive,
                    createdAt: apiKey.createdAt,
                    user: {
                        id: apiKey.user.id,
                        fullName: apiKey.user.fullName,
                        email: apiKey.user.email
                    }
                }
            }
        } catch (error) {
            response.status(500)
            return {
                detail: {
                    error: 'api_key_toggle_failed',
                    message: 'Failed to toggle API key status'
                }
            }
        }
    }

    /**
     * Delete an API key
     * DELETE /dashboard/api/keys/:id
     */
    public async deleteApiKey({ params, response }: HttpContext) {
        try {
            const apiKey = await ApiKey.find(params.id)

            if (!apiKey) {
                response.status(404)
                return {
                    detail: {
                        error: 'api_key_not_found',
                        message: 'API key not found'
                    }
                }
            }

            await apiKey.delete()

            return {
                data: {
                    id: apiKey.id,
                    deleted: true
                }
            }
        } catch (error) {
            response.status(500)
            return {
                detail: {
                    error: 'api_key_deletion_failed',
                    message: 'Failed to delete API key'
                }
            }
        }
    }

    /**
     * Get API key usage statistics
     * GET /dashboard/api/keys/:id/usage
     */
    public async getApiKeyUsage({ params, request, response }: HttpContext) {
        try {
            const apiKey = await ApiKey.query()
                .where('id', params.id)
                .preload('user')
                .first()

            if (!apiKey) {
                response.status(404)
                return {
                    detail: {
                        error: 'api_key_not_found',
                        message: 'API key not found'
                    }
                }
            }

            const timeframe = request.input('timeframe', 'day') as 'hour' | 'day' | 'week'
            const stats = await ApiKeyUsage.getUsageStats(apiKey.id, timeframe)
            const recentUsage = await ApiKeyUsage.getRecentUsage(apiKey.id, 20)

            return {
                data: {
                    apiKey: {
                        id: apiKey.id,
                        name: apiKey.name,
                        rateLimit: apiKey.rateLimit,
                        user: apiKey.user.fullName || apiKey.user.email
                    },
                    stats,
                    recentUsage: recentUsage.map(usage => ({
                        id: usage.id,
                        endpoint: usage.endpoint,
                        method: usage.method,
                        statusCode: usage.statusCode,
                        responseTime: usage.responseTime,
                        ipAddress: usage.ipAddress,
                        userAgent: usage.userAgent,
                        createdAt: usage.createdAt
                    }))
                }
            }
        } catch (error) {
            response.status(500)
            return {
                detail: {
                    error: 'usage_stats_fetch_failed',
                    message: 'Failed to fetch usage statistics'
                }
            }
        }
    }

    /**
     * Get error logs
     * GET /dashboard/api/errors
     */
    public async getErrorLogs({ request, response }: HttpContext) {
        try {
            const level = request.input('level') as ErrorLevel | undefined
            const limit = request.input('limit', 100)
            const timeframe = request.input('timeframe', 'day') as 'hour' | 'day' | 'week'

            const errors = await ErrorLog.getRecentErrors(limit, level)
            const stats = await ErrorLog.getErrorStats(timeframe)

            return {
                data: {
                    errors: errors.map(error => ({
                        id: error.id,
                        level: error.level,
                        message: error.message,
                        endpoint: error.endpoint,
                        method: error.method,
                        ipAddress: error.ipAddress,
                        correlationId: error.correlationId,
                        apiKeyId: error.apiKeyId,
                        createdAt: error.createdAt,
                        context: error.parsedContext
                    })),
                    stats
                }
            }
        } catch (error) {
            response.status(500)
            return {
                detail: {
                    error: 'error_logs_fetch_failed',
                    message: 'Failed to fetch error logs'
                }
            }
        }
    }

    /**
     * Log a new error (for testing purposes)
     * POST /dashboard/api/errors
     */
    public async logError({ request, response }: HttpContext) {
        try {
            const { level, message, context } = request.only(['level', 'message', 'context'])

            const errorLog = await ErrorLog.logError({
                level: level || ErrorLevel.ERROR,
                message: message || 'Test error from dashboard',
                context: context || { source: 'dashboard', test: true },
                endpoint: '/dashboard/api/errors',
                method: 'POST',
                ipAddress: request.ip(),
                userAgent: request.header('user-agent')
            })

            return {
                data: {
                    id: errorLog.id,
                    level: errorLog.level,
                    message: errorLog.message,
                    createdAt: errorLog.createdAt
                }
            }
        } catch (error) {
            response.status(500)
            return {
                detail: {
                    error: 'error_log_creation_failed',
                    message: 'Failed to create error log'
                }
            }
        }
    }

    /**
     * Get overall API usage statistics
     * GET /dashboard/api/usage-overview
     */
    public async getUsageOverview({ request, response }: HttpContext) {
        try {
            const timeframe = request.input('timeframe', 'day') as 'hour' | 'day' | 'week'

            // Get all API keys and their usage stats
            const apiKeys = await ApiKey.query().preload('user')
            const usageData = await Promise.all(
                apiKeys.map(async (key) => {
                    const stats = await ApiKeyUsage.getUsageStats(key.id, timeframe)
                    return {
                        apiKey: {
                            id: key.id,
                            name: key.name,
                            user: key.user.fullName || key.user.email
                        },
                        ...stats
                    }
                })
            )

            // Calculate totals
            const totalRequests = usageData.reduce((sum, data) => sum + data.totalRequests, 0)
            const totalErrors = usageData.reduce((sum, data) => sum + data.errorRequests, 0)
            const avgResponseTime = totalRequests > 0
                ? usageData.reduce((sum, data) => sum + (data.avgResponseTime * data.totalRequests), 0) / totalRequests
                : 0

            return {
                data: {
                    overview: {
                        totalRequests,
                        totalErrors,
                        errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
                        avgResponseTime,
                        timeframe
                    },
                    apiKeyUsage: usageData.filter(data => data.totalRequests > 0)
                }
            }
        } catch (error) {
            response.status(500)
            return {
                detail: {
                    error: 'usage_overview_fetch_failed',
                    message: 'Failed to fetch usage overview'
                }
            }
        }
    }
}
