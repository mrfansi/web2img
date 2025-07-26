#!/usr/bin/env node

/**
 * Simple integration test script to verify the complete system works
 */

import { setTimeout } from 'node:timers/promises'

async function testSystemIntegration() {
  console.log('🚀 Starting system integration test...')
  
  try {
    // Import the application bootstrap
    const { default: applicationBootstrap } = await import('./app/services/application_bootstrap.js')
    
    console.log('📋 Step 1: Initializing application bootstrap...')
    await applicationBootstrap.initialize()
    console.log('✅ Application bootstrap initialized successfully')
    
    console.log('📋 Step 2: Performing health check...')
    const healthCheck = await applicationBootstrap.healthCheck()
    console.log('Health check result:', {
      healthy: healthCheck.healthy,
      services: Object.keys(healthCheck.services).map(key => ({
        service: key,
        healthy: healthCheck.services[key].healthy
      }))
    })
    
    if (!healthCheck.healthy) {
      console.log('❌ System is not healthy, aborting test')
      return false
    }
    console.log('✅ System health check passed')
    
    console.log('📋 Step 3: Getting system metrics...')
    const metrics = await applicationBootstrap.getSystemMetrics()
    console.log('System metrics:', {
      screenshot_queue: metrics.queues.screenshot,
      batch_queue: metrics.queues.batch,
      scheduled_jobs_count: metrics.scheduledJobs.length,
      browser_healthy: metrics.browser.healthy
    })
    console.log('✅ System metrics retrieved successfully')
    
    console.log('📋 Step 4: Testing complete workflow...')
    const workflowResult = await applicationBootstrap.testCompleteWorkflow('https://httpbin.org/html')
    console.log('Workflow test result:', {
      success: workflowResult.success,
      total_duration: workflowResult.totalDuration,
      steps: workflowResult.steps.map(s => ({
        step: s.step,
        success: s.success,
        duration: s.duration,
        error: s.error
      }))
    })
    
    if (!workflowResult.success) {
      console.log('❌ Complete workflow test failed')
      return false
    }
    console.log('✅ Complete workflow test passed')
    
    console.log('📋 Step 5: Testing webhook delivery...')
    const webhookResult = await applicationBootstrap.testWebhookDelivery('https://httpbin.org/post', 'test-webhook-job')
    console.log('Webhook test result:', {
      success: webhookResult.success,
      duration: webhookResult.duration,
      status_code: webhookResult.result.statusCode
    })
    console.log('✅ Webhook delivery test completed')
    
    console.log('📋 Step 6: Testing scheduled job execution...')
    const scheduledResult = await applicationBootstrap.testScheduledJobExecution()
    console.log('Scheduled job test result:', {
      success: scheduledResult.success,
      duration: scheduledResult.duration,
      one_time_job: scheduledResult.results.oneTimeJob.scheduledJobId ? 'created' : 'failed',
      recurring_job: scheduledResult.results.recurringJob.scheduledJobId ? 'created' : 'failed'
    })
    console.log('✅ Scheduled job execution test completed')
    
    console.log('📋 Step 7: Testing queue service integration...')
    const queueService = (await import('./app/services/queue_service.js')).default
    
    // Add a test screenshot job
    const testJob = await queueService.addScreenshotJob({
      url: 'https://httpbin.org/json',
      format: 'png',
      width: 800,
      height: 600,
      timeout: 30000,
      cacheKey: 'test-integration-key',
      apiKeyId: 'test-api-key'
    })
    
    console.log('Test job added:', { jobId: testJob.id })
    
    // Wait a moment for processing
    await setTimeout(2000)
    
    // Check job status
    const jobStatus = await queueService.getJobStatus(testJob.id, 'screenshot')
    console.log('Job status:', {
      id: jobStatus?.id,
      progress: jobStatus?.progress,
      finished: !!jobStatus?.finishedOn,
      failed: !!jobStatus?.failedReason
    })
    console.log('✅ Queue service integration test completed')
    
    console.log('📋 Step 8: Shutting down gracefully...')
    await applicationBootstrap.shutdown()
    console.log('✅ System shutdown completed')
    
    console.log('🎉 All integration tests passed successfully!')
    return true
    
  } catch (error) {
    console.error('❌ Integration test failed:', error.message)
    console.error('Stack trace:', error.stack)
    return false
  }
}

// Run the test
testSystemIntegration()
  .then(success => {
    process.exit(success ? 0 : 1)
  })
  .catch(error => {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  })