/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import { middleware } from './kernel.js'

router.get('/', async ({ response }) => {
  return response.redirect('/auth/login')
})

/*
|--------------------------------------------------------------------------
| Authentication Routes
|--------------------------------------------------------------------------
|
| Login routes (no authentication required)
|
*/

router
  .group(() => {
    // Login page and logout
    router.get('/auth/login', '#controllers/auth_controller.showLogin')
    router.post('/auth/login', '#controllers/auth_controller.login')
    router.post('/auth/logout', '#controllers/auth_controller.logout')
  })
  .middleware([middleware.requestLogging(), middleware.metrics()])

/*
|--------------------------------------------------------------------------
| Dashboard Routes
|--------------------------------------------------------------------------
|
| Dashboard web interface and API endpoints (authentication required)
|
*/

router
  .group(() => {
    // Dashboard web interface
    router.get('/dashboard', '#controllers/dashboard_controller.index')

    // Dashboard API endpoints
    router.get('/dashboard/api/data', '#controllers/dashboard_controller.getDashboardData')
    router.get('/dashboard/api/keys', '#controllers/dashboard_controller.getApiKeys')
    router.post('/dashboard/api/keys', '#controllers/dashboard_controller.createApiKey')
    router.patch('/dashboard/api/keys/:id/toggle', '#controllers/dashboard_controller.toggleApiKey')
    router.delete('/dashboard/api/keys/:id', '#controllers/dashboard_controller.deleteApiKey')

    // API Usage tracking endpoints
    router.get(
      '/dashboard/api/usage-overview',
      '#controllers/dashboard_controller.getUsageOverview'
    )
    router.get('/dashboard/api/usage/:id', '#controllers/dashboard_controller.getApiKeyUsage')

    // Error logging endpoints
    router.get('/dashboard/api/errors', '#controllers/dashboard_controller.getErrorLogs')
    router.post('/dashboard/api/errors', '#controllers/dashboard_controller.createTestError')

    // User management endpoints
    router.get('/dashboard/api/users', '#controllers/users_controller.index')
    router.post('/dashboard/api/users', '#controllers/users_controller.store')
    router.get('/dashboard/api/users/:id', '#controllers/users_controller.show')
    router.delete('/dashboard/api/users/:id', '#controllers/users_controller.destroy')

    // Current user endpoints
    router.get('/dashboard/api/user', '#controllers/dashboard_controller.getCurrentUser')
    router.post(
      '/dashboard/api/change-password',
      '#controllers/dashboard_controller.changePassword'
    )
    router.post('/dashboard/logout', '#controllers/dashboard_controller.logout')
  })
  .middleware([middleware.dashboardAuth(), middleware.requestLogging(), middleware.metrics()]) /*
|--------------------------------------------------------------------------
| Screenshot API Routes
|--------------------------------------------------------------------------
|
| Screenshot API routes with authentication and rate limiting middleware
|
*/

/*
|--------------------------------------------------------------------------
| Health Check and Metrics Routes
|--------------------------------------------------------------------------
|
| Health check and metrics endpoints (no authentication required)
|
*/

router
  .group(() => {
    // Basic health checks
    router.get('/health', '#controllers/health_controller.health')
    router.get('/health/detailed', '#controllers/health_controller.detailedHealth')
    router.get('/health/ready', '#controllers/health_controller.ready')
    router.get('/health/live', '#controllers/health_controller.live')
    router.get('/health/:component', '#controllers/health_controller.componentHealth')

    // Metrics endpoints
    router.get('/metrics', '#controllers/health_controller.metrics')
    router.get('/metrics/requests', '#controllers/health_controller.requestMetrics')
    router.get('/metrics/processing', '#controllers/health_controller.processingMetrics')
    router.get('/metrics/system', '#controllers/health_controller.systemMetrics')

    // Debug endpoints (temporary)
    router.get('/debug/env', '#controllers/health_controller.debugEnv')
    router.get('/debug/screenshot-jobs', '#controllers/health_controller.debugScreenshotJobs')
    router.get('/debug/test-job-status/:jobId', '#controllers/health_controller.testJobStatus')
    router.get('/debug/test-wait-job/:jobId', '#controllers/health_controller.testWaitJob')
    router.post('/debug/test-batch', '#controllers/health_controller.testBatch')
  })
  .middleware([middleware.requestLogging(), middleware.metrics()])

/*
|--------------------------------------------------------------------------
| Screenshot API Routes
|--------------------------------------------------------------------------
|
| Screenshot API routes with authentication and rate limiting middleware
|
*/

router
  .group(() => {
    // Single screenshot endpoint
    router.post('/screenshot', '#controllers/screenshot_controller.single')

    // Batch screenshot endpoints
    router.post('/batch/screenshots', '#controllers/screenshot_controller.createBatch')
    router.get('/batch/screenshots/active', '#controllers/screenshot_controller.getActiveBatchJobs')
    router.post(
      '/batch/screenshots/:job_id/schedule',
      '#controllers/screenshot_controller.scheduleBatchJob'
    )
    router.post(
      '/batch/screenshots/:job_id/recurrence',
      '#controllers/screenshot_controller.setBatchJobRecurrence'
    )
    router.post(
      '/batch/screenshots/:job_id/cancel',
      '#controllers/screenshot_controller.cancelBatchJob'
    )
    router.get(
      '/batch/screenshots/:job_id/results',
      '#controllers/screenshot_controller.getBatchJobResults'
    )
    router.get('/batch/screenshots/:job_id', '#controllers/screenshot_controller.getBatchStatus')

    // Cache management endpoints
    router.get('/cache/stats', '#controllers/screenshot_controller.getCacheStats')
    router.delete('/cache', '#controllers/screenshot_controller.clearCache')
    router.delete('/cache/url', '#controllers/screenshot_controller.invalidateCacheUrl')
  })
  .middleware([
    middleware.requestLogging(),
    middleware.apiKeyAuth(),
    middleware.rateLimit(),
    middleware.metrics(),
  ])

/*
|--------------------------------------------------------------------------
| API Documentation Routes
|--------------------------------------------------------------------------
|
| OpenAPI/Swagger documentation endpoints (no authentication required)
|
*/

// Simple API docs route
router.get('/docs', '#controllers/swagger_controller.ui')

// OpenAPI JSON spec
router.get('/docs/openapi.json', '#controllers/swagger_controller.spec')
router.get('/docs/openapi', '#controllers/swagger_controller.specPretty')
