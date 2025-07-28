import { test } from '@japa/runner'
import { ApiClient } from '@japa/api-client'
import ApiKey from '#models/api_key'
import User from '#models/user'
import { cleanupRedisConnections } from '#tests/utils/redis_test_utils'

test.group('Screenshot Workflow - Integration Tests', (group) => {
  let apiClient: ApiClient
  let testUser: User
  let testApiKey: ApiKey

  group.setup(async () => {
    apiClient = new ApiClient()

    // Create test user
    testUser = await User.create({
      email: 'test@example.com',
      password: 'password123',
    })

    // Create test API key
    testApiKey = await ApiKey.create({
      key: 'test-api-key-integration-123',
      name: 'Integration Test Key',
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

  test('complete single screenshot workflow', async ({ assert }) => {
    // Test single screenshot endpoint with valid request
    const response = await apiClient.post('/screenshot').header('X-API-Key', testApiKey.key).json({
      url: 'https://example.com',
      format: 'png',
      width: 1280,
      height: 720,
      cache: true,
    })

    response.assertStatus(200)
    response.assertBodyContains({
      cached: false,
    })

    assert.isString(response.body().url)
    assert.isTrue(response.body().url.length > 0)

    // Test cache hit on second request
    const cachedResponse = await apiClient
      .post('/screenshot')
      .header('X-API-Key', testApiKey.key)
      .json({
        url: 'https://example.com',
        format: 'png',
        width: 1280,
        height: 720,
        cache: true,
      })

    cachedResponse.assertStatus(200)
    cachedResponse.assertBodyContains({
      cached: true,
    })

    assert.equal(cachedResponse.body().url, response.body().url)
  })

  test('complete batch screenshot workflow', async ({ assert }) => {
    // Create batch job
    const batchResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [
          { id: 'item1', url: 'https://example.com', format: 'png' },
          { id: 'item2', url: 'https://httpbin.org/html', format: 'jpeg' },
        ],
        config: {
          parallel: 2,
          timeout: 30000,
          cache: true,
          fail_fast: false,
        },
      })

    batchResponse.assertStatus(202)
    batchResponse.assertBodyContains({
      status: 'pending',
      total: 2,
      completed: 0,
      failed: 0,
    })

    const jobId = batchResponse.body().job_id
    assert.isString(jobId)

    // Check initial status
    const statusResponse = await apiClient
      .get(`/batch/screenshots/${jobId}`)
      .header('X-API-Key', testApiKey.key)

    statusResponse.assertStatus(200)
    statusResponse.assertBodyContains({
      job_id: jobId,
      total: 2,
      status: 'pending',
    })

    // Wait for processing to complete (with timeout)
    let finalStatus: any
    let attempts = 0
    const maxAttempts = 30 // 30 seconds max wait

    do {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const checkResponse = await apiClient
        .get(`/batch/screenshots/${jobId}`)
        .header('X-API-Key', testApiKey.key)

      finalStatus = checkResponse.body()
      attempts++
    } while (
      finalStatus.status !== 'completed' &&
      finalStatus.status !== 'failed' &&
      attempts < maxAttempts
    )

    // Verify final status
    assert.isTrue(['completed', 'failed'].includes(finalStatus.status))
    assert.equal(finalStatus.total, 2)
    assert.isArray(finalStatus.results)
    assert.lengthOf(finalStatus.results, 2)

    // Check that at least some items were processed successfully
    const successfulItems = finalStatus.results.filter((r: any) => r.status === 'success')
    assert.isTrue(successfulItems.length > 0, 'At least one item should be processed successfully')

    // Verify successful items have URLs
    successfulItems.forEach((item: any) => {
      assert.isString(item.url)
      assert.isTrue(item.url.length > 0)
    })
  })

  test('authentication and rate limiting workflow', async ({ assert }) => {
    // Test missing API key
    const noKeyResponse = await apiClient.post('/screenshot').json({
      url: 'https://example.com',
    })

    noKeyResponse.assertStatus(401)
    noKeyResponse.assertBodyContains({
      detail: {
        error: 'missing_api_key',
      },
    })

    // Test invalid API key
    const invalidKeyResponse = await apiClient
      .post('/screenshot')
      .header('X-API-Key', 'invalid-key-123')
      .json({
        url: 'https://example.com',
      })

    invalidKeyResponse.assertStatus(401)
    invalidKeyResponse.assertBodyContains({
      detail: {
        error: 'invalid_api_key',
      },
    })

    // Test valid API key works
    const validResponse = await apiClient
      .post('/screenshot')
      .header('X-API-Key', testApiKey.key)
      .json({
        url: 'https://example.com',
      })

    validResponse.assertStatus(200)

    // Check rate limit headers are present
    assert.isDefined(validResponse.headers()['x-ratelimit-limit'])
    assert.isDefined(validResponse.headers()['x-ratelimit-remaining'])
  })

  test('error handling workflow', async ({}) => {
    // Test invalid URL
    const invalidUrlResponse = await apiClient
      .post('/screenshot')
      .header('X-API-Key', testApiKey.key)
      .json({
        url: 'not-a-valid-url',
      })

    invalidUrlResponse.assertStatus(400)
    invalidUrlResponse.assertBodyContains({
      detail: {
        error: 'validation_failed',
      },
    })

    // Test invalid dimensions
    const invalidDimensionsResponse = await apiClient
      .post('/screenshot')
      .header('X-API-Key', testApiKey.key)
      .json({
        url: 'https://example.com',
        width: 10000, // Too large
        height: 10000,
      })

    invalidDimensionsResponse.assertStatus(400)

    // Test invalid format
    const invalidFormatResponse = await apiClient
      .post('/screenshot')
      .header('X-API-Key', testApiKey.key)
      .json({
        url: 'https://example.com',
        format: 'invalid-format',
      })

    invalidFormatResponse.assertStatus(400)

    // Test batch with too many items
    const tooManyItemsResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: Array.from({ length: 201 }, (_, i) => ({
          id: `item${i}`,
          url: 'https://example.com',
        })),
      })

    tooManyItemsResponse.assertStatus(400)
    tooManyItemsResponse.assertBodyContains({
      detail: {
        error: 'validation_failed',
      },
    })
  })

  test('batch job not found workflow', async ({}) => {
    const notFoundResponse = await apiClient
      .get('/batch/screenshots/999999')
      .header('X-API-Key', testApiKey.key)

    notFoundResponse.assertStatus(404)
    notFoundResponse.assertBodyContains({
      detail: {
        error: 'job_not_found',
      },
    })
  })

  test('scheduled batch job workflow', async ({ assert }) => {
    // Schedule a batch job for 2 seconds in the future
    const scheduledTime = new Date(Date.now() + 2000).toISOString()

    const scheduledResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [{ id: 'scheduled1', url: 'https://example.com' }],
        config: {
          scheduled_time: scheduledTime,
        },
      })

    scheduledResponse.assertStatus(202)
    scheduledResponse.assertBodyContains({
      status: 'scheduled',
      scheduled_time: scheduledTime,
    })

    const jobId = scheduledResponse.body().job_id

    // Check that job is initially scheduled
    const initialStatusResponse = await apiClient
      .get(`/batch/screenshots/${jobId}`)
      .header('X-API-Key', testApiKey.key)

    initialStatusResponse.assertStatus(200)
    initialStatusResponse.assertBodyContains({
      status: 'scheduled',
    })

    // Wait for scheduled execution (with some buffer time)
    await new Promise((resolve) => setTimeout(resolve, 4000))

    // Check that job has started processing
    const laterStatusResponse = await apiClient
      .get(`/batch/screenshots/${jobId}`)
      .header('X-API-Key', testApiKey.key)

    laterStatusResponse.assertStatus(200)
    const laterStatus = laterStatusResponse.body().status
    assert.isTrue(['pending', 'processing', 'completed'].includes(laterStatus))
  })
})
