#!/usr/bin/env node

/**
 * Debug script for batch worker issues in Docker environment
 * This script helps diagnose why batch jobs are completing with empty results
 */

import { setTimeout } from 'node:timers/promises'

async function debugBatchWorkers() {
  console.log('🔍 Starting batch worker diagnostics...')
  console.log('Environment:', process.env.NODE_ENV)
  console.log('Redis Host:', process.env.REDIS_HOST)
  console.log('Redis Port:', process.env.REDIS_PORT)
  
  try {
    // Import services
    console.log('\n📦 Importing services...')
    const { getCentralRedisManager } = await import('../app/services/central_redis_manager.js')
    const queueService = (await import('../app/services/queue_service.js')).default
    const { getScreenshotQueueWorker } = await import('../app/services/screenshot_queue_worker.js')
    const { getBatchQueueWorker } = await import('../app/services/batch_queue_worker.js')
    
    console.log('✅ Services imported successfully')

    // Test Redis connection
    console.log('\n🔗 Testing Redis connection...')
    const redisManager = getCentralRedisManager()
    const redisHealth = await redisManager.healthCheck()
    console.log('Redis Health:', redisHealth)
    
    if (!redisHealth.healthy) {
      console.error('❌ Redis is not healthy, this will cause batch jobs to fail')
      return
    }

    // Check queue metrics
    console.log('\n📊 Checking queue metrics...')
    const screenshotMetrics = await queueService.getQueueMetrics('screenshot')
    const batchMetrics = await queueService.getQueueMetrics('batch')
    
    console.log('Screenshot Queue:', screenshotMetrics)
    console.log('Batch Queue:', batchMetrics)

    // Check worker status
    console.log('\n👷 Checking worker status...')
    const screenshotWorker = getScreenshotQueueWorker()
    const batchWorker = getBatchQueueWorker()
    
    console.log('Screenshot Worker Running:', screenshotWorker.getWorker().isRunning())
    console.log('Screenshot Worker Paused:', screenshotWorker.getWorker().isPaused())
    console.log('Batch Worker Running:', batchWorker.getWorker().isRunning())
    console.log('Batch Worker Paused:', batchWorker.getWorker().isPaused())

    // Test creating a simple batch job
    console.log('\n🧪 Testing batch job creation...')
    
    // Import BatchJob model
    const BatchJob = (await import('../app/models/batch_job.js')).default
    
    // Create a test batch job
    const testBatch = await BatchJob.createBatchJob(1, {
      parallel: 1,
      timeout: 30000,
    })
    
    console.log('Test batch job created:', testBatch.id)
    
    // Create batch job data
    const batchJobData = {
      batchId: testBatch.id.toString(),
      items: [
        {
          id: 'debug-test-1',
          url: 'https://httpbin.org/html',
          format: 'png',
          width: 800,
          height: 600,
        },
      ],
      config: {
        parallel: 1,
        timeout: 30000,
      },
      apiKeyId: 'debug-test-key',
    }

    // Add batch job to queue
    console.log('Adding batch job to queue...')
    const job = await queueService.addBatchJob(batchJobData)
    console.log('Batch job queued with ID:', job.id)

    // Monitor the job for 60 seconds
    console.log('\n⏱️  Monitoring batch job for 60 seconds...')
    let attempts = 0
    const maxAttempts = 60
    
    while (attempts < maxAttempts) {
      await setTimeout(1000)
      await testBatch.refresh()
      
      console.log(`[${attempts + 1}s] Status: ${testBatch.status}, Completed: ${testBatch.completedItems}, Failed: ${testBatch.failedItems}, Results: ${testBatch.results?.length || 0}`)
      
      if (testBatch.status === 'completed' || testBatch.status === 'failed') {
        break
      }
      attempts++
    }

    // Final status
    console.log('\n📋 Final batch job status:')
    console.log('Status:', testBatch.status)
    console.log('Total Items:', testBatch.totalItems)
    console.log('Completed Items:', testBatch.completedItems)
    console.log('Failed Items:', testBatch.failedItems)
    console.log('Results Count:', testBatch.results?.length || 0)
    
    if (testBatch.results && testBatch.results.length > 0) {
      console.log('Results:', JSON.stringify(testBatch.results, null, 2))
    } else {
      console.log('❌ No results found - this indicates the bug!')
      
      // Check if there are any screenshot jobs in the queue
      const finalScreenshotMetrics = await queueService.getQueueMetrics('screenshot')
      console.log('Final Screenshot Queue Metrics:', finalScreenshotMetrics)
      
      // Check if the individual screenshot job was created
      const expectedJobId = `${testBatch.id}-debug-test-1`
      console.log('Expected screenshot job ID:', expectedJobId)
      
      try {
        const jobStatus = await queueService.getJobStatus(expectedJobId, 'screenshot')
        if (jobStatus) {
          console.log('Screenshot job status:', {
            id: jobStatus.id,
            progress: jobStatus.progress,
            finishedOn: jobStatus.finishedOn,
            returnvalue: jobStatus.returnvalue,
            failedReason: jobStatus.failedReason,
          })
        } else {
          console.log('❌ Screenshot job not found - may have been cleaned up')
        }
      } catch (error) {
        console.log('Error checking screenshot job status:', error.message)
      }
    }

    console.log('\n✅ Diagnostics completed')
    
  } catch (error) {
    console.error('❌ Diagnostics failed:', error.message)
    console.error('Stack trace:', error.stack)
  }
}

// Run diagnostics
debugBatchWorkers().then(() => {
  console.log('\n🏁 Debug script finished')
  process.exit(0)
}).catch((error) => {
  console.error('💥 Debug script crashed:', error.message)
  process.exit(1)
})
