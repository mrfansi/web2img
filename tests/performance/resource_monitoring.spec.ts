import { test } from '@japa/runner'
import { ApiClient } from '@japa/api-client'
import ApiKey from '#models/api_key'
import User from '#models/user'
import { cleanupRedisConnections } from '#tests/utils/redis_test_utils'

interface ResourceSnapshot {
  timestamp: number
  memory: {
    heapUsed: number
    heapTotal: number
    rss: number
    external: number
  }
  cpu?: {
    user: number
    system: number
  }
}

test.group('Resource Monitoring - Performance Tests', (group) => {
  let apiClient: ApiClient
  let testUser: User
  let testApiKey: ApiKey
  let resourceSnapshots: ResourceSnapshot[] = []
  let monitoringInterval: NodeJS.Timeout | null = null

  group.setup(async () => {
    apiClient = new ApiClient()
    
    // Create test user
    testUser = await User.create({
      email: 'resource-test@example.com',
      password: 'password123'
    })
    
    // Create test API key
    testApiKey = await ApiKey.create({
      key: 'resource-test-api-key-123',
      name: 'Resource Test Key',
      userId: testUser.id,
      rateLimit: 10000,
      isActive: true
    })
  })

  group.teardown(async () => {
    // Stop monitoring
    if (monitoringInterval) {
      clearInterval(monitoringInterval)
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

  group.each.setup(() => {
    // Reset snapshots for each test
    resourceSnapshots = []
  })

  group.each.teardown(() => {
    // Stop monitoring after each test
    if (monitoringInterval) {
      clearInterval(monitoringInterval)
      monitoringInterval = null
    }
  })

  function startResourceMonitoring(intervalMs: number = 1000) {
    monitoringInterval = setInterval(() => {
      const memUsage = process.memoryUsage()
      const cpuUsage = process.cpuUsage()
      
      resourceSnapshots.push({
        timestamp: Date.now(),
        memory: {
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          rss: memUsage.rss,
          external: memUsage.external
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system
        }
      })
    }, intervalMs)
  }

  function analyzeResourceUsage() {
    if (resourceSnapshots.length === 0) return null
    
    const memoryStats = {
      heapUsed: {
        min: Math.min(...resourceSnapshots.map(s => s.memory.heapUsed)),
        max: Math.max(...resourceSnapshots.map(s => s.memory.heapUsed)),
        avg: resourceSnapshots.reduce((sum, s) => sum + s.memory.heapUsed, 0) / resourceSnapshots.length
      },
      heapTotal: {
        min: Math.min(...resourceSnapshots.map(s => s.memory.heapTotal)),
        max: Math.max(...resourceSnapshots.map(s => s.memory.heapTotal)),
        avg: resourceSnapshots.reduce((sum, s) => sum + s.memory.heapTotal, 0) / resourceSnapshots.length
      },
      rss: {
        min: Math.min(...resourceSnapshots.map(s => s.memory.rss)),
        max: Math.max(...resourceSnapshots.map(s => s.memory.rss)),
        avg: resourceSnapshots.reduce((sum, s) => sum + s.memory.rss, 0) / resourceSnapshots.length
      }
    }
    
    return {
      memory: memoryStats,
      snapshots: resourceSnapshots.length,
      duration: resourceSnapshots.length > 1 
        ? resourceSnapshots[resourceSnapshots.length - 1].timestamp - resourceSnapshots[0].timestamp
        : 0
    }
  }

  function formatBytes(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB'
  }

  test('memory usage during single screenshot processing', async ({ assert }) => {
    startResourceMonitoring(500) // Monitor every 500ms
    
    const initialMemory = process.memoryUsage()
    console.log(`Initial memory usage: ${formatBytes(initialMemory.heapUsed)}`)
    
    // Process multiple single screenshots to observe memory patterns
    const requestCount = 20
    const responses = []
    
    for (let i = 0; i < requestCount; i++) {
      const response = await apiClient
        .post('/screenshot')
        .header('X-API-Key', testApiKey.key)
        .json({
          url: `https://example.com?memory-test=${i}`,
          format: 'png',
          cache: false
        })
      
      responses.push(response)
      
      // Small delay between requests to observe memory patterns
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    // Wait a bit more to capture post-processing memory
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    const finalMemory = process.memoryUsage()
    const resourceAnalysis = analyzeResourceUsage()
    
    console.log(`Single Screenshot Memory Analysis:`)
    console.log(`- Requests processed: ${requestCount}`)
    console.log(`- Initial heap: ${formatBytes(initialMemory.heapUsed)}`)
    console.log(`- Final heap: ${formatBytes(finalMemory.heapUsed)}`)
    console.log(`- Memory delta: ${formatBytes(finalMemory.heapUsed - initialMemory.heapUsed)}`)
    
    if (resourceAnalysis) {
      console.log(`- Peak heap usage: ${formatBytes(resourceAnalysis.memory.heapUsed.max)}`)
      console.log(`- Average heap usage: ${formatBytes(resourceAnalysis.memory.heapUsed.avg)}`)
      console.log(`- Peak RSS: ${formatBytes(resourceAnalysis.memory.rss.max)}`)
      console.log(`- Monitoring duration: ${resourceAnalysis.duration}ms`)
    }
    
    // Memory assertions
    const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed
    const memoryPerRequest = memoryIncrease / requestCount
    
    console.log(`- Memory per request: ${formatBytes(memoryPerRequest)}`)
    
    // Should not have excessive memory growth
    assert.isTrue(memoryPerRequest < 10 * 1024 * 1024, 'Memory per request should be < 10MB')
    assert.isTrue(finalMemory.heapUsed < 500 * 1024 * 1024, 'Total heap should stay < 500MB')
    
    // Verify all requests succeeded
    const successfulResponses = responses.filter(r => r.response.status === 200)
    assert.equal(successfulResponses.length, requestCount)
  }).timeout(60000)

  test('memory usage during batch processing', async ({ assert }) => {
    startResourceMonitoring(1000) // Monitor every second
    
    const initialMemory = process.memoryUsage()
    const itemCount = 30
    
    console.log(`Starting batch processing test with ${itemCount} items`)
    console.log(`Initial memory: ${formatBytes(initialMemory.heapUsed)}`)
    
    // Create batch job
    const batchResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: Array.from({ length: itemCount }, (_, i) => ({
          id: `memory-batch-${i}`,
          url: `https://httpbin.org/html?batch-memory=${i}`,
          format: 'png'
        })),
        config: {
          parallel: 5,
          cache: false
        }
      })

    batchResponse.assertStatus(202)
    const jobId = batchResponse.body().job_id
    
    // Monitor batch processing
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
      
      // Log progress with memory usage
      if (attempts % 10 === 0) {
        const currentMemory = process.memoryUsage()
        console.log(`Progress: ${finalStatus.completed}/${itemCount}, Memory: ${formatBytes(currentMemory.heapUsed)}`)
      }
    } while (
      finalStatus.status !== 'completed' && 
      finalStatus.status !== 'failed' && 
      attempts < maxAttempts
    )
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    const finalMemory = process.memoryUsage()
    const resourceAnalysis = analyzeResourceUsage()
    
    console.log(`Batch Processing Memory Analysis:`)
    console.log(`- Items processed: ${finalStatus.completed}`)
    console.log(`- Items failed: ${finalStatus.failed}`)
    console.log(`- Initial heap: ${formatBytes(initialMemory.heapUsed)}`)
    console.log(`- Final heap: ${formatBytes(finalMemory.heapUsed)}`)
    console.log(`- Memory delta: ${formatBytes(finalMemory.heapUsed - initialMemory.heapUsed)}`)
    
    if (resourceAnalysis) {
      console.log(`- Peak heap usage: ${formatBytes(resourceAnalysis.memory.heapUsed.max)}`)
      console.log(`- Average heap usage: ${formatBytes(resourceAnalysis.memory.heapUsed.avg)}`)
      console.log(`- Peak RSS: ${formatBytes(resourceAnalysis.memory.rss.max)}`)
      
      // Calculate memory efficiency
      const memoryPerItem = (resourceAnalysis.memory.heapUsed.max - initialMemory.heapUsed) / itemCount
      console.log(`- Memory per item (peak): ${formatBytes(memoryPerItem)}`)
    }
    
    // Memory assertions
    assert.equal(finalStatus.status, 'completed')
    assert.isTrue(finalMemory.heapUsed < 1024 * 1024 * 1024, 'Heap should stay under 1GB')
    
    // Memory should not grow excessively per item
    const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed
    const memoryPerProcessedItem = memoryGrowth / finalStatus.completed
    assert.isTrue(memoryPerProcessedItem < 20 * 1024 * 1024, 'Memory per processed item should be < 20MB')
  }).timeout(180000)

  test('memory leak detection during sustained load', async ({ assert }) => {
    startResourceMonitoring(2000) // Monitor every 2 seconds
    
    const initialMemory = process.memoryUsage()
    const rounds = 5
    const requestsPerRound = 10
    
    console.log(`Memory leak detection test: ${rounds} rounds of ${requestsPerRound} requests`)
    console.log(`Initial memory: ${formatBytes(initialMemory.heapUsed)}`)
    
    const roundMemories: number[] = []
    
    for (let round = 0; round < rounds; round++) {
      console.log(`Starting round ${round + 1}/${rounds}`)
      
      // Process requests in this round
      const roundPromises = Array.from({ length: requestsPerRound }, (_, i) =>
        apiClient
          .post('/screenshot')
          .header('X-API-Key', testApiKey.key)
          .json({
            url: `https://example.com?leak-test=round${round}-req${i}`,
            format: 'png',
            cache: false
          })
      )
      
      await Promise.all(roundPromises)
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc()
      }
      
      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      const roundMemory = process.memoryUsage()
      roundMemories.push(roundMemory.heapUsed)
      
      console.log(`Round ${round + 1} completed, Memory: ${formatBytes(roundMemory.heapUsed)}`)
    }
    
    const finalMemory = process.memoryUsage()
    const resourceAnalysis = analyzeResourceUsage()
    
    console.log(`Memory Leak Detection Results:`)
    console.log(`- Total requests: ${rounds * requestsPerRound}`)
    console.log(`- Initial memory: ${formatBytes(initialMemory.heapUsed)}`)
    console.log(`- Final memory: ${formatBytes(finalMemory.heapUsed)}`)
    console.log(`- Total growth: ${formatBytes(finalMemory.heapUsed - initialMemory.heapUsed)}`)
    
    // Analyze memory growth trend
    const memoryGrowthPerRound = roundMemories.map((mem, i) => 
      i === 0 ? 0 : mem - roundMemories[i - 1]
    ).slice(1) // Remove first element (0)
    
    const avgGrowthPerRound = memoryGrowthPerRound.reduce((sum, growth) => sum + growth, 0) / memoryGrowthPerRound.length
    console.log(`- Average memory growth per round: ${formatBytes(avgGrowthPerRound)}`)
    
    // Check for consistent memory growth (potential leak)
    const positiveGrowthRounds = memoryGrowthPerRound.filter(growth => growth > 5 * 1024 * 1024).length // > 5MB growth
    const leakSuspicion = positiveGrowthRounds / memoryGrowthPerRound.length
    
    console.log(`- Rounds with significant growth: ${positiveGrowthRounds}/${memoryGrowthPerRound.length}`)
    console.log(`- Leak suspicion ratio: ${(leakSuspicion * 100).toFixed(1)}%`)
    
    if (resourceAnalysis) {
      console.log(`- Peak memory: ${formatBytes(resourceAnalysis.memory.heapUsed.max)}`)
      console.log(`- Average memory: ${formatBytes(resourceAnalysis.memory.heapUsed.avg)}`)
    }
    
    // Memory leak assertions
    assert.isTrue(avgGrowthPerRound < 50 * 1024 * 1024, 'Average memory growth per round should be < 50MB')
    assert.isTrue(leakSuspicion < 0.8, 'Less than 80% of rounds should show significant memory growth')
    assert.isTrue(finalMemory.heapUsed < 800 * 1024 * 1024, 'Final memory should be < 800MB')
    
    // Memory should stabilize (last round shouldn't grow much more than average)
    const lastRoundGrowth = memoryGrowthPerRound[memoryGrowthPerRound.length - 1]
    assert.isTrue(lastRoundGrowth < avgGrowthPerRound * 2, 'Last round growth should not be excessive')
  }).timeout(300000)

  test('cache performance and memory efficiency', async ({ assert }) => {
    startResourceMonitoring(1000)
    
    const initialMemory = process.memoryUsage()
    const cacheableUrls = [
      'https://example.com/cache1',
      'https://example.com/cache2',
      'https://example.com/cache3'
    ]
    
    console.log(`Cache performance test with ${cacheableUrls.length} cacheable URLs`)
    console.log(`Initial memory: ${formatBytes(initialMemory.heapUsed)}`)
    
    // First round: populate cache
    console.log('Populating cache...')
    const populatePromises = cacheableUrls.map(url =>
      apiClient
        .post('/screenshot')
        .header('X-API-Key', testApiKey.key)
        .json({
          url,
          format: 'png',
          cache: true
        })
    )
    
    const populateResponses = await Promise.all(populatePromises)
    const afterPopulateMemory = process.memoryUsage()
    
    // Verify cache population
    populateResponses.forEach(response => {
      response.assertStatus(200)
      assert.equal(response.body().cached, false)
    })
    
    console.log(`Cache populated, Memory: ${formatBytes(afterPopulateMemory.heapUsed)}`)
    
    // Second round: test cache hits
    console.log('Testing cache hits...')
    const cacheTestPromises = Array.from({ length: 20 }, (_, i) => {
      const url = cacheableUrls[i % cacheableUrls.length]
      return apiClient
        .post('/screenshot')
        .header('X-API-Key', testApiKey.key)
        .json({
          url,
          format: 'png',
          cache: true
        })
    })
    
    const cacheTestResponses = await Promise.all(cacheTestPromises)
    const afterCacheTestMemory = process.memoryUsage()
    
    // Analyze cache performance
    const cacheHits = cacheTestResponses.filter(r => r.body().cached === true).length
    const cacheMisses = cacheTestResponses.filter(r => r.body().cached === false).length
    const cacheHitRate = (cacheHits / cacheTestResponses.length) * 100
    
    console.log(`Cache Performance Results:`)
    console.log(`- Cache hits: ${cacheHits}`)
    console.log(`- Cache misses: ${cacheMisses}`)
    console.log(`- Cache hit rate: ${cacheHitRate.toFixed(1)}%`)
    console.log(`- Memory after populate: ${formatBytes(afterPopulateMemory.heapUsed)}`)
    console.log(`- Memory after cache test: ${formatBytes(afterCacheTestMemory.heapUsed)}`)
    
    const resourceAnalysis = analyzeResourceUsage()
    if (resourceAnalysis) {
      console.log(`- Peak memory: ${formatBytes(resourceAnalysis.memory.heapUsed.max)}`)
      console.log(`- Average memory: ${formatBytes(resourceAnalysis.memory.heapUsed.avg)}`)
    }
    
    // Cache performance assertions
    assert.isTrue(cacheHitRate >= 80, 'Cache hit rate should be at least 80%')
    
    // Memory efficiency assertions
    const cacheMemoryOverhead = afterPopulateMemory.heapUsed - initialMemory.heapUsed
    const memoryPerCacheEntry = cacheMemoryOverhead / cacheableUrls.length
    console.log(`- Memory per cache entry: ${formatBytes(memoryPerCacheEntry)}`)
    
    // Cache testing should not significantly increase memory
    const cacheTestMemoryIncrease = afterCacheTestMemory.heapUsed - afterPopulateMemory.heapUsed
    console.log(`- Memory increase from cache testing: ${formatBytes(cacheTestMemoryIncrease)}`)
    assert.isTrue(cacheTestMemoryIncrease < 50 * 1024 * 1024, 'Cache testing should not increase memory by more than 50MB')
  }).timeout(120000)

  test('resource usage under concurrent load', async ({ assert }) => {
    startResourceMonitoring(500) // High frequency monitoring
    
    const initialMemory = process.memoryUsage()
    const concurrency = 15
    
    console.log(`Concurrent load test: ${concurrency} simultaneous requests`)
    console.log(`Initial memory: ${formatBytes(initialMemory.heapUsed)}`)
    
    const startTime = Date.now()
    
    // Create concurrent load
    const concurrentPromises = Array.from({ length: concurrency }, (_, i) =>
      apiClient
        .post('/screenshot')
        .header('X-API-Key', testApiKey.key)
        .json({
          url: `https://httpbin.org/delay/2?concurrent=${i}`, // 2 second delay
          format: 'png',
          cache: false
        })
    )
    
    const responses = await Promise.all(concurrentPromises)
    const endTime = Date.now()
    const finalMemory = process.memoryUsage()
    
    const successfulResponses = responses.filter(r => r.response.status === 200)
    const totalTime = endTime - startTime
    
    console.log(`Concurrent Load Results:`)
    console.log(`- Concurrency: ${concurrency}`)
    console.log(`- Successful requests: ${successfulResponses.length}`)
    console.log(`- Total time: ${totalTime}ms`)
    console.log(`- Initial memory: ${formatBytes(initialMemory.heapUsed)}`)
    console.log(`- Final memory: ${formatBytes(finalMemory.heapUsed)}`)
    console.log(`- Memory increase: ${formatBytes(finalMemory.heapUsed - initialMemory.heapUsed)}`)
    
    const resourceAnalysis = analyzeResourceUsage()
    if (resourceAnalysis) {
      console.log(`- Peak memory: ${formatBytes(resourceAnalysis.memory.heapUsed.max)}`)
      console.log(`- Average memory: ${formatBytes(resourceAnalysis.memory.heapUsed.avg)}`)
      console.log(`- Peak RSS: ${formatBytes(resourceAnalysis.memory.rss.max)}`)
      
      // Calculate memory efficiency under load
      const peakMemoryIncrease = resourceAnalysis.memory.heapUsed.max - initialMemory.heapUsed
      const memoryPerConcurrentRequest = peakMemoryIncrease / concurrency
      console.log(`- Memory per concurrent request: ${formatBytes(memoryPerConcurrentRequest)}`)
    }
    
    // Performance assertions
    assert.isTrue(successfulResponses.length >= concurrency * 0.8, 'At least 80% should succeed')
    assert.isTrue(finalMemory.heapUsed < 1024 * 1024 * 1024, 'Memory should stay under 1GB')
    
    // Memory should not grow excessively under concurrent load
    const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed
    const memoryPerRequest = memoryIncrease / successfulResponses.length
    assert.isTrue(memoryPerRequest < 30 * 1024 * 1024, 'Memory per request should be < 30MB under concurrent load')
  }).timeout(120000)
})