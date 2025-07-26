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
  middleware.rateLimit()
])
