import { test } from '@japa/runner'
import { ApiClient } from '@japa/api-client'
import ApiKey from '#models/api_key'
import User from '#models/user'
import { cleanupRedisConnections } from '#tests/utils/redis_test_utils'
import db from '@adonisjs/lucid/services/db'

test.group('Concurrent Batch Screenshots - Performance Tests', (group) => {
  let apiClient: ApiClient
  let testUser: User
  let testApiKey: ApiKey

  group.setup(async () => {
    apiClient = new ApiClient()

    // Create test user
    testUser = await User.create({
      email: 'concurrent-batch-test@example.com',
      password: 'password123',
    })

    // Create test API key with high rate limit for concurrent testing
    testApiKey = await ApiKey.create({
      key: 'concurrent-batch-test-api-key-123',
      name: 'Concurrent Batch Test Key',
      userId: testUser.id,
      rateLimit: 20000, // High limit for concurrent batch operations
      isActive: true,
    })
  })

  group.each.teardown(async () => {
    // Clean up batch jobs after each test
    try {
      await db.from('batch_jobs').del()
    } catch (error) {
      console.warn('Failed to clean up batch jobs in concurrent batch screenshots performance test:', error)
    }
  })

  group.teardown(async () => {
    // Clean up batch jobs before final cleanup
    try {
      await db.from('batch_jobs').del()
    } catch (error) {
      console.warn('Failed to clean up batch jobs in concurrent batch screenshots performance teardown:', error)
    }

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

  test('concurrent batch screenshots - 10 batches with 3 items each', async ({ assert }) => {
    const batchCount = 10
    const itemsPerBatch = 3
    const totalItems = batchCount * itemsPerBatch
    const startTime = Date.now()

    console.log(`Starting concurrent batch test: ${batchCount} batches × ${itemsPerBatch} items = ${totalItems} total items`)

    // Create 10 concurrent batch requests, each with 3 items
    const batchPromises = Array.from({ length: batchCount }, (_, batchIndex) =>
      apiClient
        .post('/batch/screenshots')
        .header('X-API-Key', testApiKey.key)
        .json({
          items: Array.from({ length: itemsPerBatch }, (_, itemIndex) => ({
            id: `batch-${batchIndex}-item-${itemIndex}`,
            url: `https://httpbin.org/html?batch=${batchIndex}&item=${itemIndex}&timestamp=${Date.now()}`,
            format: ['png', 'jpeg', 'webp'][itemIndex % 3], // Rotate formats
            width: [1280, 1920, 800][itemIndex % 3], // Different sizes
            height: [720, 1080, 600][itemIndex % 3],
          })),
          config: {
            parallel: 2, // Process 2 items in parallel within each batch
            cache: false, // Disable cache to test actual processing
            timeout: 30000,
            fail_fast: false, // Continue processing even if some items fail
          },
        })
    )

    // Execute all batch requests concurrently
    const batchResponses = await Promise.all(batchPromises)
    const jobCreationTime = Date.now() - startTime

    // Verify all batch jobs were created successfully
    const successfulBatches = batchResponses.filter((r) => r.response.status === 202)
    const failedBatchCreations = batchResponses.filter((r) => r.response.status !== 202)

    console.log(`Batch creation results:`)
    console.log(`- Successful batches: ${successfulBatches.length}/${batchCount}`)
    console.log(`- Failed batch creations: ${failedBatchCreations.length}`)
    console.log(`- Job creation time: ${jobCreationTime}ms`)

    // Assert all batches were created
    assert.equal(successfulBatches.length, batchCount, 'All batch jobs should be created successfully')

    const jobIds = successfulBatches.map((r) => r.body().job_id)

    // Monitor all jobs concurrently until completion
    const jobStatuses: Record<string, any> = {}
    let allCompleted = false
    let attempts = 0
    const maxAttempts = 180 // 3 minutes with 1-second intervals
    const statusHistory: Array<{
      timestamp: number
      completedBatches: number
      totalCompleted: number
      totalFailed: number
    }> = []

    console.log(`Monitoring ${jobIds.length} concurrent batch jobs...`)

    do {
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Check status of all jobs concurrently
      const statusPromises = jobIds.map((jobId) =>
        apiClient.get(`/batch/screenshots/${jobId}`).header('X-API-Key', testApiKey.key)
      )

      const statusResponses = await Promise.all(statusPromises)

      allCompleted = true
      let completedBatches = 0
      let totalCompleted = 0
      let totalFailed = 0

      statusResponses.forEach((response, index) => {
        const status = response.body()
        jobStatuses[jobIds[index]] = status

        if (status.status === 'completed' || status.status === 'failed') {
          completedBatches++
        } else {
          allCompleted = false
        }

        totalCompleted += status.completed || 0
        totalFailed += status.failed || 0
      })

      statusHistory.push({
        timestamp: Date.now(),
        completedBatches,
        totalCompleted,
        totalFailed,
      })

      // Log progress every 10 attempts (10 seconds)
      if (attempts % 10 === 0) {
        console.log(`Progress: ${completedBatches}/${batchCount} batches completed, ${totalCompleted}/${totalItems} items processed`)
      }

      attempts++
    } while (!allCompleted && attempts < maxAttempts)

    const totalTime = Date.now() - startTime
    const processingTime = totalTime - jobCreationTime

    // Analyze final results
    const completedBatches = Object.values(jobStatuses).filter((s: any) => s.status === 'completed').length
    const failedBatches = Object.values(jobStatuses).filter((s: any) => s.status === 'failed').length
    const totalCompleted = Object.values(jobStatuses).reduce((sum: number, status: any) => sum + (status.completed || 0), 0)
    const totalFailed = Object.values(jobStatuses).reduce((sum: number, status: any) => sum + (status.failed || 0), 0)
    const successRate = (totalCompleted / totalItems) * 100
    const batchSuccessRate = (completedBatches / batchCount) * 100

    console.log(`\nConcurrent Batch Screenshots Performance Results:`)
    console.log(`- Total batches: ${batchCount}`)
    console.log(`- Items per batch: ${itemsPerBatch}`)
    console.log(`- Total items: ${totalItems}`)
    console.log(`- Job creation time: ${jobCreationTime}ms`)
    console.log(`- Processing time: ${processingTime}ms`)
    console.log(`- Total time: ${totalTime}ms`)
    console.log(`- Completed batches: ${completedBatches}/${batchCount} (${batchSuccessRate.toFixed(1)}%)`)
    console.log(`- Failed batches: ${failedBatches}`)
    console.log(`- Total completed items: ${totalCompleted}/${totalItems} (${successRate.toFixed(1)}%)`)
    console.log(`- Total failed items: ${totalFailed}`)
    console.log(`- Items per second: ${(totalCompleted / (processingTime / 1000)).toFixed(2)}`)
    console.log(`- Average time per batch: ${(processingTime / batchCount).toFixed(0)}ms`)

    // Performance assertions
    assert.isTrue(allCompleted, 'All batch jobs should complete within the timeout period')
    assert.isTrue(completedBatches >= batchCount * 0.8, 'At least 80% of batches should complete successfully')
    assert.isTrue(totalCompleted >= totalItems * 0.7, 'At least 70% of items should be processed successfully')
    assert.isTrue(totalTime < 300000, 'All concurrent batches should complete within 5 minutes')

    // Verify each completed batch processed the correct number of items
    Object.entries(jobStatuses).forEach(([jobId, status]: [string, any]) => {
      if (status.status === 'completed') {
        assert.equal(
          status.completed + status.failed,
          itemsPerBatch,
          `Batch ${jobId} should process exactly ${itemsPerBatch} items`
        )
      }
    })

    // Calculate throughput and efficiency metrics
    const throughput = (totalCompleted / (processingTime / 1000))
    const theoreticalMaxThroughput = batchCount * 2 // 2 parallel items per batch
    const efficiency = (throughput / theoreticalMaxThroughput) * 100

    console.log(`- Throughput: ${throughput.toFixed(2)} items/second`)
    console.log(`- Theoretical max: ${theoreticalMaxThroughput} items/second`)
    console.log(`- Efficiency: ${efficiency.toFixed(1)}%`)

    // Memory usage tracking
    if (process.memoryUsage) {
      const memUsage = process.memoryUsage()
      console.log(`- Memory usage: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`)
      console.log(`- RSS memory: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`)
    }

    // Log any failed batches for debugging
    const failedBatchStatuses = Object.entries(jobStatuses).filter(([_, status]: [string, any]) => status.status === 'failed')
    if (failedBatchStatuses.length > 0) {
      console.log(`\nFailed batch details:`)
      failedBatchStatuses.forEach(([jobId, status]: [string, any]) => {
        console.log(`- Batch ${jobId}: ${status.error || 'Unknown error'}`)
      })
    }
  }).timeout(360000) // 6 minute timeout

  test('concurrent batch screenshots with different parallelism levels', async ({ assert }) => {
    const batchCount = 5
    const itemsPerBatch = 3
    const parallelismLevels = [1, 2, 3]
    const results: Array<{
      parallelism: number
      processingTime: number
      successRate: number
      batchSuccessRate: number
    }> = []

    for (const parallelism of parallelismLevels) {
      console.log(`\nTesting parallelism level: ${parallelism}`)
      const startTime = Date.now()

      // Create concurrent batch requests with specific parallelism
      const batchPromises = Array.from({ length: batchCount }, (_, batchIndex) =>
        apiClient
          .post('/batch/screenshots')
          .header('X-API-Key', testApiKey.key)
          .json({
            items: Array.from({ length: itemsPerBatch }, (_, itemIndex) => ({
              id: `parallel-${parallelism}-batch-${batchIndex}-item-${itemIndex}`,
              url: `https://httpbin.org/delay/1?parallel=${parallelism}&batch=${batchIndex}&item=${itemIndex}`,
              format: 'png',
            })),
            config: {
              parallel: parallelism,
              cache: false,
              timeout: 20000,
            },
          })
      )

      const batchResponses = await Promise.all(batchPromises)
      const jobIds = batchResponses.map((r) => r.body().job_id)

      // Monitor until completion
      let allCompleted = false
      let attempts = 0
      const maxAttempts = 120

      do {
        await new Promise((resolve) => setTimeout(resolve, 2000))

        const statusPromises = jobIds.map((jobId) =>
          apiClient.get(`/batch/screenshots/${jobId}`).header('X-API-Key', testApiKey.key)
        )

        const statusResponses = await Promise.all(statusPromises)
        allCompleted = statusResponses.every((r) => {
          const status = r.body().status
          return status === 'completed' || status === 'failed'
        })

        attempts++
      } while (!allCompleted && attempts < maxAttempts)

      const processingTime = Date.now() - startTime

      // Calculate metrics
      const finalStatusPromises = jobIds.map((jobId) =>
        apiClient.get(`/batch/screenshots/${jobId}`).header('X-API-Key', testApiKey.key)
      )
      const finalStatusResponses = await Promise.all(finalStatusPromises)

      const completedBatches = finalStatusResponses.filter((r) => r.body().status === 'completed').length
      const totalCompleted = finalStatusResponses.reduce((sum, r) => sum + (r.body().completed || 0), 0)
      const totalItems = batchCount * itemsPerBatch

      const successRate = (totalCompleted / totalItems) * 100
      const batchSuccessRate = (completedBatches / batchCount) * 100

      results.push({
        parallelism,
        processingTime,
        successRate,
        batchSuccessRate,
      })

      console.log(`- Parallelism ${parallelism}: ${processingTime}ms, ${successRate.toFixed(1)}% item success, ${batchSuccessRate.toFixed(1)}% batch success`)
    }

    // Analyze parallelism efficiency
    console.log(`\nParallelism Performance Comparison:`)
    results.forEach((result) => {
      console.log(`- Level ${result.parallelism}: ${result.processingTime}ms (${result.successRate.toFixed(1)}% items, ${result.batchSuccessRate.toFixed(1)}% batches)`)
    })

    // Performance assertions
    results.forEach((result) => {
      assert.isTrue(result.successRate >= 60, `Parallelism ${result.parallelism} should have at least 60% item success rate`)
      assert.isTrue(result.batchSuccessRate >= 60, `Parallelism ${result.parallelism} should have at least 60% batch success rate`)
    })

    // Higher parallelism should generally be faster for this workload
    const serialTime = results.find((r) => r.parallelism === 1)?.processingTime || 0
    const parallelTime = results.find((r) => r.parallelism === 3)?.processingTime || 0

    if (serialTime > 0 && parallelTime > 0) {
      const speedup = serialTime / parallelTime
      console.log(`- Speedup from parallelism 1 to 3: ${speedup.toFixed(2)}x`)
      // Note: Speedup may be limited by external service response times
    }
  }).timeout(480000) // 8 minute timeout
})
