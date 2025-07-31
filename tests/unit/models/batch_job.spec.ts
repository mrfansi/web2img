import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import BatchJob, { BatchJobStatus, BatchConfig, BatchResult } from '#models/batch_job'
import db from '@adonisjs/lucid/services/db'

test.group('BatchJob Model', (group) => {
  group.setup(async () => {
    // Ensure clean database state before all tests
    try {
      await db.from('batch_jobs').del()
    } catch (error) {
      console.warn('Database cleanup failed in BatchJob tests setup:', error)
    }
  })

  group.each.setup(async () => {
    // Clean up database before each test
    try {
      await db.from('batch_jobs').del()
    } catch (error) {
      console.warn('Database cleanup failed in BatchJob tests:', error)
    }
  })

  group.each.teardown(async () => {
    // Clean up database after each test
    try {
      await db.from('batch_jobs').del()
    } catch (error) {
      console.warn('Database cleanup failed in BatchJob tests teardown:', error)
    }
  })
  test('should create batch job with default values', async ({ assert }) => {
    const config: BatchConfig = { parallel: 3, timeout: 30000 }
    const batchJob = await BatchJob.createBatchJob(5, config)

    assert.equal(batchJob.status, BatchJobStatus.PENDING)
    assert.equal(batchJob.totalItems, 5)
    assert.equal(batchJob.completedItems, 0)
    assert.equal(batchJob.failedItems, 0)
    assert.deepEqual(batchJob.config, config)
    assert.isArray(batchJob.results)
    assert.equal(batchJob.results.length, 0)
    assert.isNull(batchJob.scheduledAt)
  })

  test('should create scheduled batch job', async ({ assert }) => {
    const scheduledTime = DateTime.now().plus({ hours: 1 })
    const batchJob = await BatchJob.createBatchJob(3, {}, scheduledTime)

    assert.equal(batchJob.status, BatchJobStatus.SCHEDULED)
    // Allow for database precision differences (milliseconds may be truncated)
    const timeDiff = Math.abs(batchJob.scheduledAt!.toMillis() - scheduledTime.toMillis())
    assert.isTrue(timeDiff < 1000, `Time difference should be less than 1 second, got ${timeDiff}ms`)
  })

  test('should start processing', async ({ assert }) => {
    const batchJob = await BatchJob.createBatchJob(3)
    assert.equal(batchJob.status, BatchJobStatus.PENDING)

    await batchJob.startProcessing()

    assert.equal(batchJob.status, BatchJobStatus.PROCESSING)
  })

  test('should mark as completed', async ({ assert }) => {
    const batchJob = await BatchJob.createBatchJob(3)
    await batchJob.startProcessing()

    await batchJob.markCompleted()

    assert.equal(batchJob.status, BatchJobStatus.COMPLETED)
    assert.isNotNull(batchJob.completedAt)
  })

  test('should mark as failed', async ({ assert }) => {
    const batchJob = await BatchJob.createBatchJob(3)
    await batchJob.startProcessing()

    await batchJob.markFailed()

    assert.equal(batchJob.status, BatchJobStatus.FAILED)
    assert.isNotNull(batchJob.completedAt)
  })

  test('should cancel batch job', async ({ assert }) => {
    const batchJob = await BatchJob.createBatchJob(3)

    await batchJob.cancel()

    assert.equal(batchJob.status, BatchJobStatus.CANCELLED)
  })

  test('should update progress', async ({ assert }) => {
    const batchJob = await BatchJob.createBatchJob(10)

    await batchJob.updateProgress(7, 2)

    assert.equal(batchJob.completedItems, 7)
    assert.equal(batchJob.failedItems, 2)
  })

  test('should add result', async ({ assert }) => {
    const batchJob = await BatchJob.createBatchJob(3)

    const result: BatchResult = {
      itemId: 'item-1',
      status: 'success',
      url: 'https://example.com/screenshot.png',
      cached: false,
    }

    await batchJob.addResult(result)

    assert.equal(batchJob.results.length, 1)
    assert.deepEqual(batchJob.results[0], result)
  })

  test('should update specific result', async ({ assert }) => {
    const batchJob = await BatchJob.createBatchJob(3)

    const result: BatchResult = {
      itemId: 'item-1',
      status: 'pending',
    }

    await batchJob.addResult(result)
    await batchJob.updateResult('item-1', {
      status: 'success',
      url: 'https://example.com/screenshot.png',
    })

    assert.equal(batchJob.results[0].status, 'success')
    assert.equal(batchJob.results[0].url, 'https://example.com/screenshot.png')
    assert.equal(batchJob.results[0].itemId, 'item-1')
  })

  test('should calculate progress percentage', async ({ assert }) => {
    const batchJob = await BatchJob.createBatchJob(10)

    // No progress
    assert.equal(batchJob.progressPercentage, 0)

    // 50% progress (3 completed + 2 failed out of 10)
    await batchJob.updateProgress(3, 2)
    assert.equal(batchJob.progressPercentage, 50)

    // 100% progress
    await batchJob.updateProgress(8, 2)
    assert.equal(batchJob.progressPercentage, 100)
  })

  test('should handle zero total items for progress percentage', async ({ assert }) => {
    const batchJob = await BatchJob.createBatchJob(0)

    assert.equal(batchJob.progressPercentage, 0)
  })

  test('should check completion status', async ({ assert }) => {
    const batchJob = await BatchJob.createBatchJob(3)

    assert.isFalse(batchJob.isCompleted)

    await batchJob.markCompleted()
    assert.isTrue(batchJob.isCompleted)

    // Reset and test failed status
    batchJob.status = BatchJobStatus.PENDING
    await batchJob.markFailed()
    assert.isTrue(batchJob.isCompleted)
  })

  test('should check processing status', async ({ assert }) => {
    const batchJob = await BatchJob.createBatchJob(3)

    assert.isFalse(batchJob.isProcessing)

    await batchJob.startProcessing()
    assert.isTrue(batchJob.isProcessing)
  })

  test('should check scheduled status', async ({ assert }) => {
    const scheduledTime = DateTime.now().plus({ hours: 1 })
    const batchJob = await BatchJob.createBatchJob(3, {}, scheduledTime)

    assert.isTrue(batchJob.isScheduled)

    await batchJob.startProcessing()
    assert.isFalse(batchJob.isScheduled)
  })

  test('should check pending status', async ({ assert }) => {
    const batchJob = await BatchJob.createBatchJob(3)

    assert.isTrue(batchJob.isPending)

    await batchJob.startProcessing()
    assert.isFalse(batchJob.isPending)
  })

  test('should filter successful results', async ({ assert }) => {
    const batchJob = await BatchJob.createBatchJob(3)

    await batchJob.addResult({ itemId: 'item-1', status: 'success', url: 'url1' })
    await batchJob.addResult({ itemId: 'item-2', status: 'error', error: 'Failed' })
    await batchJob.addResult({ itemId: 'item-3', status: 'success', url: 'url3' })

    const successfulResults = batchJob.successfulResults

    assert.equal(successfulResults.length, 2)
    assert.equal(successfulResults[0].itemId, 'item-1')
    assert.equal(successfulResults[1].itemId, 'item-3')
  })

  test('should filter failed results', async ({ assert }) => {
    const batchJob = await BatchJob.createBatchJob(3)

    await batchJob.addResult({ itemId: 'item-1', status: 'success', url: 'url1' })
    await batchJob.addResult({ itemId: 'item-2', status: 'error', error: 'Failed' })
    await batchJob.addResult({ itemId: 'item-3', status: 'error', error: 'Timeout' })

    const failedResults = batchJob.failedResults

    assert.equal(failedResults.length, 2)
    assert.equal(failedResults[0].itemId, 'item-2')
    assert.equal(failedResults[1].itemId, 'item-3')
  })

  test('should calculate estimated completion time', async ({ assert }) => {
    const batchJob = await BatchJob.createBatchJob(10)

    // No estimation for non-processing jobs
    assert.isNull(batchJob.estimatedCompletion)

    await batchJob.startProcessing()

    // No estimation with zero completed items
    assert.isNull(batchJob.estimatedCompletion)

    // Add a small delay to ensure meaningful elapsed time for calculation
    await new Promise(resolve => setTimeout(resolve, 20))

    // Add some progress
    await batchJob.updateProgress(3, 1)

    // Should have an estimated completion time
    const estimation = batchJob.estimatedCompletion
    assert.isNotNull(estimation)

    // Check that estimation is in the future (with some tolerance for timing)
    const now = DateTime.now()
    const timeDiff = estimation!.toMillis() - now.toMillis()
    assert.isTrue(timeDiff >= -5, `Estimation should be in the future or very close to now, but was ${timeDiff}ms in the past`)
  })

  test('should handle JSON serialization for config and results', async ({ assert }) => {
    const config: BatchConfig = {
      parallel: 5,
      timeout: 60000,
      webhook_url: 'https://example.com/webhook',
      cache: true,
    }

    const batchJob = await BatchJob.createBatchJob(2, config)

    const result: BatchResult = {
      itemId: 'test-item',
      status: 'success',
      url: 'https://example.com/image.png',
      cached: true,
      processingTime: 1500,
    }

    await batchJob.addResult(result)

    // Verify config is properly stored and retrieved
    assert.deepEqual(batchJob.config, config)

    // Verify results are properly stored and retrieved
    assert.equal(batchJob.results.length, 1)
    assert.deepEqual(batchJob.results[0], result)
  })
})
