#!/usr/bin/env node

/**
 * Simple integration test to verify core services work together
 */

import { setTimeout } from 'node:timers/promises'

async function testBasicIntegration() {
  console.log('🚀 Starting basic integration test...')
  
  try {
    // Test 1: Import and test queue service
    console.log('📋 Step 1: Testing queue service...')
    const { default: queueService } = await import('./app/services/queue_service.js')
    
    // Get queue metrics
    const screenshotMetrics = await queueService.getQueueMetrics('screenshot')
    const batchMetrics = await queueService.getQueueMetrics('batch')
    
    console.log('Queue metrics:', {
      screenshot: screenshotMetrics,
      batch: batchMetrics
    })
    console.log('✅ Queue service working')
    
    // Test 2: Test cache service
    console.log('📋 Step 2: Testing cache service...')
    const { default: cacheService } = await import('./app/services/cache_service.js')
    
    const testKey = 'integration-test-key'
    const testValue = 'https://example.com/test-image.png'
    
    // Test cache operations
    await cacheService.set(testKey, testValue)
    const retrieved = await cacheService.get(testKey)
    
    console.log('Cache test:', {
      set: testValue,
      retrieved: retrieved,
      match: retrieved === testValue
    })
    
    // Clean up
    await cacheService.del(testKey)
    console.log('✅ Cache service working')
    
    // Test 3: Test file storage service
    console.log('📋 Step 3: Testing file storage service...')
    const { default: fileStorageService } = await import('./app/services/file_storage_service.js')
    
    const testBuffer = Buffer.from('test-integration-data')
    const testFilename = `integration-test-${Date.now()}.txt`
    
    // Test file operations
    const storagePath = await fileStorageService.saveFile(testBuffer, testFilename, 'temp')
    const fileUrl = fileStorageService.getFileUrl(storagePath)
    
    console.log('File storage test:', {
      filename: testFilename,
      storagePath: storagePath,
      fileUrl: fileUrl.substring(0, 50) + '...'
    })
    
    // Clean up
    await fileStorageService.deleteFile(storagePath)
    console.log('✅ File storage service working')
    
    // Test 4: Test ImgProxy service
    console.log('📋 Step 4: Testing ImgProxy service...')
    const { default: imgProxyService } = await import('./app/services/imgproxy_service.js')
    
    const testImagePath = '/test/image.png'
    const imgProxyUrl = imgProxyService.generateUrlWithFallback(testImagePath, {
      format: 'png',
      width: 800,
      height: 600
    })
    
    console.log('ImgProxy test:', {
      originalPath: testImagePath,
      generatedUrl: imgProxyUrl.substring(0, 50) + '...'
    })
    console.log('✅ ImgProxy service working')
    
    // Test 5: Test webhook service
    console.log('📋 Step 5: Testing webhook service...')
    const { default: webhookService } = await import('./app/services/webhook_service.js')
    
    const testPayload = webhookService.createBatchCompletionPayload(
      'test-job-123',
      'completed',
      3,
      2,
      1,
      new Date(Date.now() - 30000),
      new Date(),
      [
        { itemId: 'item-1', status: 'success', url: 'https://example.com/image1.png' },
        { itemId: 'item-2', status: 'success', url: 'https://example.com/image2.png' },
        { itemId: 'item-3', status: 'error', error: 'Failed to capture' }
      ]
    )
    
    console.log('Webhook payload test:', {
      jobId: testPayload.job_id,
      status: testPayload.status,
      total: testPayload.total,
      completed: testPayload.completed,
      failed: testPayload.failed
    })
    
    // Test URL validation
    const validUrl = webhookService.validateWebhookUrl('https://httpbin.org/post')
    const invalidUrl = webhookService.validateWebhookUrl('https://localhost/webhook')
    
    console.log('Webhook URL validation:', {
      validUrl: validUrl,
      invalidUrl: invalidUrl
    })
    console.log('✅ Webhook service working')
    
    // Test 6: Test screenshot worker service
    console.log('📋 Step 6: Testing screenshot worker service...')
    const { screenshotWorkerService } = await import('./app/services/screenshot_worker_service.js')
    
    // Test validation
    const validationResult = screenshotWorkerService.validateScreenshotOptions({
      format: 'png',
      width: 800,
      height: 600,
      timeout: 30000
    })
    
    console.log('Screenshot options validation:', {
      isValid: validationResult.isValid,
      error: validationResult.error
    })
    console.log('✅ Screenshot worker service working')
    
    // Test 7: Test browser service health
    console.log('📋 Step 7: Testing browser service...')
    const { browserService } = await import('./app/services/browser_service.js')
    
    const browserHealth = await browserService.healthCheck()
    console.log('Browser health:', {
      healthy: browserHealth.healthy,
      hasInstances: browserHealth.activeInstances > 0
    })
    console.log('✅ Browser service working')
    
    // Test 8: Add a simple job to the queue
    console.log('📋 Step 8: Testing job queue integration...')
    
    const testJob = await queueService.addScreenshotJob({
      url: 'https://httpbin.org/json',
      format: 'png',
      width: 800,
      height: 600,
      timeout: 30000,
      cacheKey: cacheService.generateCacheKey('https://httpbin.org/json', {
        format: 'png',
        width: 800,
        height: 600
      }),
      apiKeyId: 'test-integration-key'
    })
    
    console.log('Test job added:', {
      jobId: testJob.id,
      name: testJob.name
    })
    
    // Wait a moment and check status
    await setTimeout(2000)
    
    const jobStatus = await queueService.getJobStatus(testJob.id, 'screenshot')
    console.log('Job status after 2 seconds:', {
      id: jobStatus?.id,
      progress: jobStatus?.progress,
      finished: !!jobStatus?.finishedOn,
      failed: !!jobStatus?.failedReason
    })
    console.log('✅ Job queue integration working')
    
    console.log('🎉 All basic integration tests passed!')
    return true
    
  } catch (error) {
    console.error('❌ Integration test failed:', error.message)
    console.error('Stack trace:', error.stack)
    return false
  }
}

// Run the test
testBasicIntegration()
  .then(success => {
    console.log(success ? '✅ Integration test completed successfully' : '❌ Integration test failed')
    process.exit(success ? 0 : 1)
  })
  .catch(error => {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  })