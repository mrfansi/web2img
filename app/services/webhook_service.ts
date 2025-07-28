import logger from '@adonisjs/core/services/logger'
import type { WebhookData } from '../types/screenshot.js'
import webhookDeliveryTracker from './webhook_delivery_tracker.js'

/**
 * Webhook payload for batch completion notifications
 */
export interface WebhookPayload {
  job_id: string
  status: 'completed' | 'failed'
  total: number
  completed: number
  failed: number
  created_at: string
  completed_at: string
  processing_time: number
  results: Array<{
    itemId: string
    status: 'success' | 'error'
    url?: string
    error?: string
    cached?: boolean
    processingTime?: number
  }>
}

/**
 * Webhook delivery result
 */
export interface WebhookDeliveryResult {
  success: boolean
  statusCode?: number
  error?: string
  attempt: number
  deliveredAt: Date
}

/**
 * Webhook service for delivering batch completion notifications
 * Handles HTTP POST requests with authentication and retry logic
 */
export class WebhookService {
  private static instance: WebhookService
  private readonly maxRetries = 5
  private readonly baseDelay = 1000 // 1 second
  private readonly maxDelay = 30000 // 30 seconds
  private readonly timeout = 10000 // 10 seconds

  /**
   * Get singleton instance of WebhookService
   */
  public static getInstance(): WebhookService {
    if (!WebhookService.instance) {
      WebhookService.instance = new WebhookService()
    }
    return WebhookService.instance
  }

  /**
   * Send webhook notification with HTTP POST request
   */
  public async sendWebhook(
    url: string,
    payload: WebhookPayload,
    auth?: string
  ): Promise<WebhookDeliveryResult> {
    const startTime = Date.now()

    try {
      // Validate webhook URL
      if (!this.validateWebhookUrl(url)) {
        return {
          success: false,
          error: 'Invalid webhook URL',
          attempt: 1,
          deliveredAt: new Date(),
        }
      }

      // Prepare headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'web2img-webhook/1.0',
      }

      // Add authentication header if provided
      if (auth) {
        headers['Authorization'] = auth
      }

      // Make HTTP POST request
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeout),
      })

      const deliveryResult: WebhookDeliveryResult = {
        success: response.ok,
        statusCode: response.status,
        attempt: 1,
        deliveredAt: new Date(),
      }

      if (response.ok) {
        logger.info('Webhook delivered successfully', {
          url,
          jobId: payload.job_id,
          statusCode: response.status,
          processingTime: Date.now() - startTime,
        })
      } else {
        const errorText = await response.text().catch(() => 'Unknown error')
        deliveryResult.error = `HTTP ${response.status}: ${errorText}`

        logger.warn('Webhook delivery failed', {
          url,
          jobId: payload.job_id,
          statusCode: response.status,
          error: deliveryResult.error,
        })
      }

      return deliveryResult
    } catch (error) {
      const deliveryResult: WebhookDeliveryResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        attempt: 1,
        deliveredAt: new Date(),
      }

      logger.error('Webhook delivery error', {
        url,
        jobId: payload.job_id,
        error: deliveryResult.error,
        processingTime: Date.now() - startTime,
      })

      return deliveryResult
    }
  }

  /**
   * Retry webhook delivery with exponential backoff
   */
  public async retryWebhook(
    webhookData: WebhookData,
    attempt: number
  ): Promise<WebhookDeliveryResult> {
    const maxRetries = webhookData.maxRetries || this.maxRetries

    if (attempt > maxRetries) {
      const error = `Maximum retry attempts (${maxRetries}) exceeded`
      logger.error('Webhook retry limit exceeded', {
        url: webhookData.url,
        attempt,
        maxRetries,
      })

      return {
        success: false,
        error,
        attempt,
        deliveredAt: new Date(),
      }
    }

    // Calculate exponential backoff delay
    const delay = Math.min(this.baseDelay * Math.pow(2, attempt - 1), this.maxDelay)

    logger.info('Retrying webhook delivery', {
      url: webhookData.url,
      attempt,
      delay,
      maxRetries,
    })

    // Wait for the calculated delay
    await this.sleep(delay)

    try {
      const result = await this.sendWebhook(webhookData.url, webhookData.payload, webhookData.auth)

      result.attempt = attempt

      if (!result.success && attempt < maxRetries) {
        // Recursively retry if failed and haven't reached max attempts
        return await this.retryWebhook(webhookData, attempt + 1)
      }

      return result
    } catch (error) {
      logger.error('Webhook retry failed', {
        url: webhookData.url,
        attempt,
        error: error instanceof Error ? error.message : 'Unknown error',
      })

      if (attempt < maxRetries) {
        return await this.retryWebhook(webhookData, attempt + 1)
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        attempt,
        deliveredAt: new Date(),
      }
    }
  }

  /**
   * Validate webhook URL format and security
   */
  public validateWebhookUrl(url: string): boolean {
    try {
      const urlObj = new URL(url)

      // Only allow HTTP and HTTPS protocols
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        logger.warn('Invalid webhook URL protocol', { url, protocol: urlObj.protocol })
        return false
      }

      // Reject localhost and private IP ranges for security
      const hostname = urlObj.hostname.toLowerCase()

      // Check for localhost
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
        logger.warn('Webhook URL points to localhost', { url, hostname })
        return false
      }

      // Check for private IP ranges (basic check)
      if (this.isPrivateIP(hostname)) {
        logger.warn('Webhook URL points to private IP', { url, hostname })
        return false
      }

      // URL is valid
      return true
    } catch (error) {
      logger.warn('Invalid webhook URL format', { url, error })
      return false
    }
  }

  /**
   * Create webhook payload for batch completion
   */
  public createBatchCompletionPayload(
    jobId: string,
    status: 'completed' | 'failed',
    total: number,
    completed: number,
    failed: number,
    createdAt: Date,
    completedAt: Date,
    results: Array<{
      itemId: string
      status: 'success' | 'error'
      url?: string
      error?: string
      cached?: boolean
      processingTime?: number
    }>
  ): WebhookPayload {
    const processingTime = completedAt.getTime() - createdAt.getTime()

    return {
      job_id: jobId,
      status,
      total,
      completed,
      failed,
      created_at: createdAt.toISOString(),
      completed_at: completedAt.toISOString(),
      processing_time: processingTime,
      results,
    }
  }

  /**
   * Deliver webhook with automatic retry on failure and tracking
   */
  public async deliverWebhook(webhookData: WebhookData): Promise<WebhookDeliveryResult> {
    const trackingId = this.generateTrackingId(webhookData.url, webhookData.payload.job_id)

    logger.info('Starting webhook delivery', {
      trackingId,
      url: webhookData.url,
      hasAuth: !!webhookData.auth,
      maxRetries: webhookData.maxRetries,
    })

    // Start tracking the delivery
    await webhookDeliveryTracker.startTracking(
      trackingId,
      webhookData.url,
      webhookData.payload.job_id,
      webhookData.maxRetries
    )

    const result = await this.sendWebhook(webhookData.url, webhookData.payload, webhookData.auth)

    // Update tracking with initial result
    await webhookDeliveryTracker.updateDeliveryStatus(trackingId, result)

    // If delivery failed and retries are allowed, start retry process
    if (!result.success && webhookData.maxRetries > 1) {
      return await this.retryWebhookWithTracking(webhookData, trackingId, 2) // Start with attempt 2
    }

    return result
  }

  /**
   * Retry webhook delivery with tracking
   */
  private async retryWebhookWithTracking(
    webhookData: WebhookData,
    trackingId: string,
    attempt: number
  ): Promise<WebhookDeliveryResult> {
    if (attempt > webhookData.maxRetries) {
      const error = `Maximum retry attempts (${webhookData.maxRetries}) exceeded`
      logger.error('Webhook retry limit exceeded', {
        trackingId,
        url: webhookData.url,
        attempt,
        maxRetries: webhookData.maxRetries,
      })

      const result: WebhookDeliveryResult = {
        success: false,
        error,
        attempt,
        deliveredAt: new Date(),
      }

      await webhookDeliveryTracker.updateDeliveryStatus(trackingId, result)
      return result
    }

    // Calculate exponential backoff delay
    const delay = Math.min(this.baseDelay * Math.pow(2, attempt - 1), this.maxDelay)

    logger.info('Retrying webhook delivery', {
      trackingId,
      url: webhookData.url,
      attempt,
      delay,
      maxRetries: webhookData.maxRetries,
    })

    // Wait for the calculated delay
    await this.sleep(delay)

    try {
      const result = await this.sendWebhook(webhookData.url, webhookData.payload, webhookData.auth)

      result.attempt = attempt

      // Update tracking with retry result
      await webhookDeliveryTracker.updateDeliveryStatus(trackingId, result)

      if (!result.success && attempt < webhookData.maxRetries) {
        // Recursively retry if failed and haven't reached max attempts
        return await this.retryWebhookWithTracking(webhookData, trackingId, attempt + 1)
      }

      return result
    } catch (error) {
      logger.error('Webhook retry failed', {
        trackingId,
        url: webhookData.url,
        attempt,
        error: error instanceof Error ? error.message : 'Unknown error',
      })

      const result: WebhookDeliveryResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        attempt,
        deliveredAt: new Date(),
      }

      await webhookDeliveryTracker.updateDeliveryStatus(trackingId, result)

      if (attempt < webhookData.maxRetries) {
        return await this.retryWebhookWithTracking(webhookData, trackingId, attempt + 1)
      }

      return result
    }
  }

  /**
   * Generate tracking ID for webhook delivery
   */
  private generateTrackingId(url: string, jobId: string): string {
    const timestamp = Date.now()
    const hash = Buffer.from(`${url}:${jobId}:${timestamp}`).toString('base64').slice(0, 16)
    return `webhook_${hash}`
  }

  /**
   * Check if hostname is a private IP address (basic implementation)
   */
  private isPrivateIP(hostname: string): boolean {
    // Basic regex patterns for private IP ranges
    const privateIPPatterns = [
      /^10\./, // 10.0.0.0/8
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
      /^192\.168\./, // 192.168.0.0/16
      /^169\.254\./, // 169.254.0.0/16 (link-local)
      /^fc00:/, // IPv6 unique local
      /^fe80:/, // IPv6 link-local
    ]

    return privateIPPatterns.some((pattern) => pattern.test(hostname))
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// Export singleton instance
export default WebhookService.getInstance()
