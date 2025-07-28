import { test } from '@japa/runner'
import { ApiClient } from '@japa/api-client'
import ApiKey from '#models/api_key'
import User from '#models/user'
import { cleanupRedisConnections } from '#tests/utils/redis_test_utils'
import { createServer, Server } from 'http'

test.group('Webhook Delivery - Integration Tests', (group) => {
  let apiClient: ApiClient
  let testUser: User
  let testApiKey: ApiKey
  let mockWebhookServer: Server
  let webhookRequests: Array<{
    method: string
    url: string
    headers: any
    body: any
    timestamp: number
  }> = []
  let webhookPort = 3001

  group.setup(async () => {
    apiClient = new ApiClient()
    
    // Create test user
    testUser = await User.create({
      email: 'webhook-test@example.com',
      password: 'password123'
    })
    
    // Create test API key
    testApiKey = await ApiKey.create({
      key: 'webhook-test-api-key-123',
      name: 'Webhook Test Key',
      userId: testUser.id,
      rateLimit: 1000,
      isActive: true
    })
    
    // Start mock webhook server
    mockWebhookServer = createServer((req, res) => {
      let body = ''
      req.on('data', chunk => {
        body += chunk.toString()
      })
      
      req.on('end', () => {
        webhookRequests.push({
          method: req.method || 'POST',
          url: req.url || '',
          headers: req.headers,
          body: body ? JSON.parse(body) : null,
          timestamp: Date.now()
        })
        
        // Simulate different webhook responses based on URL path
        if (req.url === '/webhook/success') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'received' }))
        } else if (req.url === '/webhook/retry') {
          // Fail first 2 attempts, succeed on 3rd
          const attemptCount = webhookRequests.filter(r => r.url === '/webhook/retry').length
          if (attemptCount <= 2) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'temporary_failure' }))
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ status: 'received_after_retry' }))
          }
        } else if (req.url === '/webhook/auth') {
          // Check for authorization header
          if (req.headers.authorization === 'Bearer webhook-auth-token-123') {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ status: 'authenticated' }))
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'unauthorized' }))
          }
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'not_found' }))
        }
      })
    })
    
    await new Promise<void>((resolve) => {
      mockWebhookServer.listen(webhookPort, resolve)
    })
  })

  group.teardown(async () => {
    // Stop mock webhook server
    if (mockWebhookServer) {
      await new Promise<void>((resolve) => {
        mockWebhookServer.close(() => resolve())
      })
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
    // Clear webhook requests before each test
    webhookRequests = []
  })

  test('successful webhook delivery', async ({ assert }) => {
    const webhookUrl = `http://localhost:${webhookPort}/webhook/success`
    
    // Create batch job with webhook
    const batchResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [
          { id: 'webhook1', url: 'https://example.com' }
        ],
        config: {
          webhook_url: webhookUrl,
          parallel: 1
        }
      })

    batchResponse.assertStatus(202)
    const jobId = batchResponse.body().job_id
    
    // Wait for batch processing and webhook delivery
    let finalStatus: any
    let attempts = 0
    const maxAttempts = 30
    
    do {
      await new Promise(resolve => setTimeout(resolve, 1000))
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
    
    // Wait a bit more for webhook delivery
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Verify webhook was called
    assert.isTrue(webhookRequests.length > 0, 'Webhook should have been called')
    
    const webhookRequest = webhookRequests.find(r => r.url === '/webhook/success')
    assert.isDefined(webhookRequest, 'Webhook request should be found')
    
    if (webhookRequest) {
      assert.equal(webhookRequest.method, 'POST')
      assert.isDefined(webhookRequest.body)
      assert.equal(webhookRequest.body.job_id, jobId)
      assert.equal(webhookRequest.body.status, 'completed')
      assert.isArray(webhookRequest.body.results)
    }
  })

  test('webhook delivery with authentication', async ({ assert }) => {
    const webhookUrl = `http://localhost:${webhookPort}/webhook/auth`
    const authToken = 'Bearer webhook-auth-token-123'
    
    // Create batch job with webhook and auth
    const batchResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [
          { id: 'webhook-auth1', url: 'https://example.com' }
        ],
        config: {
          webhook_url: webhookUrl,
          webhook_auth: authToken,
          parallel: 1
        }
      })

    batchResponse.assertStatus(202)
    const jobId = batchResponse.body().job_id
    
    // Wait for processing and webhook delivery
    let attempts = 0
    const maxAttempts = 30
    
    do {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const statusResponse = await apiClient
        .get(`/batch/screenshots/${jobId}`)
        .header('X-API-Key', testApiKey.key)
      
      const status = statusResponse.body().status
      attempts++
      
      if (status === 'completed' || status === 'failed') {
        break
      }
    } while (attempts < maxAttempts)
    
    // Wait for webhook delivery
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Verify webhook was called with correct auth
    const webhookRequest = webhookRequests.find(r => r.url === '/webhook/auth')
    assert.isDefined(webhookRequest, 'Authenticated webhook should have been called')
    
    if (webhookRequest) {
      assert.equal(webhookRequest.headers.authorization, authToken)
      assert.equal(webhookRequest.body.job_id, jobId)
    }
  })

  test('webhook retry mechanism', async ({ assert }) => {
    const webhookUrl = `http://localhost:${webhookPort}/webhook/retry`
    
    // Create batch job with webhook that will initially fail
    const batchResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [
          { id: 'webhook-retry1', url: 'https://example.com' }
        ],
        config: {
          webhook_url: webhookUrl,
          parallel: 1
        }
      })

    batchResponse.assertStatus(202)
    const jobId = batchResponse.body().job_id
    
    // Wait for processing to complete
    let attempts = 0
    const maxAttempts = 30
    
    do {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const statusResponse = await apiClient
        .get(`/batch/screenshots/${jobId}`)
        .header('X-API-Key', testApiKey.key)
      
      const status = statusResponse.body().status
      attempts++
      
      if (status === 'completed' || status === 'failed') {
        break
      }
    } while (attempts < maxAttempts)
    
    // Wait longer for retry attempts (webhook service should retry with exponential backoff)
    await new Promise(resolve => setTimeout(resolve, 10000))
    
    // Verify multiple webhook attempts were made
    const retryRequests = webhookRequests.filter(r => r.url === '/webhook/retry')
    assert.isTrue(retryRequests.length >= 2, 'Multiple webhook retry attempts should have been made')
    
    // Verify exponential backoff timing (requests should be spaced out)
    if (retryRequests.length >= 2) {
      const timeDiff = retryRequests[1].timestamp - retryRequests[0].timestamp
      assert.isTrue(timeDiff >= 1000, 'Retry attempts should be spaced out with backoff')
    }
    
    // Check if final attempt was successful
    const lastRequest = retryRequests[retryRequests.length - 1]
    if (retryRequests.length >= 3) {
      // Should have succeeded on 3rd attempt based on our mock server logic
      assert.equal(lastRequest.body.job_id, jobId)
    }
  })

  test('webhook delivery failure handling', async ({ assert }) => {
    const webhookUrl = `http://localhost:${webhookPort}/webhook/nonexistent`
    
    // Create batch job with webhook that will fail
    const batchResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [
          { id: 'webhook-fail1', url: 'https://example.com' }
        ],
        config: {
          webhook_url: webhookUrl,
          parallel: 1
        }
      })

    batchResponse.assertStatus(202)
    const jobId = batchResponse.body().job_id
    
    // Wait for processing to complete
    let attempts = 0
    const maxAttempts = 30
    
    do {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const statusResponse = await apiClient
        .get(`/batch/screenshots/${jobId}`)
        .header('X-API-Key', testApiKey.key)
      
      const status = statusResponse.body().status
      attempts++
      
      if (status === 'completed' || status === 'failed') {
        break
      }
    } while (attempts < maxAttempts)
    
    // Wait for webhook attempts
    await new Promise(resolve => setTimeout(resolve, 5000))
    
    // Verify webhook attempts were made (should fail with 404)
    const failedRequests = webhookRequests.filter(r => r.url === '/webhook/nonexistent')
    assert.isTrue(failedRequests.length > 0, 'Failed webhook attempts should have been made')
    
    // Batch job should still be completed despite webhook failure
    const finalStatusResponse = await apiClient
      .get(`/batch/screenshots/${jobId}`)
      .header('X-API-Key', testApiKey.key)
    
    finalStatusResponse.assertStatus(200)
    const finalStatus = finalStatusResponse.body()
    assert.equal(finalStatus.status, 'completed', 'Batch job should complete despite webhook failure')
  })

  test('webhook payload validation', async ({ assert }) => {
    const webhookUrl = `http://localhost:${webhookPort}/webhook/success`
    
    // Create batch job with multiple items
    const batchResponse = await apiClient
      .post('/batch/screenshots')
      .header('X-API-Key', testApiKey.key)
      .json({
        items: [
          { id: 'payload1', url: 'https://example.com', format: 'png' },
          { id: 'payload2', url: 'https://httpbin.org/html', format: 'jpeg' }
        ],
        config: {
          webhook_url: webhookUrl,
          parallel: 2,
          cache: true
        }
      })

    batchResponse.assertStatus(202)
    const jobId = batchResponse.body().job_id
    
    // Wait for processing and webhook delivery
    let attempts = 0
    const maxAttempts = 30
    
    do {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const statusResponse = await apiClient
        .get(`/batch/screenshots/${jobId}`)
        .header('X-API-Key', testApiKey.key)
      
      const status = statusResponse.body().status
      attempts++
      
      if (status === 'completed' || status === 'failed') {
        break
      }
    } while (attempts < maxAttempts)
    
    // Wait for webhook delivery
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Verify webhook payload structure
    const webhookRequest = webhookRequests.find(r => r.url === '/webhook/success')
    assert.isDefined(webhookRequest, 'Webhook should have been called')
    
    if (webhookRequest) {
      const payload = webhookRequest.body
      
      // Verify required fields
      assert.equal(payload.job_id, jobId)
      assert.isString(payload.status)
      assert.isNumber(payload.total)
      assert.isNumber(payload.completed)
      assert.isNumber(payload.failed)
      assert.isArray(payload.results)
      assert.isString(payload.created_at)
      assert.isString(payload.updated_at)
      
      // Verify results structure
      assert.lengthOf(payload.results, 2)
      payload.results.forEach((result: any) => {
        assert.isString(result.itemId)
        assert.isString(result.status)
        assert.isTrue(['success', 'error'].includes(result.status))
        
        if (result.status === 'success') {
          assert.isString(result.url)
          assert.isBoolean(result.cached)
        }
      })
      
      // Verify config is included
      assert.isDefined(payload.config)
      assert.equal(payload.config.parallel, 2)
      assert.equal(payload.config.cache, true)
    }
  })
})