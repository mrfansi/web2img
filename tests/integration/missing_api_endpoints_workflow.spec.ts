import { test } from '@japa/runner'
import { ApiClient } from '@japa/api-client'
import ApiKey from '#models/api_key'
import User from '#models/user'
import BatchJob from '#models/batch_job'
import { cleanupRedisConnections } from '#tests/utils/redis_test_utils'
import { DateTime } from 'luxon'

test.group('Missing API Endpoints - Integration Tests', (group) => {
  let apiClient: ApiClient
  let testUser: User
  let testApiKey: ApiKey

  group.setup(async () => {
    apiClient = new ApiClient()

    // Create test user
    testUser = await User.create({
      email: 'integration-test@example.com',
      password: 'password123',
    })

    // Create test API key
    testApiKey = await ApiKey.create({
      key: 'test-api-key-missing-endpoints-123',
      name: 'Missing Endpoints Integration Test Key',
      userId: testUser.id,
      rateLimit: 1000,
      isActive: true,
    })
  })

  group.teardown(async () => {
    // Clean up test data
    if (testApiKey) {
      await testApiKey.delete()
    }
    if (testUser) {
      await testUser.delete()
    }

    // Clean up Redis connections
    await cleanupRedisConnections()
  })

  test('complete batch job lifecycle workflow', async ({ assert }) => {
    // Step 1: Create a batch job
    const createResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [
          { id: 'item1', url: 'https://example.com' },
          { id: 'item2', url: 'https://httpbin.org/html' },
        ],
        config: {
          parallel: 2,
          timeout: 30000,
          cache: true,
        },
      })

    assert.equal(createResponse.status(), 202)
    const createBody = createResponse.body()
    assert.isString(createBody.job_id)
    assert.equal(createBody.status, 'pending')
    assert.equal(createBody.total, 2)

    const jobId = createBody.job_id

    // Step 2: Get batch job status
    const statusResponse = await apiClient
      .get(`/batch/screenshots/${jobId}`)
      .header('X-API-Key', testApiKey.key)

    assert.equal(statusResponse.status(), 200)
    const statusBody = statusResponse.body()
    assert.equal(statusBody.job_id, jobId)
    assert.include(['pending', 'processing', 'completed'], statusBody.status)
    assert.equal(statusBody.total, 2)
    assert.isArray(statusBody.results)
    assert.isArray(statusBody.successful_results)
    assert.isArray(statusBody.failed_results)

    // Step 3: Get detailed results
    const resultsResponse = await apiClient
      .get(`/batch/screenshots/${jobId}/results`)
      .header('X-API-Key', testApiKey.key)

    assert.equal(resultsResponse.status(), 200)
    const resultsBody = resultsResponse.body()
    assert.equal(resultsBody.job_id, jobId)
    assert.equal(resultsBody.total, 2)
    assert.isNumber(resultsBody.succeeded)
    assert.isNumber(resultsBody.failed)
    assert.isNumber(resultsBody.processing_time)
    assert.isArray(resultsBody.results)

    // Step 4: Cancel the job (if still processing)
    const cancelResponse = await apiClient
      .post(`/batch/screenshots/${jobId}/cancel`)
      .header('X-API-Key', testApiKey.key)

    // Should return 200 if cancelled or 400 if already completed
    assert.include([200, 400], cancelResponse.status())

    if (cancelResponse.status() === 200) {
      const cancelBody = cancelResponse.body()
      assert.equal(cancelBody.job_id, jobId)
      assert.equal(cancelBody.status, 'cancelled')
    }
  })

  test('batch job scheduling workflow', async ({ assert }) => {
    // Step 1: Create a batch job
    const createResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [{ id: 'item1', url: 'https://example.com' }],
        config: {
          parallel: 1,
          timeout: 30000,
        },
      })

    assert.equal(createResponse.status(), 202)
    const jobId = createResponse.body().job_id

    // Step 2: Schedule the job for future execution
    const futureTime = DateTime.now().plus({ minutes: 5 }).toISO()
    const scheduleResponse = await apiClient
      .post(`/batch/screenshots/${jobId}/schedule`)
      .header('X-API-Key', testApiKey.key)
      .json({
        scheduled_time: futureTime,
      })

    assert.equal(scheduleResponse.status(), 202)
    const scheduleBody = scheduleResponse.body()
    assert.equal(scheduleBody.job_id, jobId)
    assert.equal(scheduleBody.status, 'scheduled')
    assert.equal(scheduleBody.scheduled_time, futureTime)

    // Step 3: Set recurrence pattern
    const recurrenceResponse = await apiClient
      .post(`/batch/screenshots/${jobId}/recurrence`)
      .header('X-API-Key', testApiKey.key)
      .json({
        pattern: 'daily',
        interval: 1,
      })

    assert.equal(recurrenceResponse.status(), 202)
    const recurrenceBody = recurrenceResponse.body()
    assert.equal(recurrenceBody.job_id, jobId)
    assert.equal(recurrenceBody.config.recurrence, 'daily')
    assert.equal(recurrenceBody.config.recurrence_interval, 1)

    // Step 4: Cancel the scheduled job
    const cancelResponse = await apiClient
      .post(`/batch/screenshots/${jobId}/cancel`)
      .header('X-API-Key', testApiKey.key)

    assert.equal(cancelResponse.status(), 200)
    const cancelBody = cancelResponse.body()
    assert.equal(cancelBody.status, 'cancelled')
  })

  test('active batch jobs workflow', async ({ assert }) => {
    // Step 1: Create multiple batch jobs
    const job1Response = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [{ id: 'item1', url: 'https://example.com' }],
        config: { parallel: 1 },
      })

    const job2Response = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [{ id: 'item1', url: 'https://httpbin.org/html' }],
        config: {
          parallel: 1,
          scheduled_time: DateTime.now().plus({ minutes: 10 }).toISO(),
        },
      })

    assert.equal(job1Response.status(), 202)
    assert.equal(job2Response.status(), 202)

    // Step 2: Get active batch jobs
    const activeResponse = await apiClient
      .get('/batch/screenshots/active')
      .header('X-API-Key', testApiKey.key)

    assert.equal(activeResponse.status(), 200)
    const activeBody = activeResponse.body()
    assert.isArray(activeBody.jobs)
    assert.isAtLeast(activeBody.jobs.length, 1) // At least one active job

    // Verify job structure
    if (activeBody.jobs.length > 0) {
      const job = activeBody.jobs[0]
      assert.isString(job.job_id)
      assert.include(['processing', 'scheduled'], job.status)
      assert.isNumber(job.total)
      assert.isNumber(job.completed)
      assert.isNumber(job.failed)
      assert.isString(job.created_at)
      assert.isString(job.updated_at)
    }
  })

  test('cache management workflow', async ({ assert }) => {
    // Step 1: Get initial cache statistics
    const initialStatsResponse = await apiClient
      .get('/cache/stats')
      .header('X-API-Key', testApiKey.key)

    assert.equal(initialStatsResponse.status(), 200)
    const initialStats = initialStatsResponse.body()
    assert.isBoolean(initialStats.enabled)
    assert.isNumber(initialStats.size)
    assert.isNumber(initialStats.max_size)
    assert.isNumber(initialStats.ttl)
    assert.isNumber(initialStats.hits)
    assert.isNumber(initialStats.misses)
    assert.isNumber(initialStats.hit_rate)
    assert.isNumber(initialStats.cleanup_interval)

    // Step 2: Take a screenshot to populate cache
    const screenshotResponse = await apiClient
      .post('/screenshot')
      .header('X-API-Key', testApiKey.key)
      .json({
        url: 'https://example.com',
        format: 'png',
        width: 800,
        height: 600,
        cache: true,
      })

    // Should succeed or return processing status
    assert.include([200, 429], screenshotResponse.status())

    // Step 3: Invalidate cache for specific URL
    const invalidateResponse = await apiClient
      .delete('/cache/url')
      .header('X-API-Key', testApiKey.key)
      .qs({ url: 'https://example.com' })

    assert.equal(invalidateResponse.status(), 200)
    const invalidateBody = invalidateResponse.body()
    assert.isNumber(invalidateBody.invalidated)

    // Step 4: Clear entire cache
    const clearResponse = await apiClient
      .delete('/cache')
      .header('X-API-Key', testApiKey.key)

    assert.equal(clearResponse.status(), 204)

    // Step 5: Get final cache statistics
    const finalStatsResponse = await apiClient
      .get('/cache/stats')
      .header('X-API-Key', testApiKey.key)

    assert.equal(finalStatsResponse.status(), 200)
    const finalStats = finalStatsResponse.body()
    assert.isNumber(finalStats.size)
  })

  test('error scenarios workflow', async ({ assert }) => {
    // Test 1: Non-existent job operations
    const nonExistentJobId = '99999'

    const statusResponse = await apiClient
      .get(`/batch/screenshots/${nonExistentJobId}`)
      .header('X-API-Key', testApiKey.key)

    assert.equal(statusResponse.status(), 404)
    assert.equal(statusResponse.body().detail.error, 'job_not_found')

    const scheduleResponse = await apiClient
      .post(`/batch/screenshots/${nonExistentJobId}/schedule`)
      .header('X-API-Key', testApiKey.key)
      .json({ scheduled_time: DateTime.now().plus({ hours: 1 }).toISO() })

    assert.equal(scheduleResponse.status(), 404)

    const cancelResponse = await apiClient
      .post(`/batch/screenshots/${nonExistentJobId}/cancel`)
      .header('X-API-Key', testApiKey.key)

    assert.equal(cancelResponse.status(), 404)

    const resultsResponse = await apiClient
      .get(`/batch/screenshots/${nonExistentJobId}/results`)
      .header('X-API-Key', testApiKey.key)

    assert.equal(resultsResponse.status(), 404)

    // Test 2: Invalid scheduling parameters
    const createResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [{ id: 'item1', url: 'https://example.com' }],
        config: { parallel: 1 },
      })

    const jobId = createResponse.body().job_id

    // Invalid scheduled time (past)
    const pastTime = DateTime.now().minus({ hours: 1 }).toISO()
    const invalidScheduleResponse = await apiClient
      .post(`/batch/screenshots/${jobId}/schedule`)
      .header('X-API-Key', testApiKey.key)
      .json({ scheduled_time: pastTime })

    assert.equal(invalidScheduleResponse.status(), 400)
    assert.equal(invalidScheduleResponse.body().detail.error, 'invalid_scheduled_time')

    // Invalid recurrence pattern
    const invalidRecurrenceResponse = await apiClient
      .post(`/batch/screenshots/${jobId}/recurrence`)
      .header('X-API-Key', testApiKey.key)
      .json({ pattern: 'invalid-pattern' })

    assert.equal(invalidRecurrenceResponse.status(), 422)
    assert.equal(invalidRecurrenceResponse.body().detail.error, 'validation_failed')

    // Test 3: Cache invalidation with invalid URL
    const invalidUrlResponse = await apiClient
      .delete('/cache/url')
      .header('X-API-Key', testApiKey.key)
      .qs({ url: 'invalid-url-format' })

    assert.equal(invalidUrlResponse.status(), 422)
    assert.equal(invalidUrlResponse.body().detail.error, 'validation_failed')

    // Test 4: Missing URL parameter for cache invalidation
    const missingUrlResponse = await apiClient
      .delete('/cache/url')
      .header('X-API-Key', testApiKey.key)

    assert.equal(missingUrlResponse.status(), 422)
    assert.equal(missingUrlResponse.body().detail.error, 'validation_failed')
  })

  test('webhook delivery workflow', async ({ assert }) => {
    // Note: This test creates a batch job with webhook configuration
    // In a real scenario, the webhook would be called when the job completes
    const webhookUrl = 'https://webhook.site/test-webhook-endpoint'
    const webhookAuth = 'Bearer test-token-123'

    const createResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [{ id: 'item1', url: 'https://example.com' }],
        config: {
          parallel: 1,
          timeout: 30000,
          webhook_url: webhookUrl,
          webhook_auth: webhookAuth,
        },
      })

    assert.equal(createResponse.status(), 202)
    const createBody = createResponse.body()
    const jobId = createBody.job_id

    // Verify webhook configuration is stored
    const statusResponse = await apiClient
      .get(`/batch/screenshots/${jobId}`)
      .header('X-API-Key', testApiKey.key)

    assert.equal(statusResponse.status(), 200)
    const statusBody = statusResponse.body()
    assert.equal(statusBody.config.webhook_url, webhookUrl)
    assert.equal(statusBody.config.webhook_auth, webhookAuth)

    // Note: Actual webhook delivery testing would require a mock webhook server
    // or integration with a webhook testing service
  })

  test('batch job with priority and advanced configuration', async ({ assert }) => {
    const createResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [
          { id: 'item1', url: 'https://example.com' },
          { id: 'item2', url: 'https://httpbin.org/html' },
        ],
        config: {
          parallel: 3,
          timeout: 45000,
          cache: false,
          priority: 'high',
          fail_fast: true,
          rate_limit: 5,
        },
      })

    assert.equal(createResponse.status(), 202)
    const createBody = createResponse.body()
    assert.equal(createBody.priority, 'high')

    const jobId = createBody.job_id

    // Verify advanced configuration is stored
    const statusResponse = await apiClient
      .get(`/batch/screenshots/${jobId}`)
      .header('X-API-Key', testApiKey.key)

    assert.equal(statusResponse.status(), 200)
    const statusBody = statusResponse.body()
    assert.equal(statusBody.config.parallel, 3)
    assert.equal(statusBody.config.timeout, 45000)
    assert.equal(statusBody.config.cache, false)
    assert.equal(statusBody.config.priority, 'high')
    assert.equal(statusBody.config.fail_fast, true)
    assert.equal(statusBody.config.rate_limit, 5)
  })

  test('custom cron recurrence workflow', async ({ assert }) => {
    // Create a batch job
    const createResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [{ id: 'item1', url: 'https://example.com' }],
        config: { parallel: 1 },
      })

    const jobId = createResponse.body().job_id

    // Set custom cron recurrence (every 6 hours)
    const recurrenceResponse = await apiClient
      .post(`/batch/screenshots/${jobId}/recurrence`)
      .header('X-API-Key', testApiKey.key)
      .json({
        pattern: 'custom',
        cron: '0 */6 * * *',
        count: 10, // Limit to 10 executions
      })

    assert.equal(recurrenceResponse.status(), 202)
    const recurrenceBody = recurrenceResponse.body()
    assert.equal(recurrenceBody.config.recurrence, 'custom')
    assert.equal(recurrenceBody.config.recurrence_cron, '0 */6 * * *')
    assert.equal(recurrenceBody.config.recurrence_count, 10)

    // Test invalid cron expression
    const invalidCronResponse = await apiClient
      .post(`/batch/screenshots/${jobId}/recurrence`)
      .header('X-API-Key', testApiKey.key)
      .json({
        pattern: 'custom',
        cron: 'invalid-cron-expression',
      })

    assert.equal(invalidCronResponse.status(), 422)
    assert.equal(invalidCronResponse.body().detail.error, 'validation_failed')
  })
})