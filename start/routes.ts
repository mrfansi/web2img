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

router.get('/', async () => {
  return {
    hello: 'world',
  }
})

/*
|--------------------------------------------------------------------------
| Dashboard Routes
|--------------------------------------------------------------------------
|
| Dashboard web interface and API endpoints (no authentication for demo)
|
*/

router.group(() => {
  // Dashboard web interface
  router.get('/dashboard', '#controllers/dashboard_controller.index')

  // Dashboard API endpoints
  router.get('/dashboard/api/data', '#controllers/dashboard_controller.getDashboardData')
  router.get('/dashboard/api/keys', '#controllers/dashboard_controller.getApiKeys')
  router.post('/dashboard/api/keys', '#controllers/dashboard_controller.createApiKey')
  router.patch('/dashboard/api/keys/:id/toggle', '#controllers/dashboard_controller.toggleApiKey')
  router.delete('/dashboard/api/keys/:id', '#controllers/dashboard_controller.deleteApiKey')

  // API Usage tracking endpoints
  router.get('/dashboard/api/usage-overview', '#controllers/dashboard_controller.getUsageOverview')
  router.get('/dashboard/api/usage/:apiKeyId', '#controllers/dashboard_controller.getApiKeyUsage')

  // Error logging endpoints
  router.get('/dashboard/api/errors', '#controllers/dashboard_controller.getErrorLogs')
  router.post('/dashboard/api/errors', '#controllers/dashboard_controller.createTestError')
}).middleware([
  middleware.requestLogging(),
  middleware.metrics()
])

/*
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

router.group(() => {
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
}).middleware([
  middleware.requestLogging(),
  middleware.metrics()
])

/*
|--------------------------------------------------------------------------
| Screenshot API Routes
|--------------------------------------------------------------------------
|
| Screenshot API routes with authentication and rate limiting middleware
|
*/

router.group(() => {
  // Single screenshot endpoint
  router.post('/screenshot', '#controllers/screenshot_controller.single')

  // Batch screenshot endpoints
  router.post('/batch/screenshots', '#controllers/screenshot_controller.createBatch')
  router.get('/batch/screenshots/:job_id', '#controllers/screenshot_controller.getBatchStatus')

}).middleware([
  middleware.requestLogging(),
  middleware.apiKeyAuth(),
  middleware.rateLimit(),
  middleware.metrics()
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
