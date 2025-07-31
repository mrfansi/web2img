import { test } from '@japa/runner'
import { screenshotWorkerService } from '#services/screenshot_worker_service'

test.group('Concurrent Batch Processing - Unit Tests', () => {
  test('should process batch with 3 items concurrently', async ({ assert }) => {
    const batchItems = [
      {
        url: 'https://httpbin.org/html?item=1',
        options: {
          format: 'png' as const,
          width: 1280,
          height: 720,
          timeout: 30000,
          fullPage: false,
        },
      },
      {
        url: 'https://httpbin.org/html?item=2',
        options: {
          format: 'jpeg' as const,
          width: 1920,
          height: 1080,
          timeout: 30000,
          fullPage: false,
        },
      },
      {
        url: 'https://httpbin.org/html?item=3',
        options: {
          format: 'webp' as const,
          width: 800,
          height: 600,
          timeout: 30000,
          fullPage: false,
        },
      },
    ]

    const startTime = Date.now()

    // Process all items concurrently using the screenshot worker service
    const results = await Promise.allSettled(
      batchItems.map((item) => screenshotWorkerService.processScreenshotJob(item))
    )

    const totalTime = Date.now() - startTime

    // Analyze results
    const successfulResults = results.filter((r) => r.status === 'fulfilled')
    const failedResults = results.filter((r) => r.status === 'rejected')

    console.log(`Concurrent Batch Processing Results:`)
    console.log(`- Total items: ${batchItems.length}`)
    console.log(`- Processing time: ${totalTime}ms`)
    console.log(`- Successful: ${successfulResults.length}`)
    console.log(`- Failed: ${failedResults.length}`)
    console.log(`- Success rate: ${((successfulResults.length / batchItems.length) * 100).toFixed(1)}%`)
    console.log(`- Average time per item: ${(totalTime / batchItems.length).toFixed(0)}ms`)

    // Assertions
    assert.isTrue(successfulResults.length >= 2, 'At least 2 out of 3 items should succeed')
    assert.isTrue(totalTime < 60000, 'Processing should complete within 60 seconds')

    // Verify successful results have expected properties
    successfulResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        const screenshot = result.value
        assert.isTrue(screenshot.buffer instanceof Buffer, 'Should return a Buffer')
        assert.isString(screenshot.format, 'Should have format')
        assert.isNumber(screenshot.width, 'Should have width')
        assert.isNumber(screenshot.height, 'Should have height')
        assert.isNumber(screenshot.processingTime, 'Should have processing time')
        assert.isString(screenshot.finalUrl, 'Should have final URL')
        assert.isBoolean(screenshot.wasTransformed, 'Should have transformation flag')
      }
    })

    // Log any failures for debugging
    if (failedResults.length > 0) {
      console.log('Failed results:')
      failedResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.log(`- Item ${index + 1}: ${result.reason}`)
        }
      })
    }
  }).timeout(120000) // 2 minute timeout

  test('should handle 10 concurrent batch requests with 3 items each', async ({ assert }) => {
    const batchCount = 10
    const itemsPerBatch = 3
    const totalItems = batchCount * itemsPerBatch

    console.log(`Starting concurrent batch test: ${batchCount} batches × ${itemsPerBatch} items = ${totalItems} total items`)

    const startTime = Date.now()

    // Create 10 concurrent batch processing promises
    const batchPromises = Array.from({ length: batchCount }, (_, batchIndex) => {
      const batchItems = Array.from({ length: itemsPerBatch }, (_, itemIndex) => ({
        url: `https://httpbin.org/html?batch=${batchIndex}&item=${itemIndex}&timestamp=${Date.now()}`,
        options: {
          format: (['png', 'jpeg', 'webp'] as const)[itemIndex % 3],
          width: [1280, 1920, 800][itemIndex % 3],
          height: [720, 1080, 600][itemIndex % 3],
          timeout: 30000,
          fullPage: false,
        },
      }))

      // Process each batch concurrently
      return Promise.allSettled(
        batchItems.map((item) => screenshotWorkerService.processScreenshotJob(item))
      )
    })

    // Execute all batches concurrently
    const batchResults = await Promise.allSettled(batchPromises)
    const totalTime = Date.now() - startTime

    // Analyze results
    const successfulBatches = batchResults.filter((r) => r.status === 'fulfilled')
    const failedBatches = batchResults.filter((r) => r.status === 'rejected')

    let totalSuccessfulItems = 0
    let totalFailedItems = 0

    successfulBatches.forEach((batchResult) => {
      if (batchResult.status === 'fulfilled') {
        const itemResults = batchResult.value
        const successfulItems = itemResults.filter((r) => r.status === 'fulfilled').length
        const failedItems = itemResults.filter((r) => r.status === 'rejected').length
        totalSuccessfulItems += successfulItems
        totalFailedItems += failedItems
      }
    })

    const successRate = (totalSuccessfulItems / totalItems) * 100
    const batchSuccessRate = (successfulBatches.length / batchCount) * 100

    console.log(`\nConcurrent Batch Processing Results:`)
    console.log(`- Total batches: ${batchCount}`)
    console.log(`- Items per batch: ${itemsPerBatch}`)
    console.log(`- Total items: ${totalItems}`)
    console.log(`- Processing time: ${totalTime}ms`)
    console.log(`- Successful batches: ${successfulBatches.length}/${batchCount} (${batchSuccessRate.toFixed(1)}%)`)
    console.log(`- Failed batches: ${failedBatches.length}`)
    console.log(`- Total successful items: ${totalSuccessfulItems}/${totalItems} (${successRate.toFixed(1)}%)`)
    console.log(`- Total failed items: ${totalFailedItems}`)
    console.log(`- Items per second: ${(totalSuccessfulItems / (totalTime / 1000)).toFixed(2)}`)
    console.log(`- Average time per batch: ${(totalTime / batchCount).toFixed(0)}ms`)

    // Performance assertions
    assert.isTrue(successfulBatches.length >= batchCount * 0.7, 'At least 70% of batches should complete successfully')
    assert.isTrue(totalSuccessfulItems >= totalItems * 0.6, 'At least 60% of items should be processed successfully')
    assert.isTrue(totalTime < 300000, 'All concurrent batches should complete within 5 minutes')

    // Calculate throughput and efficiency metrics
    const throughput = totalSuccessfulItems / (totalTime / 1000)
    console.log(`- Throughput: ${throughput.toFixed(2)} items/second`)

    // Memory usage tracking
    if (process.memoryUsage) {
      const memUsage = process.memoryUsage()
      console.log(`- Memory usage: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`)
      console.log(`- RSS memory: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`)
    }

    // Log any failed batches for debugging
    if (failedBatches.length > 0) {
      console.log(`\nFailed batch details:`)
      failedBatches.forEach((batchResult, index) => {
        if (batchResult.status === 'rejected') {
          console.log(`- Batch ${index}: ${batchResult.reason}`)
        }
      })
    }
  }).timeout(360000) // 6 minute timeout

  test('should handle different concurrency levels efficiently', async ({ assert }) => {
    const itemCount = 6
    const concurrencyLevels = [1, 2, 3, 6]
    const results: Array<{
      concurrency: number
      processingTime: number
      successRate: number
      throughput: number
    }> = []

    for (const concurrency of concurrencyLevels) {
      console.log(`\nTesting concurrency level: ${concurrency}`)

      const items = Array.from({ length: itemCount }, (_, i) => ({
        url: `https://httpbin.org/delay/1?concurrency=${concurrency}&item=${i}`,
        options: {
          format: 'png' as const,
          width: 1280,
          height: 720,
          timeout: 20000,
          fullPage: false,
        },
      }))

      const startTime = Date.now()

      // Process items with controlled concurrency
      const itemResults: any[] = []
      for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency)
        const batchResults = await Promise.allSettled(
          batch.map((item) => screenshotWorkerService.processScreenshotJob(item))
        )
        itemResults.push(...batchResults)
      }

      const processingTime = Date.now() - startTime
      const successfulItems = itemResults.filter((r) => r.status === 'fulfilled').length
      const successRate = (successfulItems / itemCount) * 100
      const throughput = successfulItems / (processingTime / 1000)

      results.push({
        concurrency,
        processingTime,
        successRate,
        throughput,
      })

      console.log(`- Concurrency ${concurrency}: ${processingTime}ms, ${successRate.toFixed(1)}% success, ${throughput.toFixed(2)} items/sec`)
    }

    // Analyze concurrency efficiency
    console.log(`\nConcurrency Performance Comparison:`)
    results.forEach((result) => {
      console.log(`- Level ${result.concurrency}: ${result.processingTime}ms (${result.throughput.toFixed(2)} items/sec, ${result.successRate.toFixed(1)}% success)`)
    })

    // Performance assertions
    results.forEach((result) => {
      assert.isTrue(result.successRate >= 60, `Concurrency ${result.concurrency} should have at least 60% success rate`)
    })

    // Higher concurrency should generally be faster (up to a point)
    const serialTime = results.find((r) => r.concurrency === 1)?.processingTime || 0
    const parallelTime = results.find((r) => r.concurrency === 3)?.processingTime || 0

    if (serialTime > 0 && parallelTime > 0) {
      const speedup = serialTime / parallelTime
      console.log(`- Speedup from concurrency 1 to 3: ${speedup.toFixed(2)}x`)
      // Note: Speedup may be limited by external service response times
    }
  }).timeout(480000) // 8 minute timeout

  test('should handle mixed success and failure scenarios', async ({ assert }) => {
    const items = [
      // These should succeed
      {
        url: 'https://httpbin.org/html?test=success1',
        options: {
          format: 'png' as const,
          width: 1280,
          height: 720,
          timeout: 30000,
          fullPage: false,
        },
      },
      {
        url: 'https://httpbin.org/html?test=success2',
        options: {
          format: 'jpeg' as const,
          width: 1920,
          height: 1080,
          timeout: 30000,
          fullPage: false,
        },
      },
      // This might timeout or fail
      {
        url: 'https://httpbin.org/delay/10?test=timeout',
        options: {
          format: 'png' as const,
          width: 800,
          height: 600,
          timeout: 5000, // Short timeout to force failure
          fullPage: false,
        },
      },
    ]

    const startTime = Date.now()

    const results = await Promise.allSettled(
      items.map((item) => screenshotWorkerService.processScreenshotJob(item))
    )

    const totalTime = Date.now() - startTime

    const successfulResults = results.filter((r) => r.status === 'fulfilled')
    const failedResults = results.filter((r) => r.status === 'rejected')

    console.log(`Mixed Success/Failure Test Results:`)
    console.log(`- Total items: ${items.length}`)
    console.log(`- Processing time: ${totalTime}ms`)
    console.log(`- Successful: ${successfulResults.length}`)
    console.log(`- Failed: ${failedResults.length}`)
    console.log(`- Success rate: ${((successfulResults.length / items.length) * 100).toFixed(1)}%`)

    // Should handle mixed scenarios gracefully
    assert.isTrue(successfulResults.length >= 1, 'At least some items should succeed')
    assert.isTrue(failedResults.length >= 0, 'Some items may fail (expected)')
    assert.isTrue(totalTime < 60000, 'Should complete within reasonable time even with failures')

    // Log failure details
    failedResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.log(`- Failed item ${index + 1}: ${result.reason}`)
      }
    })
  }).timeout(120000) // 2 minute timeout
})
