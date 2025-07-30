import { test } from '@japa/runner'
import { ApiClient } from '@japa/api-client'
import ApiKey from '#models/api_key'
import User from '#models/user'
import BatchJob from '#models/batch_job'
import { cleanupRedisConnections } from '#tests/utils/redis_test_utils'
import { DateTime } from 'luxon'

test.group('Enhanced Endpoints - Performance Tests', (group) => {
  let apiClient: ApiClient
  let testUser: User
  let testApiKey: ApiKey

  group.setup(async () => {
    apiClient = new ApiClient()

    // Create test user
    testUser = await User.create({
      email: 'enhanced-perf-test@example.com',
      password: 'password123',
    })

    // Create test API key with high rate limit
    testApiKey = await ApiKey.create({
      key: 'enhanced-perf-test-api-key-123',
      name: 'Enhanced Performance Test Key',
      userId: testUser.id,
      rateLimit: 10000,
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

  test('cache hit/miss tracking performance impact', async ({ assert }) => {
    const iterations = 100
    const testUrl = 'https://example.com'
    
    // Measure baseline performance without cache tracking
    const baselineStartTime = Date.now()
    
    for (let i = 0; i < iterations; i++) {
      const response = await apiClient
        .post('/screenshot')
        .header('X-API-Key', testApiKey.key)
        .json({
          url: `${testUrl}?test=${i}`,
          format: 'png',
          width: 800,
          height: 600,
          cache: false, // Disable cache to avoid hits
        })
      
      // Accept both success and processing responses
      assert.include([200, 429], response.status())
    }
    
    const baselineTime = Date.now() - baselineStartTime
    
    // Measure performance with cache tracking enabled
    const trackingStartTime = Date.now()
    
    for (let i = 0; i < iterations; i++) {
      const response = await apiClient
        .post('/screenshot')
        .header('X-API-Key', testApiKey.key)
        .json({
          url: `${testUrl}?tracking=${i}`,
          format: 'png',
          width: 800,
          height: 600,
          cache: true, // Enable cache to trigger tracking
        })
      
      assert.include([200, 429], response.status())
      
      // Verify enhanced response format
      if (response.status() === 200) {
        const body = response.body()
        assert.isBoolean(body.success)
        assert.isString(body.screenshot_url)
        assert.isBoolean(body.cache_hit)
        assert.isNumber(body.processing_time_ms)
        assert.isNumber(body.file_size_bytes)
      }
    }
    
    const trackingTime = Date.now() - trackingStartTime
    
    // Performance impact should be minimal (less than 20% overhead)
    const performanceImpact = (trackingTime - baselineTime) / baselineTime
    assert.isBelow(performanceImpact, 0.2, 'Cache tracking should not significantly impact performance')
    
    console.log(`Cache tracking performance impact: ${(performanceImpact * 100).toFixed(2)}%`)
    console.log(`Baseline time: ${baselineTime}ms, Tracking time: ${trackingTime}ms`)
  })

  test('batch job status tracking performance', async ({ assert }) => {
    const jobCount = 50
    const jobs: string[] = []
    
    // Create multiple batch jobs
    const creationStartTime = Date.now()
    
    for (let i = 0; i < jobCount; i++) {
      const response = await apiClient
        .post('/batch/screenshots')
        .header('X-API-Key', testApiKey.key)
        .json({
          items: [
            { id: `item1-${i}`, url: `https://example.com/page${i}` },
            { id: `item2-${i}`, url: `https://httpbin.org/html?test=${i}` },
          ],
          config: {
            parallel: 2,
            timeout: 30000,
          },
        })
      
      assert.equal(response.status(), 202)
      jobs.push(response.body().job_id)
    }
    
    const creationTime = Date.now() - creationStartTime
    
    // Test batch status retrieval performance
    const statusStartTime = Date.now()
    
    for (const jobId of jobs) {
      const response = await apiClient
        .get(`/batch/screenshots/${jobId}`)
        .header('X-API-Key', testApiKey.key)
      
      assert.equal(response.status(), 200)
      
      const body = response.body()
      assert.isString(body.job_id)
      assert.isString(body.status)
      assert.isNumber(body.total)
      assert.isNumber(body.completed)
      assert.isNumber(body.failed)
      assert.isNumber(body.progress_percentage)
      assert.isString(body.created_at)
      assert.isString(body.updated_at)
      assert.isObject(body.config)
      assert.isArray(body.results)
      assert.isArray(body.successful_results)
      assert.isArray(body.failed_results)
    }
    
    const statusTime = Date.now() - statusStartTime
    
    // Test results retrieval performance
    const resultsStartTime = Date.now()
    
    for (const jobId of jobs) {
      const response = await apiClient
        .get(`/batch/screenshots/${jobId}/results`)
        .header('X-API-Key', testApiKey.key)
      
      assert.equal(response.status(), 200)
      
      const body = response.body()
      assert.isString(body.job_id)
      assert.isString(body.status)
      assert.isNumber(body.total)
      assert.isNumber(body.succeeded)
      assert.isNumber(body.failed)
      assert.isNumber(body.processing_time)
      assert.isArray(body.results)
    }
    
    const resultsTime = Date.now() - resultsStartTime
    
    // Performance assertions
    const avgCreationTime = creationTime / jobCount
    const avgStatusTime = statusTime / jobCount
    const avgResultsTime = resultsTime / jobCount
    
    assert.isBelow(avgCreationTime, 1000, 'Job creation should be fast')
    assert.isBelow(avgStatusTime, 500, 'Status retrieval should be fast')
    assert.isBelow(avgResultsTime, 500, 'Results retrieval should be fast')
    
    console.log(`Average job creation time: ${avgCreationTime.toFixed(2)}ms`)
    console.log(`Average status retrieval time: ${avgStatusTime.toFixed(2)}ms`)
    console.log(`Average results retrieval time: ${avgResultsTime.toFixed(2)}ms`)
  })

  test('active jobs listing performance with large dataset', async ({ assert }) => {
    const jobCount = 100
    const jobs: string[] = []
    
    // Create many batch jobs to test active jobs performance
    for (let i = 0; i < jobCount; i++) {
      const response = await apiClient
        .post('/batch/screenshots')
        .header('X-API-Key', testApiKey.key)
        .json({
          items: [{ id: `item-${i}`, url: `https://example.com/test${i}` }],
          config: {
            parallel: 1,
            scheduled_time: DateTime.now().plus({ minutes: i + 1 }).toISO(),
          },
        })
      
      assert.equal(response.status(), 202)
      jobs.push(response.body().job_id)
    }
    
    // Test active jobs retrieval performance
    const iterations = 20
    const times: number[] = []
    
    for (let i = 0; i < iterations; i++) {
      const startTime = Date.now()
      
      const response = await apiClient
        .get('/batch/screenshots/active')
        .header('X-API-Key', testApiKey.key)
      
      const endTime = Date.now()
      times.push(endTime - startTime)
      
      assert.equal(response.status(), 200)
      
      const body = response.body()
      assert.isArray(body.jobs)
      assert.isAtLeast(body.jobs.length, 1)
      
      // Verify job structure
      if (body.jobs.length > 0) {
        const job = body.jobs[0]
        assert.isString(job.job_id)
        assert.include(['processing', 'scheduled'], job.status)
        assert.isNumber(job.total)
        assert.isNumber(job.completed)
        assert.isNumber(job.failed)
        assert.isString(job.created_at)
        assert.isString(job.updated_at)
      }
    }
    
    const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length
    const maxTime = Math.max(...times)
    const minTime = Math.min(...times)
    
    // Performance assertions
    assert.isBelow(avgTime, 1000, 'Active jobs listing should be fast on average')
    assert.isBelow(maxTime, 2000, 'Active jobs listing should not have extreme outliers')
    
    console.log(`Active jobs listing - Avg: ${avgTime.toFixed(2)}ms, Min: ${minTime}ms, Max: ${maxTime}ms`)
  })

  test('concurrent cache operations performance', async ({ assert }) => {
    const concurrentRequests = 50
    const testUrl = 'https://example.com/concurrent-test'
    
    // Test concurrent cache statistics requests
    const statsPromises = Array.from({ length: concurrentRequests }, () =>
      apiClient.get('/cache/stats').header('X-API-Key', testApiKey.key)
    )
    
    const statsStartTime = Date.now()
    const statsResponses = await Promise.all(statsPromises)
    const statsTime = Date.now() - statsStartTime
    
    // Verify all requests succeeded
    statsResponses.forEach((response) => {
      assert.equal(response.status(), 200)
      
      const body = response.body()
      assert.isBoolean(body.enabled)
      assert.isNumber(body.size)
      assert.isNumber(body.max_size)
      assert.isNumber(body.ttl)
      assert.isNumber(body.hits)
      assert.isNumber(body.misses)
      assert.isNumber(body.hit_rate)
      assert.isNumber(body.cleanup_interval)
    })
    
    // Test concurrent cache invalidation requests
    const invalidationPromises = Array.from({ length: concurrentRequests }, (_, i) =>
      apiClient
        .delete('/cache/url')
        .header('X-API-Key', testApiKey.key)
        .qs({ url: `${testUrl}?concurrent=${i}` })
    )
    
    const invalidationStartTime = Date.now()
    const invalidationResponses = await Promise.all(invalidationPromises)
    const invalidationTime = Date.now() - invalidationStartTime
    
    // Verify all requests succeeded
    invalidationResponses.forEach((response) => {
      assert.equal(response.status(), 200)
      
      const body = response.body()
      assert.isNumber(body.invalidated)
    })
    
    // Performance assertions
    const avgStatsTime = statsTime / concurrentRequests
    const avgInvalidationTime = invalidationTime / concurrentRequests
    
    assert.isBelow(avgStatsTime, 200, 'Concurrent cache stats should be fast')
    assert.isBelow(avgInvalidationTime, 300, 'Concurrent cache invalidation should be fast')
    
    console.log(`Concurrent cache stats - Total: ${statsTime}ms, Avg: ${avgStatsTime.toFixed(2)}ms`)
    console.log(`Concurrent cache invalidation - Total: ${invalidationTime}ms, Avg: ${avgInvalidationTime.toFixed(2)}ms`)
  })

  test('batch job scheduling and cancellation performance', async ({ assert }) => {
    const jobCount = 30
    const jobs: string[] = []
    
    // Create batch jobs
    for (let i = 0; i < jobCount; i++) {
      const response = await apiClient
        .post('/batch/screenshots')
        .header('X-API-Key', testApiKey.key)
        .json({
          items: [{ id: `item-${i}`, url: `https://example.com/schedule${i}` }],
          config: { parallel: 1 },
        })
      
      assert.equal(response.status(), 202)
      jobs.push(response.body().job_id)
    }
    
    // Test scheduling performance
    const schedulingStartTime = Date.now()
    
    for (const jobId of jobs) {
      const futureTime = DateTime.now().plus({ minutes: Math.random() * 60 }).toISO()
      
      const response = await apiClient
        .post(`/batch/screenshots/${jobId}/schedule`)
        .header('X-API-Key', testApiKey.key)
        .json({ scheduled_time: futureTime })
      
      assert.equal(response.status(), 202)
      
      const body = response.body()
      assert.equal(body.job_id, jobId)
      assert.equal(body.status, 'scheduled')
      assert.equal(body.scheduled_time, futureTime)
    }
    
    const schedulingTime = Date.now() - schedulingStartTime
    
    // Test recurrence setting performance
    const recurrenceStartTime = Date.now()
    
    for (const jobId of jobs) {
      const response = await apiClient
        .post(`/batch/screenshots/${jobId}/recurrence`)
        .header('X-API-Key', testApiKey.key)
        .json({
          pattern: 'daily',
          interval: 1,
        })
      
      assert.equal(response.status(), 202)
      
      const body = response.body()
      assert.equal(body.job_id, jobId)
      assert.equal(body.config.recurrence, 'daily')
    }
    
    const recurrenceTime = Date.now() - recurrenceStartTime
    
    // Test cancellation performance
    const cancellationStartTime = Date.now()
    
    for (const jobId of jobs) {
      const response = await apiClient
        .post(`/batch/screenshots/${jobId}/cancel`)
        .header('X-API-Key', testApiKey.key)
      
      assert.equal(response.status(), 200)
      
      const body = response.body()
      assert.equal(body.job_id, jobId)
      assert.equal(body.status, 'cancelled')
    }
    
    const cancellationTime = Date.now() - cancellationStartTime
    
    // Performance assertions
    const avgSchedulingTime = schedulingTime / jobCount
    const avgRecurrenceTime = recurrenceTime / jobCount
    const avgCancellationTime = cancellationTime / jobCount
    
    assert.isBelow(avgSchedulingTime, 500, 'Job scheduling should be fast')
    assert.isBelow(avgRecurrenceTime, 500, 'Recurrence setting should be fast')
    assert.isBelow(avgCancellationTime, 500, 'Job cancellation should be fast')
    
    console.log(`Average scheduling time: ${avgSchedulingTime.toFixed(2)}ms`)
    console.log(`Average recurrence time: ${avgRecurrenceTime.toFixed(2)}ms`)
    console.log(`Average cancellation time: ${avgCancellationTime.toFixed(2)}ms`)
  })

  test('response time consistency under load', async ({ assert }) => {
    const iterations = 100
    const endpoints = [
      { method: 'GET', path: '/cache/stats' },
      { method: 'GET', path: '/batch/screenshots/active' },
    ]
    
    for (const endpoint of endpoints) {
      const times: number[] = []
      
      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now()
        
        let response
        if (endpoint.method === 'GET') {
          response = await apiClient.get(endpoint.path).header('X-API-Key', testApiKey.key)
        }
        
        const endTime = Date.now()
        times.push(endTime - startTime)
        
        assert.equal(response!.status(), 200)
      }
      
      // Calculate statistics
      const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length
      const sortedTimes = times.sort((a, b) => a - b)
      const p50 = sortedTimes[Math.floor(iterations * 0.5)]
      const p95 = sortedTimes[Math.floor(iterations * 0.95)]
      const p99 = sortedTimes[Math.floor(iterations * 0.99)]
      const maxTime = Math.max(...times)
      const minTime = Math.min(...times)
      
      // Performance assertions
      assert.isBelow(avgTime, 1000, `${endpoint.path} average response time should be reasonable`)
      assert.isBelow(p95, 2000, `${endpoint.path} 95th percentile should be reasonable`)
      assert.isBelow(p99, 3000, `${endpoint.path} 99th percentile should be reasonable`)
      
      // Consistency check - standard deviation should not be too high
      const variance = times.reduce((sum, time) => sum + Math.pow(time - avgTime, 2), 0) / times.length
      const stdDev = Math.sqrt(variance)
      const coefficientOfVariation = stdDev / avgTime
      
      assert.isBelow(coefficientOfVariation, 1.0, `${endpoint.path} response times should be consistent`)
      
      console.log(`${endpoint.method} ${endpoint.path} performance:`)
      console.log(`  Avg: ${avgTime.toFixed(2)}ms, Min: ${minTime}ms, Max: ${maxTime}ms`)
      console.log(`  P50: ${p50}ms, P95: ${p95}ms, P99: ${p99}ms`)
      console.log(`  Std Dev: ${stdDev.toFixed(2)}ms, CV: ${coefficientOfVariation.toFixed(3)}`)
    }
  })

  test('memory usage during bulk operations', async ({ assert }) => {
    // This test monitors memory usage during bulk operations
    // Note: In a real environment, you might use process.memoryUsage()
    
    const initialMemory = process.memoryUsage()
    const jobCount = 20
    const jobs: string[] = []
    
    // Create many jobs to test memory usage
    for (let i = 0; i < jobCount; i++) {
      const response = await apiClient
        .post('/batch/screenshots')
        .header('X-API-Key', testApiKey.key)
        .json({
          items: Array.from({ length: 10 }, (_, j) => ({
            id: `item-${i}-${j}`,
            url: `https://example.com/memory-test-${i}-${j}`,
          })),
          config: { parallel: 5 },
        })
      
      assert.equal(response.status(), 202)
      jobs.push(response.body().job_id)
    }
    
    const afterCreationMemory = process.memoryUsage()
    
    // Perform bulk status checks
    for (let iteration = 0; iteration < 5; iteration++) {
      for (const jobId of jobs) {
        const response = await apiClient
          .get(`/batch/screenshots/${jobId}`)
          .header('X-API-Key', testApiKey.key)
        
        assert.equal(response.status(), 200)
      }
    }
    
    const afterOperationsMemory = process.memoryUsage()
    
    // Check memory growth
    const creationMemoryGrowth = afterCreationMemory.heapUsed - initialMemory.heapUsed
    const operationsMemoryGrowth = afterOperationsMemory.heapUsed - afterCreationMemory.heapUsed
    
    // Memory growth should be reasonable (less than 100MB for this test)
    const maxAcceptableGrowth = 100 * 1024 * 1024 // 100MB
    
    assert.isBelow(creationMemoryGrowth, maxAcceptableGrowth, 'Memory growth during job creation should be reasonable')
    assert.isBelow(operationsMemoryGrowth, maxAcceptableGrowth, 'Memory growth during operations should be reasonable')
    
    console.log(`Memory usage:`)
    console.log(`  Initial: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`)
    console.log(`  After creation: ${(afterCreationMemory.heapUsed / 1024 / 1024).toFixed(2)}MB (+${(creationMemoryGrowth / 1024 / 1024).toFixed(2)}MB)`)
    console.log(`  After operations: ${(afterOperationsMemory.heapUsed / 1024 / 1024).toFixed(2)}MB (+${(operationsMemoryGrowth / 1024 / 1024).toFixed(2)}MB)`)
  })
})