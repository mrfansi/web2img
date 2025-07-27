import { test } from '@japa/runner'
import { ApiClient } from '@japa/api-client'
import ApiKey from '#models/api_key'
import User from '#models/user'
import { cleanupRedisConnections } from '#tests/utils/redis_test_utils'

test.group('Batch Processing - Performance Tests', (group) => {
  let apiClient: ApiClient
  let testUser: User
  let testApiKey: ApiKey

  group.setup(async () => {
    apiClient = new ApiClient()
    
    // Create test user
    testUser = await User.create({
      email: 'batch-perf-test@example.com',
      password: 'password123'
    })
    
    // Create test API key with high rate limit
    testApiKey = await ApiKey.create({
      key: 'batch-perf-test-api-key-123',
      name: 'Batch Performance Test Key',
      userId: testUser.id,
      rateLimit: 10000,
      isActive: true
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

  test('small batch processing performance - 10 items', async ({ assert }) => {
    const itemCount = 10
    const startTime = Date.now()
    
    // Create batch job
    const batchResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: Array.from({ length: itemCount }, (_, i) => ({
          id: `small-batch-${i}`,
          url: `https://httpbin.org/html?item=${i}`,
          format: 'png'
        })),
        config: {
          parallel: 3,
          cache: false
        }
      })

    batchResponse.assertStatus(202)
    const jobId = batchResponse.body().job_id
    const jobCreationTime = Date.now() - startTime
    
    // Monitor processing
    let finalStatus: any
    let attempts = 0
    const maxAttempts = 60
    const statusHistory: Array<{
      timestamp: number
      status: string
      completed: number
      failed: number
    }> = []
    
    do {
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const statusResponse = await apiClient
        .get(`/batch/screenshots/${jobId}`)
        .header('X-API-Key', testApiKey.key)
      
      finalStatus = statusResponse.body()
      statusHistory.push({
        timestamp: Date.now(),
        status: finalStatus.status,
        completed: finalStatus.completed,
        failed: finalStatus.failed
      })
      
      attempts++
    } while (
      finalStatus.status !== 'completed' && 
      finalStatus.status !== 'failed' && 
      attempts < maxAttempts
    )
    
    const totalTime = Date.now() - startTime
    const processingTime = totalTime - jobCreationTime
    
    console.log(`Small Batch Performance (${itemCount} items):`)
    console.log(`- Job creation time: ${jobCreationTime}ms`)
    console.log(`- Processing time: ${processingTime}ms`)
    console.log(`- Total time: ${totalTime}ms`)
    console.log(`- Items per second: ${(itemCount / (processingTime / 1000)).toFixed(2)}`)
    console.log(`- Final status: ${finalStatus.status}`)
    console.log(`- Completed: ${finalStatus.completed}`)
    console.log(`- Failed: ${finalStatus.failed}`)
    
    // Performance assertions
    assert.equal(finalStatus.status, 'completed')
    assert.equal(finalStatus.completed + finalStatus.failed, itemCount)
    assert.isTrue(totalTime < 60000, 'Small batch should complete within 60 seconds')
    assert.isTrue(finalStatus.completed >= itemCount * 0.8, 'At least 80% should succeed')
    
    // Analyze processing progression
    const progressionRate = analyzeProgressionRate(statusHistory)
    console.log(`- Average progression rate: ${progressionRate.toFixed(2)} items/second`)
  }).timeout(120000)

  test('medium batch processing performance - 50 items', async ({ assert }) => {
    const itemCount = 50
    const startTime = Date.now()
    
    // Create batch job with higher parallelism
    const batchResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: Array.from({ length: itemCount }, (_, i) => ({
          id: `medium-batch-${i}`,
          url: `https://example.com?batch=medium&item=${i}`,
          format: i % 2 === 0 ? 'png' : 'jpeg',
          width: 1280,
          height: 720
        })),
        config: {
          parallel: 5, // Higher parallelism
          cache: false,
          timeout: 30000
        }
      })

    batchResponse.assertStatus(202)
    const jobId = batchResponse.body().job_id
    const jobCreationTime = Date.now() - startTime
    
    // Monitor with more detailed tracking
    let finalStatus: any
    let attempts = 0
    const maxAttempts = 120
    const statusHistory: Array<{
      timestamp: number
      status: string
      completed: number
      failed: number
      progressPercentage: number
    }> = []
    
    do {
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const statusResponse = await apiClient
        .get(`/batch/screenshots/${jobId}`)
        .header('X-API-Key', testApiKey.key)
      
      finalStatus = statusResponse.body()
      statusHistory.push({
        timestamp: Date.now(),
        status: finalStatus.status,
        completed: finalStatus.completed,
        failed: finalStatus.failed,
        progressPercentage: finalStatus.progress_percentage || 0
      })
      
      attempts++
    } while (
      finalStatus.status !== 'completed' && 
      finalStatus.status !== 'failed' && 
      attempts < maxAttempts
    )
    
    const totalTime = Date.now() - startTime
    const processingTime = totalTime - jobCreationTime
    
    console.log(`Medium Batch Performance (${itemCount} items):`)
    console.log(`- Job creation time: ${jobCreationTime}ms`)
    console.log(`- Processing time: ${processingTime}ms`)
    console.log(`- Total time: ${totalTime}ms`)
    console.log(`- Items per second: ${(itemCount / (processingTime / 1000)).toFixed(2)}`)
    console.log(`- Final status: ${finalStatus.status}`)
    console.log(`- Completed: ${finalStatus.completed}`)
    console.log(`- Failed: ${finalStatus.failed}`)
    console.log(`- Success rate: ${(finalStatus.completed / itemCount * 100).toFixed(1)}%`)
    
    // Performance assertions
    assert.isTrue(['completed', 'failed'].includes(finalStatus.status))
    assert.equal(finalStatus.completed + finalStatus.failed, itemCount)
    assert.isTrue(totalTime < 180000, 'Medium batch should complete within 3 minutes')
    assert.isTrue(finalStatus.completed >= itemCount * 0.7, 'At least 70% should succeed')
    
    // Analyze parallel processing efficiency
    const theoreticalMinTime = (itemCount / 5) * 5000 // Assuming 5 seconds per item with 5 parallel
    const efficiency = (theoreticalMinTime / processingTime) * 100
    console.log(`- Parallel processing efficiency: ${efficiency.toFixed(1)}%`)
    
    // Memory usage tracking
    if (process.memoryUsage) {
      const memUsage = process.memoryUsage()
      console.log(`- Memory usage: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`)
    }
  }).timeout(240000)

  test('large batch processing performance - 100 items', async ({ assert }) => {
    const itemCount = 100
    const startTime = Date.now()
    
    // Create large batch job
    const batchResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: Array.from({ length: itemCount }, (_, i) => ({
          id: `large-batch-${i}`,
          url: `https://httpbin.org/delay/${Math.floor(Math.random() * 2)}?item=${i}`, // 0-1 second delay
          format: ['png', 'jpeg', 'webp'][i % 3],
          width: [1280, 1920, 800][i % 3],
          height: [720, 1080, 600][i % 3]
        })),
        config: {
          parallel: 8, // High parallelism
          cache: false,
          timeout: 20000,
          fail_fast: false
        }
      })

    batchResponse.assertStatus(202)
    const jobId = batchResponse.body().job_id
    const jobCreationTime = Date.now() - startTime
    
    // Monitor with performance tracking
    let finalStatus: any
    let attempts = 0
    const maxAttempts = 300 // 5 minutes
    const statusHistory: Array<{
      timestamp: number
      status: string
      completed: number
      failed: number
      progressPercentage: number
    }> = []
    
    let lastLogTime = Date.now()
    
    do {
      await new Promise(resolve => setTimeout(resolve, 2000)) // Check every 2 seconds
      
      const statusResponse = await apiClient
        .get(`/batch/screenshots/${jobId}`)
        .header('X-API-Key', testApiKey.key)
      
      finalStatus = statusResponse.body()
      statusHistory.push({
        timestamp: Date.now(),
        status: finalStatus.status,
        completed: finalStatus.completed,
        failed: finalStatus.failed,
        progressPercentage: finalStatus.progress_percentage || 0
      })
      
      // Log progress every 30 seconds
      if (Date.now() - lastLogTime > 30000) {
        console.log(`Progress: ${finalStatus.completed}/${itemCount} completed (${finalStatus.progress_percentage?.toFixed(1)}%)`)
        lastLogTime = Date.now()
      }
      
      attempts++
    } while (
      finalStatus.status !== 'completed' && 
      finalStatus.status !== 'failed' && 
      attempts < maxAttempts
    )
    
    const totalTime = Date.now() - startTime
    const processingTime = totalTime - jobCreationTime
    
    console.log(`Large Batch Performance (${itemCount} items):`)
    console.log(`- Job creation time: ${jobCreationTime}ms`)
    console.log(`- Processing time: ${processingTime}ms`)
    console.log(`- Total time: ${totalTime}ms`)
    console.log(`- Items per second: ${(itemCount / (processingTime / 1000)).toFixed(2)}`)
    console.log(`- Final status: ${finalStatus.status}`)
    console.log(`- Completed: ${finalStatus.completed}`)
    console.log(`- Failed: ${finalStatus.failed}`)
    console.log(`- Success rate: ${(finalStatus.completed / itemCount * 100).toFixed(1)}%`)
    
    // Performance assertions - more lenient for large batches
    assert.isTrue(['completed', 'failed'].includes(finalStatus.status))
    assert.equal(finalStatus.completed + finalStatus.failed, itemCount)
    assert.isTrue(totalTime < 600000, 'Large batch should complete within 10 minutes')
    assert.isTrue(finalStatus.completed >= itemCount * 0.6, 'At least 60% should succeed')
    
    // Analyze processing patterns
    const processingRate = analyzeProcessingRate(statusHistory)
    console.log(`- Average processing rate: ${processingRate.toFixed(2)} items/second`)
    
    // Resource usage
    if (process.memoryUsage) {
      const memUsage = process.memoryUsage()
      console.log(`- Peak memory usage: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`)
      console.log(`- RSS memory: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`)
    }
  }).timeout(720000) // 12 minute timeout

  test('concurrent batch jobs performance', async ({ assert }) => {
    const batchCount = 5
    const itemsPerBatch = 10
    const startTime = Date.now()
    
    // Create multiple concurrent batch jobs
    const batchPromises = Array.from({ length: batchCount }, (_, batchIndex) =>
      apiClient
        .post('/batch/screenshots')
        .header('X-API-Key', testApiKey.key)
        .json({
          items: Array.from({ length: itemsPerBatch }, (_, itemIndex) => ({
            id: `concurrent-batch-${batchIndex}-item-${itemIndex}`,
            url: `https://example.com?batch=${batchIndex}&item=${itemIndex}`,
            format: 'png'
          })),
          config: {
            parallel: 2,
            cache: false
          }
        })
    )
    
    const batchResponses = await Promise.all(batchPromises)
    const jobCreationTime = Date.now() - startTime
    
    // Verify all batches were created
    batchResponses.forEach(response => {
      response.assertStatus(202)
    })
    
    const jobIds = batchResponses.map(r => r.body().job_id)
    console.log(`Created ${batchCount} concurrent batch jobs in ${jobCreationTime}ms`)
    
    // Monitor all jobs concurrently
    const jobStatuses: Record<string, any> = {}
    let allCompleted = false
    let attempts = 0
    const maxAttempts = 120
    
    do {
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      // Check status of all jobs
      const statusPromises = jobIds.map(jobId =>
        apiClient
          .get(`/batch/screenshots/${jobId}`)
          .header('X-API-Key', testApiKey.key)
      )
      
      const statusResponses = await Promise.all(statusPromises)
      
      allCompleted = true
      statusResponses.forEach((response, index) => {
        const status = response.body()
        jobStatuses[jobIds[index]] = status
        
        if (status.status !== 'completed' && status.status !== 'failed') {
          allCompleted = false
        }
      })
      
      attempts++
    } while (!allCompleted && attempts < maxAttempts)
    
    const totalTime = Date.now() - startTime
    const processingTime = totalTime - jobCreationTime
    
    // Analyze concurrent performance
    const totalItems = batchCount * itemsPerBatch
    const totalCompleted = Object.values(jobStatuses).reduce((sum: number, status: any) => sum + status.completed, 0)
    const totalFailed = Object.values(jobStatuses).reduce((sum: number, status: any) => sum + status.failed, 0)
    
    console.log(`Concurrent Batch Performance:`)
    console.log(`- Batch count: ${batchCount}`)
    console.log(`- Items per batch: ${itemsPerBatch}`)
    console.log(`- Total items: ${totalItems}`)
    console.log(`- Job creation time: ${jobCreationTime}ms`)
    console.log(`- Processing time: ${processingTime}ms`)
    console.log(`- Total time: ${totalTime}ms`)
    console.log(`- Total completed: ${totalCompleted}`)
    console.log(`- Total failed: ${totalFailed}`)
    console.log(`- Overall success rate: ${(totalCompleted / totalItems * 100).toFixed(1)}%`)
    console.log(`- Items per second: ${(totalItems / (processingTime / 1000)).toFixed(2)}`)
    
    // Performance assertions
    assert.isTrue(totalCompleted >= totalItems * 0.7, 'At least 70% of all items should succeed')
    assert.isTrue(totalTime < 300000, 'All concurrent batches should complete within 5 minutes')
    
    // Verify all jobs completed
    Object.values(jobStatuses).forEach((status: any) => {
      assert.isTrue(['completed', 'failed'].includes(status.status))
    })
  }).timeout(360000)

  test('batch processing with different parallelism levels', async ({ assert }) => {
    const itemCount = 20
    const parallelismLevels = [1, 3, 5, 10]
    const results: Array<{
      parallelism: number
      processingTime: number
      successRate: number
      itemsPerSecond: number
    }> = []
    
    for (const parallelism of parallelismLevels) {
      console.log(`Testing parallelism level: ${parallelism}`)
      const startTime = Date.now()
      
      const batchResponse = await apiClient
        .post('/batch/screenshots')
        .header('X-API-Key', testApiKey.key)
        .json({
          items: Array.from({ length: itemCount }, (_, i) => ({
            id: `parallel-${parallelism}-item-${i}`,
            url: `https://httpbin.org/delay/1?parallel=${parallelism}&item=${i}`, // 1 second delay
            format: 'png'
          })),
          config: {
            parallel: parallelism,
            cache: false,
            timeout: 15000
          }
        })

      batchResponse.assertStatus(202)
      const jobId = batchResponse.body().job_id
      
      // Wait for completion
      let finalStatus: any
      let attempts = 0
      const maxAttempts = 120
      
      do {
        await new Promise(resolve => setTimeout(resolve, 2000))
        
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
      
      const processingTime = Date.now() - startTime
      const successRate = (finalStatus.completed / itemCount) * 100
      const itemsPerSecond = itemCount / (processingTime / 1000)
      
      results.push({
        parallelism,
        processingTime,
        successRate,
        itemsPerSecond
      })
      
      console.log(`- Parallelism ${parallelism}: ${processingTime}ms, ${successRate.toFixed(1)}% success, ${itemsPerSecond.toFixed(2)} items/sec`)
    }
    
    // Analyze parallelism efficiency
    console.log(`Parallelism Performance Comparison:`)
    results.forEach(result => {
      console.log(`- Level ${result.parallelism}: ${result.processingTime}ms (${result.itemsPerSecond.toFixed(2)} items/sec, ${result.successRate.toFixed(1)}% success)`)
    })
    
    // Performance assertions
    results.forEach(result => {
      assert.isTrue(result.successRate >= 70, `Parallelism ${result.parallelism} should have at least 70% success rate`)
    })
    
    // Higher parallelism should generally be faster (up to a point)
    const serialTime = results.find(r => r.parallelism === 1)?.processingTime || 0
    const parallelTime = results.find(r => r.parallelism === 5)?.processingTime || 0
    
    if (serialTime > 0 && parallelTime > 0) {
      const speedup = serialTime / parallelTime
      console.log(`- Speedup from parallelism 1 to 5: ${speedup.toFixed(2)}x`)
      assert.isTrue(speedup > 1.5, 'Parallelism should provide significant speedup')
    }
  }).timeout(600000)
})

// Helper functions
function analyzeProgressionRate(statusHistory: Array<{ timestamp: number; completed: number }>): number {
  if (statusHistory.length < 2) return 0
  
  const start = statusHistory[0]
  const end = statusHistory[statusHistory.length - 1]
  const timeDiff = (end.timestamp - start.timestamp) / 1000 // seconds
  const itemsDiff = end.completed - start.completed
  
  return itemsDiff / timeDiff
}

function analyzeProcessingRate(statusHistory: Array<{ timestamp: number; completed: number; failed: number }>): number {
  if (statusHistory.length < 2) return 0
  
  const rates: number[] = []
  
  for (let i = 1; i < statusHistory.length; i++) {
    const prev = statusHistory[i - 1]
    const curr = statusHistory[i]
    
    const timeDiff = (curr.timestamp - prev.timestamp) / 1000
    const itemsDiff = (curr.completed + curr.failed) - (prev.completed + prev.failed)
    
    if (timeDiff > 0) {
      rates.push(itemsDiff / timeDiff)
    }
  }
  
  return rates.length > 0 ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : 0
}