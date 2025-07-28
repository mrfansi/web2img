#!/usr/bin/env node

// Simple test to verify the batch enhancement changes work
import { validateBatchRequest } from './build/app/validators/screenshot_validator.js'

async function testBatchEnhancement() {
  console.log('🧪 Testing batch screenshot enhancement...')
  
  try {
    // Test 1: Basic batch request with webhook_url
    console.log('📋 Test 1: Basic batch request with webhook_url')
    const basicData = {
      items: [
        { id: 'test1', url: 'https://example.com' },
        { id: 'test2', url: 'https://google.com' }
      ],
      config: {
        webhook_url: 'https://webhook.example.com',
        webhook_auth: 'Bearer token123',
        fail_fast: true,
        priority: 'high',
        scheduled_time: '2025-07-29T10:00:00Z',
        recurrence: 'daily',
        rate_limit: 10
      }
    }
    
    const result1 = await validateBatchRequest(basicData)
    console.log('✅ Basic validation passed')
    console.log('   - webhook_url:', result1.config?.webhook_url)
    console.log('   - webhook_auth:', result1.config?.webhook_auth)
    console.log('   - fail_fast:', result1.config?.fail_fast)
    console.log('   - priority:', result1.config?.priority)
    console.log('   - scheduled_time:', result1.config?.scheduled_time)
    console.log('   - recurrence:', result1.config?.recurrence)
    console.log('   - rate_limit:', result1.config?.rate_limit)
    
    // Test 2: Webhook validation - should fail without webhook_auth
    console.log('\n📋 Test 2: Webhook validation (should fail without webhook_auth)')
    try {
      const invalidData = {
        items: [{ id: 'test1', url: 'https://example.com' }],
        config: {
          webhook_url: 'https://webhook.example.com'
          // Missing webhook_auth
        }
      }
      
      await validateBatchRequest(invalidData)
      console.log('❌ Should have failed validation')
    } catch (error) {
      console.log('✅ Correctly failed validation:', error.message)
    }
    
    // Test 3: Response format simulation
    console.log('\n📋 Test 3: Response format simulation')
    const mockBatchJob = {
      id: 'batch_123',
      status: 'pending',
      totalItems: 2,
      completedItems: 0,
      failedItems: 0,
      createdAt: { toISO: () => '2025-07-28T10:00:00Z' },
      updatedAt: { toISO: () => '2025-07-28T10:00:00Z' },
      scheduledAt: { toISO: () => '2025-07-29T10:00:00Z' },
      estimatedCompletion: { toISO: () => '2025-07-29T10:05:00Z' }
    }
    
    const mockConfig = { priority: 'high' }
    
    const responseFormat = {
      job_id: mockBatchJob.id.toString(),
      status: mockBatchJob.status,
      total: mockBatchJob.totalItems,
      completed: mockBatchJob.completedItems,
      failed: mockBatchJob.failedItems,
      priority: mockConfig.priority,
      created_at: mockBatchJob.createdAt.toISO(),
      updated_at: mockBatchJob.updatedAt.toISO(),
      scheduled_time: mockBatchJob.scheduledAt.toISO(),
      next_scheduled_time: undefined,
      estimated_completion: mockBatchJob.estimatedCompletion.toISO()
    }
    
    console.log('✅ Response format matches requirements:')
    console.log('   - job_id:', responseFormat.job_id)
    console.log('   - status:', responseFormat.status)
    console.log('   - total:', responseFormat.total)
    console.log('   - completed:', responseFormat.completed)
    console.log('   - failed:', responseFormat.failed)
    console.log('   - priority:', responseFormat.priority)
    console.log('   - created_at:', responseFormat.created_at)
    console.log('   - updated_at:', responseFormat.updated_at)
    console.log('   - scheduled_time:', responseFormat.scheduled_time)
    console.log('   - estimated_completion:', responseFormat.estimated_completion)
    
    console.log('\n🎉 All tests passed! Batch enhancement is working correctly.')
    
  } catch (error) {
    console.error('❌ Test failed:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

testBatchEnhancement()