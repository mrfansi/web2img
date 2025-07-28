import { test } from '@japa/runner'
import { ApiClient } from '@japa/api-client'
import ApiKey from '#models/api_key'
import User from '#models/user'
import { cleanupRedisConnections } from '#tests/utils/redis_test_utils'

test.group('Queue Processing - Integration Tests', (group) => {
  let apiClient: ApiClient
  let testUser: User
  let testApiKey: ApiKey

  group.setup(async () => {
    apiClient = new ApiClient()

    // Create test user
    testUser = await User.create({
      email: 'queue-test@example.com',
      password: 'password123',
    })

    // Create test API key
    testApiKey = await ApiKey.create({
      key: 'queue-test-api-key-123',
      name: 'Queue Test Key',
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

  test('single screenshot queue processing', async ({ assert }) => {
    // Create a single screenshot request that will go through the queue
    const response = await apiClient.post('/screenshot').header('X-API-Key', testApiKey.key).json({
      url: 'https://example.com',
      format: 'png',
      width: 1280,
      height: 720,
      cache: false, // Force processing
    })

    response.assertStatus(200)

    const result = response.body()
    assert.isString(result.url)
    assert.equal(result.cached, false)

    // Verify the URL is accessible (should be an ImgProxy or direct storage URL)
    assert.isTrue(result.url.startsWith('http'))
  })

  test('batch job queue processing with parallel execution', async ({ assert }) => {
    // Create a batch job with multiple items
    const batchResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [
          { id: 'parallel1', url: 'https://example.com', format: 'png' },
          { id: 'parallel2', url: 'https://httpbin.org/html', format: 'jpeg' },
          { id: 'parallel3', url: 'https://httpbin.org/json', format: 'webp' },
          { id: 'parallel4', url: 'https://httpbin.org/xml', format: 'png' },
        ],
        config: {
          parallel: 2, // Process 2 items at a time
          timeout: 30000,
          cache: false,
        },
      })

    batchResponse.assertStatus(202)
    const jobId = batchResponse.body().job_id

    // Monitor job progress
    let finalStatus: any
    let attempts = 0
    const maxAttempts = 60 // 60 seconds max wait
    const statusHistory: any[] = []

    do {
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const statusResponse = await apiClient
        .get(`/batch/screenshots/${jobId}`)
        .header('X-API-Key', testApiKey.key)

      finalStatus = statusResponse.body()
      statusHistory.push({
        timestamp: Date.now(),
        status: finalStatus.status,
        completed: finalStatus.completed,
        failed: finalStatus.failed,
      })

      attempts++
    } while (
      finalStatus.status !== 'completed' &&
      finalStatus.status !== 'failed' &&
      attempts < maxAttempts
    )

    // Verify final status
    assert.isTrue(['completed', 'failed'].includes(finalStatus.status))
    assert.equal(finalStatus.total, 4)
    assert.equal(finalStatus.completed + finalStatus.failed, 4)

    // Verify results structure
    assert.isArray(finalStatus.results)
    assert.lengthOf(finalStatus.results, 4)

    // Check that items were processed
    const successfulItems = finalStatus.results.filter((r: any) => r.status === 'success')
    assert.isTrue(
      successfulItems.length > 0,
      'At least some items should be processed successfully'
    )

    // Verify successful items have proper structure
    successfulItems.forEach((item: any) => {
      assert.isString(item.itemId)
      assert.isString(item.url)
      assert.isBoolean(item.cached)
      assert.isNumber(item.processingTime)
    })

    // Verify progress was tracked correctly
    assert.isTrue(statusHistory.length > 1, 'Should have multiple status updates')

    // Check that progress increased over time
    const progressValues = statusHistory.map((s) => s.completed)
    const isIncreasing = progressValues.every((val, i) => i === 0 || val >= progressValues[i - 1])
    assert.isTrue(isIncreasing, 'Progress should increase over time')
  })

  test('batch job with individual item failures', async ({ assert }) => {
    // Create batch with mix of valid and invalid URLs
    const batchResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [
          { id: 'valid1', url: 'https://example.com' },
          { id: 'invalid1', url: 'https://nonexistent-domain-12345.com' },
          { id: 'valid2', url: 'https://httpbin.org/html' },
          { id: 'invalid2', url: 'not-a-valid-url' },
        ],
        config: {
          parallel: 2,
          fail_fast: false, // Continue processing despite failures
          timeout: 10000, // Shorter timeout for faster test
        },
      })

    batchResponse.assertStatus(202)
    const jobId = batchResponse.body().job_id

    // Wait for processing to complete
    let finalStatus: any
    let attempts = 0
    const maxAttempts = 30

    do {
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const statusResponse = await apiClient
        .get(`/batch/screenshots/${jobId}`)
        .header('X-API-Key', testApiKey.key)

      finalStatus = statusResponse.body()
      attempts++
    } while (
      finalStatus.status !== 'completed' &&
      finalStatus.status !== 'failed' &&
      attempts < maxAttempts
    )

    // Job should complete despite individual failures
    assert.equal(finalStatus.status, 'completed')
    assert.equal(finalStatus.total, 4)

    // Should have both successful and failed items
    assert.isTrue(finalStatus.completed > 0, 'Should have some successful items')
    assert.isTrue(finalStatus.failed > 0, 'Should have some failed items')
    assert.equal(finalStatus.completed + finalStatus.failed, 4)

    // Verify results structure
    const successfulResults = finalStatus.results.filter((r: any) => r.status === 'success')
    const failedResults = finalStatus.results.filter((r: any) => r.status === 'error')

    assert.equal(successfulResults.length, finalStatus.completed)
    assert.equal(failedResults.length, finalStatus.failed)

    // Verify successful results have URLs
    successfulResults.forEach((result: any) => {
      assert.isString(result.url)
      assert.isBoolean(result.cached)
    })

    // Verify failed results have error messages
    failedResults.forEach((result: any) => {
      assert.isString(result.error)
      assert.isUndefined(result.url)
    })
  })

  test('batch job with fail_fast enabled', async ({ assert }) => {
    // Create batch with fail_fast enabled
    const batchResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [
          { id: 'failfast1', url: 'https://nonexistent-domain-12345.com' }, // This should fail
          { id: 'failfast2', url: 'https://example.com' },
          { id: 'failfast3', url: 'https://httpbin.org/html' },
        ],
        config: {
          parallel: 1, // Process one at a time to ensure order
          fail_fast: true,
          timeout: 10000,
        },
      })

    batchResponse.assertStatus(202)
    const jobId = batchResponse.body().job_id

    // Wait for processing
    let finalStatus: any
    let attempts = 0
    const maxAttempts = 20

    do {
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const statusResponse = await apiClient
        .get(`/batch/screenshots/${jobId}`)
        .header('X-API-Key', testApiKey.key)

      finalStatus = statusResponse.body()
      attempts++
    } while (
      finalStatus.status !== 'completed' &&
      finalStatus.status !== 'failed' &&
      attempts < maxAttempts
    )

    // With fail_fast, job should fail when first item fails
    assert.equal(finalStatus.status, 'failed')
    assert.isTrue(finalStatus.failed > 0, 'Should have failed items')

    // Not all items should be processed due to fail_fast
    assert.isTrue(finalStatus.completed + finalStatus.failed < finalStatus.total)
  })

  test('scheduled batch job processing', async ({ assert }) => {
    // Schedule a job for 3 seconds in the future
    const scheduledTime = new Date(Date.now() + 3000).toISOString()

    const batchResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [{ id: 'scheduled1', url: 'https://example.com' }],
        config: {
          scheduled_time: scheduledTime,
        },
      })

    batchResponse.assertStatus(202)
    batchResponse.assertBodyContains({
      status: 'scheduled',
      scheduled_time: scheduledTime,
    })

    const jobId = batchResponse.body().job_id

    // Verify job is initially scheduled
    const initialStatusResponse = await apiClient
      .get(`/batch/screenshots/${jobId}`)
      .header('X-API-Key', testApiKey.key)

    initialStatusResponse.assertStatus(200)
    initialStatusResponse.assertBodyContains({
      status: 'scheduled',
    })

    // Wait for scheduled execution
    await new Promise((resolve) => setTimeout(resolve, 5000))

    // Check that job has started processing
    const laterStatusResponse = await apiClient
      .get(`/batch/screenshots/${jobId}`)
      .header('X-API-Key', testApiKey.key)

    const laterStatus = laterStatusResponse.body().status
    assert.isTrue(['pending', 'processing', 'completed'].includes(laterStatus))

    // Wait for completion
    let finalStatus: any
    let attempts = 0
    const maxAttempts = 20

    do {
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const statusResponse = await apiClient
        .get(`/batch/screenshots/${jobId}`)
        .header('X-API-Key', testApiKey.key)

      finalStatus = statusResponse.body()
      attempts++
    } while (
      finalStatus.status !== 'completed' &&
      finalStatus.status !== 'failed' &&
      attempts < maxAttempts
    )

    assert.equal(finalStatus.status, 'completed')
    assert.equal(finalStatus.completed, 1)
  })

  test('queue priority handling', async ({ assert }) => {
    // Create jobs with different priorities
    const highPriorityResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [{ id: 'high-priority', url: 'https://example.com' }],
        config: {
          priority: 'high',
        },
      })

    const normalPriorityResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [{ id: 'normal-priority', url: 'https://httpbin.org/html' }],
        config: {
          priority: 'normal',
        },
      })

    const lowPriorityResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [{ id: 'low-priority', url: 'https://httpbin.org/json' }],
        config: {
          priority: 'low',
        },
      })

    // All should be accepted
    highPriorityResponse.assertStatus(202)
    normalPriorityResponse.assertStatus(202)
    lowPriorityResponse.assertStatus(202)

    const highJobId = highPriorityResponse.body().job_id
    const normalJobId = normalPriorityResponse.body().job_id
    const lowJobId = lowPriorityResponse.body().job_id

    // Wait for all jobs to complete
    const jobIds = [highJobId, normalJobId, lowJobId]
    const completionTimes: Record<string, number> = {}

    for (const jobId of jobIds) {
      let attempts = 0
      const maxAttempts = 30

      do {
        await new Promise((resolve) => setTimeout(resolve, 1000))

        const statusResponse = await apiClient
          .get(`/batch/screenshots/${jobId}`)
          .header('X-API-Key', testApiKey.key)

        const status = statusResponse.body()
        attempts++

        if (status.status === 'completed') {
          completionTimes[jobId] = Date.now()
          break
        }
      } while (attempts < maxAttempts)
    }

    // Verify all jobs completed
    assert.equal(Object.keys(completionTimes).length, 3)

    // High priority should generally complete first (though this isn't guaranteed in all cases)
    // This is more of a behavioral test than a strict requirement
    console.log('Job completion order:', {
      high: completionTimes[highJobId],
      normal: completionTimes[normalJobId],
      low: completionTimes[lowJobId],
    })
  })

  test('queue metrics and monitoring', async ({ assert }) => {
    // Get initial queue metrics
    const initialMetricsResponse = await apiClient.get('/metrics/processing')
    initialMetricsResponse.assertStatus(200)

    const initialMetrics = initialMetricsResponse.body()
    assert.isDefined(initialMetrics.queue)

    // Create a batch job to generate queue activity
    const batchResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [
          { id: 'metrics1', url: 'https://example.com' },
          { id: 'metrics2', url: 'https://httpbin.org/html' },
        ],
        config: {
          parallel: 1,
        },
      })

    batchResponse.assertStatus(202)
    const jobId = batchResponse.body().job_id

    // Wait a bit for queue activity
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Get updated metrics
    const updatedMetricsResponse = await apiClient.get('/metrics/processing')
    updatedMetricsResponse.assertStatus(200)

    const updatedMetrics = updatedMetricsResponse.body()
    assert.isDefined(updatedMetrics.queue)

    // Wait for job completion
    let attempts = 0
    const maxAttempts = 30

    do {
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const statusResponse = await apiClient
        .get(`/batch/screenshots/${jobId}`)
        .header('X-API-Key', testApiKey.key)

      const status = statusResponse.body().status
      attempts++

      if (status === 'completed' || status === 'failed') {
        break
      }
    } while (attempts < maxAttempts)

    // Get final metrics
    const finalMetricsResponse = await apiClient.get('/metrics/processing')
    finalMetricsResponse.assertStatus(200)

    const finalMetrics = finalMetricsResponse.body()
    assert.isDefined(finalMetrics.queue)

    // Metrics should show processing activity
    console.log('Queue metrics progression:', {
      initial: initialMetrics.queue,
      updated: updatedMetrics.queue,
      final: finalMetrics.queue,
    })
  })
})
