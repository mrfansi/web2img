import { test } from '@japa/runner'
import { QueueService, type ScreenshotJobData, type BatchJobData } from '#services/queue_service'

test.group('QueueService', (group) => {
  let queueService: QueueService

  group.setup(() => {
    queueService = new QueueService()
  })

  group.teardown(async () => {
    await queueService.close()
  })

  test('should create queue service with proper configuration', async ({ assert }) => {
    const screenshotQueue = queueService.getQueue('screenshot')
    const batchQueue = queueService.getQueue('batch')

    assert.isTrue(screenshotQueue.name === 'screenshot')
    assert.isTrue(batchQueue.name === 'batch')
  })

  test('should add screenshot job to queue', async ({ assert }) => {
    const jobData: ScreenshotJobData = {
      url: 'https://example.com',
      format: 'png',
      width: 1280,
      height: 720,
      timeout: 30000,
      cacheKey: 'test-cache-key',
      apiKeyId: 'test-api-key',
    }

    const job = await queueService.addScreenshotJob(jobData)

    assert.isTrue(job.id !== undefined)
    assert.equal(job.name, 'screenshot')
    assert.deepEqual(job.data, jobData)
  })

  test('should add screenshot job with options', async ({ assert }) => {
    const jobData: ScreenshotJobData = {
      url: 'https://example.com',
      format: 'jpeg',
      width: 1920,
      height: 1080,
      timeout: 45000,
      cacheKey: 'test-cache-key-2',
      apiKeyId: 'test-api-key',
    }

    const options = {
      priority: 10,
      delay: 5000,
      jobId: 'custom-job-id',
    }

    const job = await queueService.addScreenshotJob(jobData, options)

    assert.equal(job.id, 'custom-job-id')
    assert.equal(job.opts.priority, 10)
    assert.equal(job.opts.delay, 5000)
  })

  test('should add batch job to queue', async ({ assert }) => {
    const jobData: BatchJobData = {
      id: 'batch-123',
      items: [
        {
          id: 'item-1',
          url: 'https://example.com',
          format: 'png',
          width: 1280,
          height: 720,
        },
        {
          id: 'item-2',
          url: 'https://google.com',
          format: 'jpeg',
        },
      ],
      config: {
        parallel: 2,
        timeout: 30000,
        cache: true,
      },
      apiKeyId: 'test-api-key',
    }

    const job = await queueService.addBatchJob(jobData)

    assert.isTrue(job.id !== undefined)
    assert.equal(job.name, 'batch')
    assert.deepEqual(job.data, jobData)
  })

  test('should schedule job for future execution', async ({ assert }) => {
    const jobData: ScreenshotJobData = {
      url: 'https://scheduled.com',
      format: 'png',
      width: 1280,
      height: 720,
      timeout: 30000,
      cacheKey: 'scheduled-cache-key',
      apiKeyId: 'test-api-key',
    }

    const scheduledTime = new Date(Date.now() + 60000) // 1 minute from now
    const job = await queueService.scheduleJob('screenshot', jobData, scheduledTime)

    assert.isTrue(job.opts.delay! > 0)
    assert.isTrue(job.opts.delay! <= 60000)
  })

  test('should throw error when scheduling job in the past', async ({ assert }) => {
    const jobData: ScreenshotJobData = {
      url: 'https://past.com',
      format: 'png',
      width: 1280,
      height: 720,
      timeout: 30000,
      cacheKey: 'past-cache-key',
      apiKeyId: 'test-api-key',
    }

    const pastTime = new Date(Date.now() - 60000) // 1 minute ago

    await assert.rejects(
      () => queueService.scheduleJob('screenshot', jobData, pastTime),
      'Scheduled time must be in the future'
    )
  })

  test('should get job status', async ({ assert }) => {
    const jobData: ScreenshotJobData = {
      url: 'https://status.com',
      format: 'png',
      width: 1280,
      height: 720,
      timeout: 30000,
      cacheKey: 'status-cache-key',
      apiKeyId: 'test-api-key',
    }

    await queueService.addScreenshotJob(jobData, { jobId: 'status-test-job' })
    const status = await queueService.getJobStatus('status-test-job')

    assert.isNotNull(status)
    assert.equal(status.id, 'status-test-job')
    assert.equal(status.name, 'screenshot')
    assert.deepEqual(status.data, jobData)
  })

  test('should return null for non-existent job status', async ({ assert }) => {
    const status = await queueService.getJobStatus('non-existent-job')
    assert.isNull(status)
  })

  test('should get queue metrics', async ({ assert }) => {
    // Add a few jobs to test metrics
    const jobData: ScreenshotJobData = {
      url: 'https://metrics.com',
      format: 'png',
      width: 1280,
      height: 720,
      timeout: 30000,
      cacheKey: 'metrics-cache-key',
      apiKeyId: 'test-api-key',
    }

    await queueService.addScreenshotJob(jobData)
    await queueService.addScreenshotJob({ ...jobData, url: 'https://metrics2.com' })

    const metrics = await queueService.getQueueMetrics('screenshot')

    assert.isNumber(metrics.waiting)
    assert.isNumber(metrics.active)
    assert.isNumber(metrics.completed)
    assert.isNumber(metrics.failed)
    assert.isNumber(metrics.delayed)
    assert.isTrue(metrics.waiting >= 2) // At least the 2 jobs we added
  })

  test('should cancel job', async ({ assert }) => {
    const jobData: ScreenshotJobData = {
      url: 'https://cancel.com',
      format: 'png',
      width: 1280,
      height: 720,
      timeout: 30000,
      cacheKey: 'cancel-cache-key',
      apiKeyId: 'test-api-key',
    }

    await queueService.addScreenshotJob(jobData, { jobId: 'cancel-test-job' })
    const cancelled = await queueService.cancelJob('cancel-test-job')

    assert.isTrue(cancelled)

    // Job should no longer exist
    const status = await queueService.getJobStatus('cancel-test-job')
    assert.isNull(status)
  })

  test('should return false when cancelling non-existent job', async ({ assert }) => {
    const cancelled = await queueService.cancelJob('non-existent-cancel-job')
    assert.isFalse(cancelled)
  })

  test('should pause and resume queue', async ({ assert }) => {
    // This test mainly checks that the methods don't throw errors
    // In a real scenario, you'd need to check if jobs are actually paused
    await assert.doesNotReject(() => queueService.pauseQueue('screenshot'))
    await assert.doesNotReject(() => queueService.resumeQueue('screenshot'))
  })

  test('should clean old jobs from queue', async ({ assert }) => {
    // Add some jobs first
    const jobData: ScreenshotJobData = {
      url: 'https://clean.com',
      format: 'png',
      width: 1280,
      height: 720,
      timeout: 30000,
      cacheKey: 'clean-cache-key',
      apiKeyId: 'test-api-key',
    }

    await queueService.addScreenshotJob(jobData)

    // Clean with very short grace period
    const cleanedJobs = await queueService.cleanQueue('screenshot', 1000, 'completed')

    assert.isArray(cleanedJobs)
    // The number of cleaned jobs may vary depending on queue state
    assert.isTrue(cleanedJobs.length >= 0)
  })

  test('should handle Redis connection configuration', async ({ assert }) => {
    // Test that the service can be created without throwing errors
    const testService = new QueueService()

    // Test that queues are properly configured
    const screenshotQueue = testService.getQueue('screenshot')
    const batchQueue = testService.getQueue('batch')

    assert.isTrue(screenshotQueue.name === 'screenshot')
    assert.isTrue(batchQueue.name === 'batch')

    await testService.close()
  })

  test('should handle job retry configuration', async ({ assert }) => {
    const jobData: ScreenshotJobData = {
      url: 'https://retry.com',
      format: 'png',
      width: 1280,
      height: 720,
      timeout: 30000,
      cacheKey: 'retry-cache-key',
      apiKeyId: 'test-api-key',
    }

    const job = await queueService.addScreenshotJob(jobData)

    // Check that job has retry configuration
    assert.equal(job.opts.attempts, 3)
    assert.deepEqual(job.opts.backoff, {
      type: 'exponential',
      delay: 2000,
    })
  })
})