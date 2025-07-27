import { test } from '@japa/runner'
import { setTimeout } from 'node:timers/promises'
import applicationBootstrap from '#services/application_bootstrap'
import queueService from '#services/queue_service'
import cacheService from '#services/cache_service'
import fileStorageService from '#services/file_storage_service'
import imgProxyService from '#services/imgproxy_service'
import webhookService from '#services/webhook_service'
import jobSchedulerService from '#services/job_scheduler_service'
import BatchJob from '#models/batch_job'

test.group('Complete System Integration', (group) => {
  group.setup(async () => {
    // Initialize the application bootstrap before running tests
    await applicationBootstrap.initialize()
  })

  group.teardown(async () => {
    // Clean shutdown after tests
    await applicationBootstrap.shutdown()
  })

  test('should perform complete system health check', async ({ assert }) => {
    const healthCheck = await applicationBootstrap.healthCheck()
    
    assert.isTrue(healthCheck.healthy, 'System should be healthy')
    assert.exists(healthCheck.services.redis, 'Redis service should be checked')
    assert.exists(healthCheck.services.cache, 'Cache service should be checked')
    assert.exists(healthCheck.services.fileStorage, 'File storage service should be checked')
    assert.exists(healthCheck.services.browser, 'Browser service should be checked')
    assert.exists(healthCheck.services.queue, 'Queue service should be checked')
    assert.exists(healthCheck.services.workers, 'Workers should be checked')
    
    // All individual services should be healthy
    assert.isTrue(healthCheck.services.redis.healthy, 'Redis should be healthy')
    assert.isTrue(healthCheck.services.cache.healthy, 'Cache should be healthy')
    assert.isTrue(healthCheck.services.fileStorage.healthy, 'File storage should be healthy')
    assert.isTrue(healthCheck.services.browser.healthy, 'Browser should be healthy')
    assert.isTrue(healthCheck.services.queue.healthy, 'Queue should be healthy')
    assert.isTrue(healthCheck.services.workers.healthy, 'Workers should be healthy')
  })

  test('should get comprehensive system metrics', async ({ assert }) => {
    const metrics = await applicationBootstrap.getSystemMetrics()
    
    assert.exists(metrics.queues, 'Queue metrics should exist')
    assert.exists(metrics.queues.screenshot, 'Screenshot queue metrics should exist')
    assert.exists(metrics.queues.batch, 'Batch queue metrics should exist')
    assert.exists(metrics.scheduledJobs, 'Scheduled jobs should exist')
    assert.exists(metrics.cache, 'Cache metrics should exist')
    assert.exists(metrics.browser, 'Browser metrics should exist')
    assert.exists(metrics.timestamp, 'Timestamp should exist')
    
    // Verify queue metrics structure
    assert.isNumber(metrics.queues.screenshot.waiting, 'Screenshot waiting count should be a number')
    assert.isNumber(metrics.queues.screenshot.active, 'Screenshot active count should be a number')
    assert.isNumber(metrics.queues.batch.waiting, 'Batch waiting count should be a number')
    assert.isNumber(metrics.queues.batch.active, 'Batch active count should be a number')
  })

  test('should complete full screenshot workflow', async ({ assert }) => {
    const testUrl = 'https://httpbin.org/html'
    const workflowResult = await applicationBootstrap.testCompleteWorkflow(testUrl)
    
    assert.isTrue(workflowResult.success, 'Complete workflow should succeed')
    assert.isAbove(workflowResult.steps.length, 0, 'Should have workflow steps')
    assert.isAbove(workflowResult.totalDuration, 0, 'Should have positive duration')
    
    // Check individual steps
    const stepNames = workflowResult.steps.map(s => s.step)
    assert.include(stepNames, 'URL Transformation', 'Should include URL transformation step')
    assert.include(stepNames, 'Cache Check', 'Should include cache check step')
    assert.include(stepNames, 'Screenshot Capture', 'Should include screenshot capture step')
    assert.include(stepNames, 'File Storage', 'Should include file storage step')
    assert.include(stepNames, 'ImgProxy URL Generation', 'Should include ImgProxy URL generation step')
    
    // All steps should succeed
    const failedSteps = workflowResult.steps.filter(s => !s.success)
    if (failedSteps.length > 0) {
      console.log('Failed steps:', failedSteps)
    }
    assert.equal(failedSteps.length, 0, 'All workflow steps should succeed')
  })

  test('should process single screenshot job end-to-end', async ({ assert }) => {
    const testUrl = 'https://httpbin.org/json'
    
    // Add a screenshot job to the queue
    const job = await queueService.addScreenshotJob({
      url: testUrl,
      format: 'png',
      width: 800,
      height: 600,
      timeout: 30000,
      cacheKey: cacheService.generateCacheKey(testUrl, {
        format: 'png',
        width: 800,
        height: 600
      }),
      apiKeyId: 'test-api-key'
    })
    
    assert.exists(job.id, 'Job should have an ID')
    
    // Wait for job to complete (with timeout)
    let jobStatus
    let attempts = 0
    const maxAttempts = 30 // 30 seconds
    
    do {
      await setTimeout(1000) // Wait 1 second
      jobStatus = await queueService.getJobStatus(job.id!, 'screenshot')
      attempts++
    } while ((!jobStatus?.finishedOn && !jobStatus?.failedReason) && attempts < maxAttempts)
    
    assert.exists(jobStatus, 'Job status should exist')
    
    if (jobStatus.failedReason) {
      console.log('Job failed:', jobStatus.failedReason)
      assert.fail(`Job should not fail: ${jobStatus.failedReason}`)
    }
    
    assert.exists(jobStatus.finishedOn, 'Job should be finished')
    assert.exists(jobStatus.returnvalue, 'Job should have return value')
    
    const result = jobStatus.returnvalue
    assert.isTrue(result.success, 'Screenshot job should succeed')
    assert.exists(result.imageUrl, 'Should have image URL')
    assert.isNumber(result.processingTime, 'Should have processing time')
  })

  test('should process batch job with multiple items', async ({ assert }) => {
    const testUrls = [
      'https://httpbin.org/json',
      'https://httpbin.org/html',
      'https://httpbin.org/xml'
    ]
    
    // Create batch job in database
    const batchJob = await BatchJob.createBatchJob(
      testUrls.length,
      {
        parallel: 2,
        timeout: 30000,
        cache: true,
        fail_fast: false
      }
    )
    
    // Prepare batch job data
    const batchJobData = {
      id: batchJob.id.toString(),
      items: testUrls.map((url, index) => ({
        id: `item-${index + 1}`,
        url,
        format: 'png' as const,
        width: 800,
        height: 600
      })),
      config: {
        parallel: 2,
        timeout: 30000,
        cache: true,
        fail_fast: false
      },
      apiKeyId: 'test-api-key'
    }
    
    // Add batch job to queue
    const job = await queueService.addBatchJob(batchJobData)
    assert.exists(job.id, 'Batch job should have an ID')
    
    // Wait for batch job to complete (with longer timeout)
    let jobStatus
    let attempts = 0
    const maxAttempts = 60 // 60 seconds for batch job
    
    do {
      await setTimeout(1000) // Wait 1 second
      jobStatus = await queueService.getJobStatus(job.id!, 'batch')
      attempts++
    } while ((!jobStatus?.finishedOn && !jobStatus?.failedReason) && attempts < maxAttempts)
    
    assert.exists(jobStatus, 'Batch job status should exist')
    
    if (jobStatus.failedReason) {
      console.log('Batch job failed:', jobStatus.failedReason)
      assert.fail(`Batch job should not fail: ${jobStatus.failedReason}`)
    }
    
    assert.exists(jobStatus.finishedOn, 'Batch job should be finished')
    assert.exists(jobStatus.returnvalue, 'Batch job should have return value')
    
    const result = jobStatus.returnvalue
    assert.equal(result.batchId, batchJob.id.toString(), 'Should have correct batch ID')
    assert.equal(result.totalItems, testUrls.length, 'Should have correct total items')
    assert.isAbove(result.completedItems, 0, 'Should have completed items')
    assert.isArray(result.results, 'Should have results array')
    assert.equal(result.results.length, testUrls.length, 'Should have result for each item')
    
    // Check that most items succeeded (allowing for some failures due to network issues)
    const successfulItems = result.results.filter((r: any) => r.success)
    assert.isAbove(successfulItems.length, 0, 'At least some items should succeed')
  })

  test('should handle webhook delivery for batch completion', async ({ assert }) => {
    // This test requires a webhook endpoint - we'll test the webhook service directly
    const testJobId = 'test-webhook-job-123'
    const testPayload = webhookService.createBatchCompletionPayload(
      testJobId,
      'completed',
      3,
      2,
      1,
      new Date(Date.now() - 30000), // 30 seconds ago
      new Date(),
      [
        { itemId: 'item-1', status: 'success', url: 'https://example.com/image1.png', cached: false },
        { itemId: 'item-2', status: 'success', url: 'https://example.com/image2.png', cached: true },
        { itemId: 'item-3', status: 'error', error: 'Failed to capture screenshot' }
      ]
    )
    
    assert.equal(testPayload.job_id, testJobId, 'Payload should have correct job ID')
    assert.equal(testPayload.status, 'completed', 'Payload should have correct status')
    assert.equal(testPayload.total, 3, 'Payload should have correct total')
    assert.equal(testPayload.completed, 2, 'Payload should have correct completed count')
    assert.equal(testPayload.failed, 1, 'Payload should have correct failed count')
    assert.isArray(testPayload.results, 'Payload should have results array')
    assert.equal(testPayload.results.length, 3, 'Payload should have correct results count')
    
    // Test webhook URL validation
    assert.isTrue(webhookService.validateWebhookUrl('https://example.com/webhook'), 'Valid HTTPS URL should pass')
    assert.isTrue(webhookService.validateWebhookUrl('http://example.com/webhook'), 'Valid HTTP URL should pass')
    assert.isFalse(webhookService.validateWebhookUrl('https://localhost/webhook'), 'Localhost URL should fail')
    assert.isFalse(webhookService.validateWebhookUrl('ftp://example.com/webhook'), 'Non-HTTP URL should fail')
  })

  test('should handle scheduled job creation and management', async ({ assert }) => {
    const testJobId = `test-scheduled-${Date.now()}`
    const executeAt = new Date(Date.now() + 10000) // 10 seconds from now
    
    // Schedule a one-time job
    const scheduledJob = await jobSchedulerService.scheduleOnceJob({
      id: testJobId,
      type: 'screenshot',
      data: {
        url: 'https://httpbin.org/json',
        format: 'png',
        width: 800,
        height: 600,
        timeout: 30000,
        cacheKey: '',
        apiKeyId: 'test-api-key'
      },
      schedule: {
        type: 'once',
        executeAt
      },
      metadata: {
        createdAt: new Date(),
        createdBy: 'integration-test',
        description: 'Test scheduled job'
      }
    }, executeAt)
    
    assert.exists(scheduledJob.scheduledJobId, 'Should have scheduled job ID')
    assert.exists(scheduledJob.jobId, 'Should have queue job ID')
    
    // Check job status
    const jobStatus = await jobSchedulerService.getScheduledJobStatus(testJobId)
    assert.exists(jobStatus, 'Job status should exist')
    assert.equal(jobStatus!.status, 'scheduled', 'Job should be scheduled')
    assert.exists(jobStatus!.nextRun, 'Should have next run time')
    
    // List scheduled jobs
    const scheduledJobs = await jobSchedulerService.listScheduledJobs({
      status: 'scheduled'
    })
    
    const ourJob = scheduledJobs.find(job => job.id === testJobId)
    assert.exists(ourJob, 'Our job should be in the list')
    assert.equal(ourJob!.type, 'screenshot', 'Job should have correct type')
    
    // Cancel the job to clean up
    const cancelled = await jobSchedulerService.cancelScheduledJob(testJobId)
    assert.isTrue(cancelled, 'Job should be cancelled successfully')
    
    // Verify cancellation
    const cancelledStatus = await jobSchedulerService.getScheduledJobStatus(testJobId)
    assert.equal(cancelledStatus!.status, 'cancelled', 'Job should be cancelled')
  })

  test('should handle cache operations correctly', async ({ assert }) => {
    const testUrl = 'https://example.com/test-cache'
    const testImageUrl = 'https://storage.example.com/test-image.png'
    
    // Generate cache key
    const cacheKey = cacheService.generateCacheKey(testUrl, {
      format: 'png',
      width: 1280,
      height: 720
    })
    
    assert.isString(cacheKey, 'Cache key should be a string')
    assert.isAbove(cacheKey.length, 0, 'Cache key should not be empty')
    
    // Test cache miss
    const cachedResult1 = await cacheService.get(cacheKey)
    assert.isNull(cachedResult1, 'Cache should initially be empty')
    
    // Set cache value
    await cacheService.set(cacheKey, testImageUrl)
    
    // Test cache hit
    const cachedResult2 = await cacheService.get(cacheKey)
    assert.equal(cachedResult2, testImageUrl, 'Cache should return stored value')
    
    // Test cache deletion
    await cacheService.del(cacheKey)
    const cachedResult3 = await cacheService.get(cacheKey)
    assert.isNull(cachedResult3, 'Cache should be empty after deletion')
    
    // Test cache stats
    const stats = await cacheService.getStats()
    assert.exists(stats, 'Cache stats should exist')
    assert.isNumber(stats.totalKeys, 'Total keys should be a number')
  })

  test('should handle file storage operations', async ({ assert }) => {
    const testBuffer = Buffer.from('test-screenshot-data-integration')
    const testFilename = `integration-test-${Date.now()}.png`
    
    // Save file
    const storagePath = await fileStorageService.saveFile(testBuffer, testFilename, 'screenshots')
    assert.isString(storagePath, 'Storage path should be a string')
    assert.include(storagePath, testFilename, 'Storage path should include filename')
    
    // Get file URL
    const fileUrl = fileStorageService.getFileUrl(storagePath)
    assert.isString(fileUrl, 'File URL should be a string')
    assert.include(fileUrl, testFilename, 'File URL should include filename')
    
    // Check file exists
    const exists = await fileStorageService.fileExists(storagePath)
    assert.isTrue(exists, 'File should exist after saving')
    
    // Delete file
    await fileStorageService.deleteFile(storagePath)
    
    // Check file no longer exists
    const existsAfterDelete = await fileStorageService.fileExists(storagePath)
    assert.isFalse(existsAfterDelete, 'File should not exist after deletion')
  })

  test('should handle ImgProxy URL generation', async ({ assert }) => {
    const testImagePath = '/test/image.png'
    const options = {
      format: 'png' as const,
      width: 800,
      height: 600
    }
    
    // Test URL generation (with or without ImgProxy configured)
    const generatedUrl = imgProxyService.generateUrlWithFallback(testImagePath, options)
    assert.isString(generatedUrl, 'Generated URL should be a string')
    assert.isAbove(generatedUrl.length, 0, 'Generated URL should not be empty')
    
    // Test configuration check
    const isConfigured = (imgProxyService as any).isConfigured
    assert.isBoolean(isConfigured, 'Configuration check should return boolean')
    
    if (isConfigured) {
      // If ImgProxy is configured, URL should be an ImgProxy URL
      assert.include(generatedUrl, 'imgproxy', 'Should be ImgProxy URL when configured')
    } else {
      // If not configured, should return the original path
      assert.include(generatedUrl, testImagePath, 'Should include original path when not configured')
    }
  })

  test('should maintain system stability under load', async ({ assert }) => {
    // This is a basic load test - add multiple jobs simultaneously
    const jobPromises = []
    const jobCount = 5
    
    for (let i = 0; i < jobCount; i++) {
      const jobPromise = queueService.addScreenshotJob({
        url: `https://httpbin.org/delay/1?test=${i}`,
        format: 'png',
        width: 400,
        height: 300,
        timeout: 30000,
        cacheKey: cacheService.generateCacheKey(`https://httpbin.org/delay/1?test=${i}`, {
          format: 'png',
          width: 400,
          height: 300
        }),
        apiKeyId: 'load-test-api-key'
      })
      jobPromises.push(jobPromise)
    }
    
    // Add all jobs
    const jobs = await Promise.all(jobPromises)
    assert.equal(jobs.length, jobCount, 'All jobs should be added')
    
    // Check system health during load
    const healthDuringLoad = await applicationBootstrap.healthCheck()
    assert.isTrue(healthDuringLoad.healthy, 'System should remain healthy under load')
    
    // Wait for jobs to complete
    await setTimeout(10000) // Wait 10 seconds
    
    // Check final system health
    const healthAfterLoad = await applicationBootstrap.healthCheck()
    assert.isTrue(healthAfterLoad.healthy, 'System should be healthy after load')
    
    // Check queue metrics
    const metrics = await queueService.getQueueMetrics('screenshot')
    // We don't assert specific numbers since jobs might still be processing
    assert.isNumber(metrics.waiting, 'Waiting count should be a number')
    assert.isNumber(metrics.active, 'Active count should be a number')
    assert.isNumber(metrics.completed, 'Completed count should be a number')
  })
})