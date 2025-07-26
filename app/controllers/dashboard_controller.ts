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
    public async index({ response }: HttpContext) {
        const html = this.getDashboardHTML()
        response.header('Content-Type', 'text/html')
        return html
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

            const timeframe = request.input('timeframe', 'day') as 'hour' | 'day' | 'week'
            const stats = await ApiKeyUsage.getUsageStats(apiKey.id, timeframe)
            const recentUsage = await ApiKeyUsage.getRecentUsage(apiKey.id, 20)

            return {
                data: {
                    apiKey: {
                        id: apiKey.id,
                        name: apiKey.name,
                        rateLimit: apiKey.rateLimit
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

    /**
     * Generate the dashboard HTML
     */
    private getDashboardHTML(): string {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Web2Img Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        .status-healthy { @apply bg-green-100 text-green-800; }
        .status-degraded { @apply bg-yellow-100 text-yellow-800; }
        .status-unhealthy { @apply bg-red-100 text-red-800; }
        .metric-card { @apply bg-white rounded-lg shadow p-6; }
        .chart-container { @apply bg-white rounded-lg shadow p-6; }
    </style>
</head>
<body class="bg-gray-100">
    <div class="min-h-screen">
        <!-- Header -->
        <header class="bg-white shadow">
            <div class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
                <h1 class="text-3xl font-bold text-gray-900">Web2Img Dashboard</h1>
            </div>
        </header>

        <!-- Main content -->
        <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
            <!-- Loading indicator -->
            <div id="loading" class="text-center py-8">
                <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p class="mt-2 text-gray-600">Loading dashboard data...</p>
            </div>

            <!-- Dashboard content -->
            <div id="dashboard-content" class="hidden">
                <!-- System Status -->
                <div class="bg-white overflow-hidden shadow rounded-lg mb-6">
                    <div class="px-4 py-5 sm:p-6">
                        <h3 class="text-lg leading-6 font-medium text-gray-900 mb-4">System Status</h3>
                        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div class="text-center">
                                <div id="system-status" class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium">
                                    <span id="status-text">Loading...</span>
                                </div>
                                <p class="text-sm text-gray-500 mt-1">Overall Status</p>
                            </div>
                            <div class="text-center">
                                <div class="text-2xl font-bold text-gray-900" id="uptime">-</div>
                                <p class="text-sm text-gray-500">Uptime (hours)</p>
                            </div>
                            <div class="text-center">
                                <div class="text-2xl font-bold text-gray-900" id="total-api-keys">-</div>
                                <p class="text-sm text-gray-500">Total API Keys</p>
                            </div>
                            <div class="text-center">
                                <div class="text-2xl font-bold text-gray-900" id="active-api-keys">-</div>
                                <p class="text-sm text-gray-500">Active API Keys</p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Metrics Grid -->
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
                    <!-- Request Metrics -->
                    <div class="metric-card">
                        <h4 class="text-lg font-medium text-gray-900 mb-4">Request Metrics</h4>
                        <div class="space-y-3">
                            <div class="flex justify-between">
                                <span class="text-sm text-gray-600">Total Requests</span>
                                <span class="font-medium" id="total-requests">-</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-sm text-gray-600">Requests/sec</span>
                                <span class="font-medium" id="requests-per-sec">-</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-sm text-gray-600">Avg Response Time</span>
                                <span class="font-medium" id="avg-response-time">-</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-sm text-gray-600">Error Rate</span>
                                <span class="font-medium" id="error-rate">-</span>
                            </div>
                        </div>
                    </div>

                    <!-- Processing Metrics -->
                    <div class="metric-card">
                        <h4 class="text-lg font-medium text-gray-900 mb-4">Processing Metrics</h4>
                        <div class="space-y-3">
                            <div class="flex justify-between">
                                <span class="text-sm text-gray-600">Screenshots Generated</span>
                                <span class="font-medium" id="screenshots-generated">-</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-sm text-gray-600">Processing Time</span>
                                <span class="font-medium" id="avg-processing-time">-</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-sm text-gray-600">Cache Hit Rate</span>
                                <span class="font-medium" id="cache-hit-rate">-</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-sm text-gray-600">Queue Depth</span>
                                <span class="font-medium" id="queue-depth">-</span>
                            </div>
                        </div>
                    </div>

                    <!-- System Metrics -->
                    <div class="metric-card">
                        <h4 class="text-lg font-medium text-gray-900 mb-4">System Metrics</h4>
                        <div class="space-y-3">
                            <div class="flex justify-between">
                                <span class="text-sm text-gray-600">Memory Usage</span>
                                <span class="font-medium" id="memory-usage">-</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-sm text-gray-600">CPU Usage</span>
                                <span class="font-medium" id="cpu-usage">-</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-sm text-gray-600">Disk Usage</span>
                                <span class="font-medium" id="disk-usage">-</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-sm text-gray-600">Active Workers</span>
                                <span class="font-medium" id="active-workers">-</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- API Usage Overview -->
                <div class="bg-white overflow-hidden shadow rounded-lg mb-6">
                    <div class="px-4 py-5 sm:p-6">
                        <div class="flex justify-between items-center mb-4">
                            <h3 class="text-lg leading-6 font-medium text-gray-900">API Usage Overview</h3>
                            <select id="usage-timeframe" class="border border-gray-300 rounded-md px-3 py-1 text-sm">
                                <option value="hour">Last Hour</option>
                                <option value="day" selected>Last 24 Hours</option>
                                <option value="week">Last Week</option>
                            </select>
                        </div>
                        
                        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                            <div class="text-center">
                                <div class="text-2xl font-bold text-gray-900" id="usage-total-requests">-</div>
                                <p class="text-sm text-gray-500">Total Requests</p>
                            </div>
                            <div class="text-center">
                                <div class="text-2xl font-bold text-gray-900" id="usage-total-errors">-</div>
                                <p class="text-sm text-gray-500">Total Errors</p>
                            </div>
                            <div class="text-center">
                                <div class="text-2xl font-bold text-gray-900" id="usage-error-rate">-</div>
                                <p class="text-sm text-gray-500">Error Rate (%)</p>
                            </div>
                            <div class="text-center">
                                <div class="text-2xl font-bold text-gray-900" id="usage-avg-response">-</div>
                                <p class="text-sm text-gray-500">Avg Response (ms)</p>
                            </div>
                        </div>

                        <div class="overflow-x-auto">
                            <table class="min-w-full divide-y divide-gray-200">
                                <thead class="bg-gray-50">
                                    <tr>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">API Key</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Requests</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Errors</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Error Rate</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Response</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="usage-table" class="bg-white divide-y divide-gray-200">
                                    <!-- Usage data will be loaded here -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- Error Logs -->
                <div class="bg-white overflow-hidden shadow rounded-lg mb-6">
                    <div class="px-4 py-5 sm:p-6">
                        <div class="flex justify-between items-center mb-4">
                            <h3 class="text-lg leading-6 font-medium text-gray-900">Recent Error Logs</h3>
                            <div class="flex space-x-2">
                                <select id="error-level" class="border border-gray-300 rounded-md px-3 py-1 text-sm">
                                    <option value="">All Levels</option>
                                    <option value="error">Error</option>
                                    <option value="warn">Warning</option>
                                    <option value="fatal">Fatal</option>
                                </select>
                                <button onclick="testErrorLog()" class="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-md text-sm">
                                    Test Error
                                </button>
                                <button onclick="loadErrorLogs()" class="bg-gray-600 hover:bg-gray-700 text-white px-3 py-1 rounded-md text-sm">
                                    Refresh
                                </button>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <div class="text-center">
                                <div class="text-2xl font-bold text-red-600" id="error-count">-</div>
                                <p class="text-sm text-gray-500">Total Errors</p>
                            </div>
                            <div class="text-center">
                                <div class="text-2xl font-bold text-yellow-600" id="warning-count">-</div>
                                <p class="text-sm text-gray-500">Warnings</p>
                            </div>
                            <div class="text-center">
                                <div class="text-2xl font-bold text-red-800" id="fatal-count">-</div>
                                <p class="text-sm text-gray-500">Fatal Errors</p>
                            </div>
                        </div>

                        <div class="overflow-x-auto">
                            <table class="min-w-full divide-y divide-gray-200">
                                <thead class="bg-gray-50">
                                    <tr>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Level</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Message</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Endpoint</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                                    </tr>
                                </thead>
                                <tbody id="error-logs-table" class="bg-white divide-y divide-gray-200">
                                    <!-- Error logs will be loaded here -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- API Key Management -->
                <div class="bg-white overflow-hidden shadow rounded-lg">
                    <div class="px-4 py-5 sm:p-6">
                        <div class="flex justify-between items-center mb-4">
                            <h3 class="text-lg leading-6 font-medium text-gray-900">API Key Management</h3>
                            <button onclick="showCreateApiKeyModal()" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium">
                                Create New API Key
                            </button>
                        </div>
                        
                        <div class="overflow-x-auto">
                            <table class="min-w-full divide-y divide-gray-200">
                                <thead class="bg-gray-50">
                                    <tr>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Key</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rate Limit</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="api-keys-table" class="bg-white divide-y divide-gray-200">
                                    <!-- API keys will be loaded here -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Error message -->
            <div id="error-message" class="hidden bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                <span id="error-text"></span>
            </div>
        </main>
    </div>

    <!-- Create API Key Modal -->
    <div id="create-api-key-modal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full">
        <div class="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div class="mt-3">
                <h3 class="text-lg font-medium text-gray-900 mb-4">Create New API Key</h3>
                <form id="create-api-key-form">
                    <div class="mb-4">
                        <label for="api-key-name" class="block text-sm font-medium text-gray-700">Name</label>
                        <input type="text" id="api-key-name" name="name" required class="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    </div>
                    <div class="mb-4">
                        <label for="api-key-rate-limit" class="block text-sm font-medium text-gray-700">Rate Limit (requests/hour)</label>
                        <input type="number" id="api-key-rate-limit" name="rateLimit" value="1000" min="1" max="10000" class="mt-1 block w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    </div>
                    <div class="flex justify-end space-x-3">
                        <button type="button" onclick="hideCreateApiKeyModal()" class="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-md text-sm font-medium">
                            Cancel
                        </button>
                        <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium">
                            Create
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>

    <!-- New API Key Display Modal -->
    <div id="new-api-key-modal" class="hidden fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full">
        <div class="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div class="mt-3">
                <h3 class="text-lg font-medium text-gray-900 mb-4">API Key Created Successfully</h3>
                <div class="mb-4">
                    <p class="text-sm text-gray-600 mb-2">Your new API key:</p>
                    <div class="bg-gray-100 p-3 rounded border">
                        <code id="new-api-key-value" class="text-sm break-all"></code>
                    </div>
                    <p class="text-xs text-red-600 mt-2">⚠️ Save this key now - you won't be able to see it again!</p>
                </div>
                <div class="flex justify-end">
                    <button onclick="hideNewApiKeyModal()" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium">
                        Close
                    </button>
                </div>
            </div>
        </div>
    </div>

    <script>
        let dashboardData = null;
        let apiKeys = [];

        // Load dashboard data
        async function loadDashboardData() {
            try {
                const response = await fetch('/dashboard/api/data');
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.detail?.message || 'Failed to load dashboard data');
                }
                
                dashboardData = data;
                updateDashboard();
                document.getElementById('loading').classList.add('hidden');
                document.getElementById('dashboard-content').classList.remove('hidden');
            } catch (error) {
                showError('Failed to load dashboard data: ' + error.message);
                document.getElementById('loading').classList.add('hidden');
            }
        }

        // Load API keys
        async function loadApiKeys() {
            try {
                const response = await fetch('/dashboard/api/keys');
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.detail?.message || 'Failed to load API keys');
                }
                
                apiKeys = data.data;
                updateApiKeysTable();
            } catch (error) {
                showError('Failed to load API keys: ' + error.message);
            }
        }

        // Update dashboard with data
        function updateDashboard() {
            if (!dashboardData) return;

            // System status
            const statusElement = document.getElementById('system-status');
            const statusText = document.getElementById('status-text');
            statusText.textContent = dashboardData.health.status;
            statusElement.className = 'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium status-' + dashboardData.health.status;

            // Uptime
            document.getElementById('uptime').textContent = Math.round(dashboardData.health.uptime / 3600);

            // Stats
            document.getElementById('total-api-keys').textContent = dashboardData.stats.totalApiKeys;
            document.getElementById('active-api-keys').textContent = dashboardData.stats.activeApiKeys;

            // Request metrics
            const reqMetrics = dashboardData.metrics.requests;
            document.getElementById('total-requests').textContent = reqMetrics.totalRequests || '-';
            document.getElementById('requests-per-sec').textContent = (reqMetrics.requestsPerSecond || 0).toFixed(2);
            document.getElementById('avg-response-time').textContent = (reqMetrics.averageResponseTime || 0).toFixed(0) + 'ms';
            document.getElementById('error-rate').textContent = (reqMetrics.errorRate || 0).toFixed(2) + '%';

            // Processing metrics
            const procMetrics = dashboardData.metrics.processing;
            document.getElementById('screenshots-generated').textContent = procMetrics.screenshotsGenerated || '-';
            document.getElementById('avg-processing-time').textContent = (procMetrics.averageProcessingTime || 0).toFixed(0) + 'ms';
            document.getElementById('cache-hit-rate').textContent = (procMetrics.cacheHitRate || 0).toFixed(1) + '%';
            document.getElementById('queue-depth').textContent = procMetrics.queueDepth || 0;

            // System metrics
            const sysMetrics = dashboardData.metrics.system;
            document.getElementById('memory-usage').textContent = (sysMetrics.memoryUsagePercent || 0).toFixed(1) + '%';
            document.getElementById('cpu-usage').textContent = (sysMetrics.cpuUsagePercent || 0).toFixed(1) + '%';
            document.getElementById('disk-usage').textContent = (sysMetrics.diskUsagePercent || 0).toFixed(1) + '%';
            document.getElementById('active-workers').textContent = procMetrics.activeWorkers || 0;
        }

        // Update API keys table
        function updateApiKeysTable() {
            const tbody = document.getElementById('api-keys-table');
            tbody.innerHTML = '';

            apiKeys.forEach(key => {
                const row = document.createElement('tr');
                row.innerHTML = \`
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">\${key.name}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">\${key.key}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">\${key.rateLimit}</td>
                    <td class="px-6 py-4 whitespace-nowrap">
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium \${key.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                            \${key.isActive ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        \${new Date(key.createdAt).toLocaleDateString()}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button onclick="toggleApiKey(\${key.id})" class="text-indigo-600 hover:text-indigo-900 mr-3">
                            \${key.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button onclick="deleteApiKey(\${key.id})" class="text-red-600 hover:text-red-900">
                            Delete
                        </button>
                    </td>
                \`;
                tbody.appendChild(row);
            });
        }

        // Show create API key modal
        function showCreateApiKeyModal() {
            document.getElementById('create-api-key-modal').classList.remove('hidden');
        }

        // Hide create API key modal
        function hideCreateApiKeyModal() {
            document.getElementById('create-api-key-modal').classList.add('hidden');
            document.getElementById('create-api-key-form').reset();
        }

        // Show new API key modal
        function showNewApiKeyModal(apiKey) {
            document.getElementById('new-api-key-value').textContent = apiKey;
            document.getElementById('new-api-key-modal').classList.remove('hidden');
        }

        // Hide new API key modal
        function hideNewApiKeyModal() {
            document.getElementById('new-api-key-modal').classList.add('hidden');
        }

        // Create API key
        document.getElementById('create-api-key-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const data = {
                name: formData.get('name'),
                rateLimit: parseInt(formData.get('rateLimit'))
            };

            try {
                const response = await fetch('/dashboard/api/keys', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(data)
                });

                const result = await response.json();
                
                if (!response.ok) {
                    throw new Error(result.detail?.message || 'Failed to create API key');
                }

                hideCreateApiKeyModal();
                showNewApiKeyModal(result.data.key);
                await loadApiKeys(); // Reload the table
                await loadDashboardData(); // Update stats
            } catch (error) {
                showError('Failed to create API key: ' + error.message);
            }
        });

        // Toggle API key status
        async function toggleApiKey(id) {
            try {
                const response = await fetch(\`/dashboard/api/keys/\${id}/toggle\`, {
                    method: 'PATCH'
                });

                const result = await response.json();
                
                if (!response.ok) {
                    throw new Error(result.detail?.message || 'Failed to toggle API key');
                }

                await loadApiKeys(); // Reload the table
                await loadDashboardData(); // Update stats
            } catch (error) {
                showError('Failed to toggle API key: ' + error.message);
            }
        }

        // Delete API key
        async function deleteApiKey(id) {
            if (!confirm('Are you sure you want to delete this API key? This action cannot be undone.')) {
                return;
            }

            try {
                const response = await fetch(\`/dashboard/api/keys/\${id}\`, {
                    method: 'DELETE'
                });

                const result = await response.json();
                
                if (!response.ok) {
                    throw new Error(result.detail?.message || 'Failed to delete API key');
                }

                await loadApiKeys(); // Reload the table
                await loadDashboardData(); // Update stats
            } catch (error) {
                showError('Failed to delete API key: ' + error.message);
            }
        }

        // Show error message
        function showError(message) {
            document.getElementById('error-text').textContent = message;
            document.getElementById('error-message').classList.remove('hidden');
            setTimeout(() => {
                document.getElementById('error-message').classList.add('hidden');
            }, 5000);
        }

        // Initialize dashboard
        async function initDashboard() {
            await loadDashboardData();
            await loadApiKeys();
            
            // Auto-refresh every 30 seconds
            setInterval(() => {
                loadDashboardData();
            }, 30000);
        }

        // Load API usage overview
        async function loadUsageOverview() {
            try {
                const timeframe = document.getElementById('usage-timeframe').value;
                const response = await fetch(\`/dashboard/api/usage-overview?timeframe=\${timeframe}\`);
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.detail?.message || 'Failed to load usage overview');
                }
                
                updateUsageOverview(data.data);
            } catch (error) {
                showError('Failed to load usage overview: ' + error.message);
            }
        }

        // Update usage overview display
        function updateUsageOverview(data) {
            document.getElementById('usage-total-requests').textContent = data.overview.totalRequests;
            document.getElementById('usage-total-errors').textContent = data.overview.totalErrors;
            document.getElementById('usage-error-rate').textContent = data.overview.errorRate.toFixed(2);
            document.getElementById('usage-avg-response').textContent = Math.round(data.overview.avgResponseTime);

            const tbody = document.getElementById('usage-table');
            tbody.innerHTML = '';

            data.apiKeyUsage.forEach(usage => {
                const row = document.createElement('tr');
                row.innerHTML = \`
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">\${usage.apiKey.name}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">\${usage.apiKey.user}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">\${usage.totalRequests}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">\${usage.errorRequests}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">\${usage.errorRate.toFixed(2)}%</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">\${Math.round(usage.avgResponseTime)}ms</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button onclick="viewApiKeyDetails(\${usage.apiKey.id})" class="text-indigo-600 hover:text-indigo-900">
                            View Details
                        </button>
                    </td>
                \`;
                tbody.appendChild(row);
            });
        }

        // Load error logs
        async function loadErrorLogs() {
            try {
                const level = document.getElementById('error-level').value;
                const params = new URLSearchParams();
                if (level) params.append('level', level);
                
                const response = await fetch(\`/dashboard/api/errors?\${params}\`);
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.detail?.message || 'Failed to load error logs');
                }
                
                updateErrorLogs(data.data);
            } catch (error) {
                showError('Failed to load error logs: ' + error.message);
            }
        }

        // Update error logs display
        function updateErrorLogs(data) {
            document.getElementById('error-count').textContent = data.stats.errorsByLevel.error || 0;
            document.getElementById('warning-count').textContent = data.stats.errorsByLevel.warn || 0;
            document.getElementById('fatal-count').textContent = data.stats.errorsByLevel.fatal || 0;

            const tbody = document.getElementById('error-logs-table');
            tbody.innerHTML = '';

            data.errors.forEach(error => {
                const row = document.createElement('tr');
                const levelClass = error.level === 'fatal' ? 'text-red-800' : 
                                 error.level === 'error' ? 'text-red-600' : 'text-yellow-600';
                
                row.innerHTML = \`
                    <td class="px-6 py-4 whitespace-nowrap">
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium \${levelClass}">
                            \${error.level.toUpperCase()}
                        </span>
                    </td>
                    <td class="px-6 py-4 text-sm text-gray-900" style="max-width: 300px; overflow: hidden; text-overflow: ellipsis;">
                        \${error.message}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">\${error.endpoint || '-'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">\${error.ipAddress || '-'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        \${new Date(error.createdAt).toLocaleString()}
                    </td>
                \`;
                tbody.appendChild(row);
            });
        }

        // Test error logging
        async function testErrorLog() {
            try {
                const response = await fetch('/dashboard/api/errors', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        level: 'error',
                        message: 'Test error generated from dashboard',
                        context: { test: true, timestamp: new Date().toISOString() }
                    })
                });

                const result = await response.json();
                
                if (!response.ok) {
                    throw new Error(result.detail?.message || 'Failed to create test error');
                }

                await loadErrorLogs(); // Refresh the error logs
                showSuccess('Test error logged successfully');
            } catch (error) {
                showError('Failed to create test error: ' + error.message);
            }
        }

        // View API key details (placeholder for future modal)
        function viewApiKeyDetails(apiKeyId) {
            // For now, just show an alert - can be expanded to a modal later
            alert(\`API Key Details for ID: \${apiKeyId}\nThis feature will show detailed usage statistics in a future update.\`);
        }

        // Show success message
        function showSuccess(message) {
            // Create a temporary success message element
            const successDiv = document.createElement('div');
            successDiv.className = 'fixed top-4 right-4 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded z-50';
            successDiv.textContent = message;
            document.body.appendChild(successDiv);
            
            setTimeout(() => {
                document.body.removeChild(successDiv);
            }, 3000);
        }

        // Event listeners
        document.getElementById('usage-timeframe').addEventListener('change', loadUsageOverview);
        document.getElementById('error-level').addEventListener('change', loadErrorLogs);

        // Initialize dashboard
        async function initDashboard() {
            await loadDashboardData();
            await loadApiKeys();
            await loadUsageOverview();
            await loadErrorLogs();
            
            // Auto-refresh every 30 seconds
            setInterval(() => {
                loadDashboardData();
                loadUsageOverview();
                loadErrorLogs();
            }, 30000);
        }

        // Start the dashboard when page loads
        document.addEventListener('DOMContentLoaded', initDashboard);
    </script>
</body>
</html>
    `
    }

    async createTestError({ request, response }: HttpContext) {
        try {
            const { level, message, context } = request.body()

            const errorLog = await ErrorLog.create({
                level: level || 'error',
                message: message || 'Test error generated from dashboard',
                context: JSON.stringify(context || { test: true }),
                endpoint: '/dashboard/api/errors',
                ipAddress: request.ip()
            })

            return {
                success: true,
                data: {
                    id: errorLog.id,
                    message: 'Test error logged successfully'
                }
            }
        } catch (error) {
            response.status(500)
            return {
                detail: {
                    error: 'test_error_creation_failed',
                    message: 'Failed to create test error'
                }
            }
        }
    }
}
