import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { validateSingleScreenshotRequest, validateBatchRequest } from '#validators/screenshot_validator'
import cacheService from '#services/cache_service'
import { screenshotWorkerService } from '#services/screenshot_worker_service'
import fileStorageService from '#services/file_storage_service'
import imgProxyService from '#services/imgproxy_service'
import queueService from '#services/queue_service'
import BatchJob from '#models/batch_job'
import { DateTime } from 'luxon'

/**
 * Screenshot controller for handling single and batch screenshot requests
 */
export default class ScreenshotController {
  /**
   * @swagger
   * /screenshot:
   *   post:
   *     summary: Capture a single website screenshot
   *     description: |
   *       Captures a screenshot of the specified website URL with customizable options.
   *       Results are cached by default and can be served from cache for improved performance.
   *     tags:
   *       - Screenshots
   *     security:
   *       - ApiKeyAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/ScreenshotRequest'
   *           examples:
   *             basic:
   *               summary: Basic screenshot
   *               value:
   *                 url: "https://example.com"
   *             custom:
   *               summary: Custom dimensions and format
   *               value:
   *                 url: "https://example.com"
   *                 format: "jpeg"
   *                 width: 1920
   *                 height: 1080
   *                 fullPage: true
   *     responses:
   *       200:
   *         description: Screenshot captured successfully
   *         headers:
   *           X-RateLimit-Limit:
   *             schema:
   *               type: integer
   *           X-RateLimit-Remaining:
   *             schema:
   *               type: integer
   *           X-RateLimit-Reset:
   *             schema:
   *               type: integer
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ScreenshotResponse'
   *             examples:
   *               success:
   *                 summary: Successful screenshot
   *                 value:
   *                   success: true
   *                   screenshot_url: "https://api.web2img.com/images/abc123.png"
   *                   cache_hit: false
   *                   processing_time_ms: 1500
   *                   file_size_bytes: 245760
   *                   expires_at: "2025-07-27T12:00:00Z"
   *               cached:
   *                 summary: Cached screenshot result
   *                 value:
   *                   success: true
   *                   screenshot_url: "https://api.web2img.com/images/abc123.png"
   *                   cache_hit: true
   *                   processing_time_ms: 50
   *                   file_size_bytes: 245760
   *                   expires_at: "2025-07-27T12:00:00Z"
   *       400:
   *         $ref: '#/components/responses/BadRequest'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       429:
   *         $ref: '#/components/responses/RateLimited'
   *       500:
   *         $ref: '#/components/responses/InternalError'
   */
  /**
   * Handle single screenshot request
   * POST /screenshot
   */
  async single({ request, response }: HttpContext) {
    const startTime = Date.now()

    try {
      // Validate request data
      const validatedData = await validateSingleScreenshotRequest(request.all())

      // Set defaults for optional parameters
      const screenshotOptions = {
        format: validatedData.format || 'png',
        width: validatedData.width || 1280,
        height: validatedData.height || 720,
        timeout: validatedData.timeout || 30000,
        fullPage: validatedData.fullPage || false,
        useCache: validatedData.cache !== false // Default to true unless explicitly false
      }

      logger.info('Processing single screenshot request', {
        url: validatedData.url,
        options: screenshotOptions
      })

      // Generate cache key
      const cacheKey = cacheService.generateCacheKey(validatedData.url, {
        format: screenshotOptions.format as 'png' | 'jpeg' | 'webp',
        width: screenshotOptions.width,
        height: screenshotOptions.height
      })

      // Check cache if enabled
      let cachedUrl: string | null = null
      let expiresAt: string | null = null
      
      if (screenshotOptions.useCache) {
        cachedUrl = await cacheService.get(cacheKey)
        if (cachedUrl) {
          const expirationTime = await cacheService.getExpirationTime(cacheKey)
          expiresAt = expirationTime ? expirationTime.toISOString() : null
          
          const processingTime = Date.now() - startTime

          logger.info('Returning cached screenshot', {
            url: validatedData.url,
            cacheKey: cacheKey.substring(0, 16) + '...',
            processingTime
          })

          return response.json({
            success: true,
            screenshot_url: cachedUrl,
            cache_hit: true,
            processing_time_ms: processingTime,
            file_size_bytes: 0, // File size not available for cached results
            expires_at: expiresAt
          })
        }
      }

      // Check if URL is currently being processed to prevent duplicate work
      if (await cacheService.isProcessing(validatedData.url)) {
        return response.status(429).json({
          detail: {
            error: 'processing_in_progress',
            message: 'This URL is currently being processed. Please try again in a moment.'
          }
        })
      }

      // Set processing lock
      await cacheService.setProcessingLock(validatedData.url, 300) // 5 minutes

      try {
        // Capture screenshot using worker service
        const screenshotResult = await screenshotWorkerService.processScreenshotJob({
          url: validatedData.url,
          options: {
            format: screenshotOptions.format as 'png' | 'jpeg' | 'webp',
            width: screenshotOptions.width,
            height: screenshotOptions.height,
            timeout: screenshotOptions.timeout,
            fullPage: screenshotOptions.fullPage
          }
        })

        // Calculate file size from buffer
        const fileSizeBytes = screenshotResult.buffer.length

        // Save screenshot to storage
        const filename = `${Date.now()}.${screenshotResult.format}`
        const storagePath = await fileStorageService.saveFile(
          screenshotResult.buffer,
          filename,
          'screenshots'
        )

        // Generate direct storage URL
        const directUrl = fileStorageService.getFileUrl(storagePath)

        // Generate ImgProxy URL with fallback to direct URL
        const finalUrl = imgProxyService.generateUrlWithFallback(directUrl, {
          format: screenshotOptions.format as 'png' | 'jpeg' | 'webp',
          width: screenshotOptions.width,
          height: screenshotOptions.height
        })

        // Cache the result if caching is enabled and calculate expiration
        let expiresAt: string | null = null
        if (screenshotOptions.useCache) {
          await cacheService.set(cacheKey, finalUrl)
          // Calculate expiration time based on cache TTL
          const ttlSeconds = cacheService.getDefaultTtl()
          const expirationTime = new Date(Date.now() + (ttlSeconds * 1000))
          expiresAt = expirationTime.toISOString()
        }

        const processingTime = Date.now() - startTime

        logger.info('Screenshot processed successfully', {
          url: validatedData.url,
          finalUrl: finalUrl.substring(0, 100) + '...',
          processingTime,
          fileSizeBytes,
          cached: false
        })

        return response.json({
          success: true,
          screenshot_url: finalUrl,
          cache_hit: false,
          processing_time_ms: processingTime,
          file_size_bytes: fileSizeBytes,
          expires_at: expiresAt
        })

      } finally {
        // Always remove processing lock
        await cacheService.removeProcessingLock(validatedData.url)
      }

    } catch (error) {
      const processingTime = Date.now() - startTime

      logger.error('Screenshot processing failed', {
        url: request.input('url'),
        error: error.message,
        processingTime
      })

      // Handle validation errors
      if (error.messages) {
        return response.status(400).json({
          detail: {
            error: 'validation_failed',
            message: 'Request validation failed',
            errors: error.messages
          }
        })
      }

      // Handle timeout errors
      if (error.message.includes('timeout') || error.message.includes('Navigation timeout')) {
        return response.status(408).json({
          detail: {
            error: 'timeout',
            message: 'Screenshot capture timed out. The website may be slow to load or unresponsive.'
          }
        })
      }

      // Handle URL-related errors
      if (error.message.includes('HTTP 4') || error.message.includes('HTTP 5')) {
        return response.status(400).json({
          detail: {
            error: 'invalid_url',
            message: `Unable to access the provided URL: ${error.message}`
          }
        })
      }

      // Handle storage errors
      if (error.code === 'STORAGE_SAVE_FAILED') {
        return response.status(500).json({
          detail: {
            error: 'storage_error',
            message: 'Failed to save screenshot to storage'
          }
        })
      }

      // Generic error response
      return response.status(500).json({
        detail: {
          error: 'screenshot_failed',
          message: 'Failed to capture screenshot. Please try again later.'
        }
      })
    }
  }

  /**
   * @swagger
   * /batch/screenshots:
   *   post:
   *     summary: Create a batch screenshot job
   *     description: |
   *       Creates a batch job to capture screenshots of multiple URLs.
   *       Supports scheduled execution, webhooks, and priority processing.
   *       Maximum of 100 URLs per batch with configurable concurrency.
   *     tags:
   *       - Batch Screenshots
   *     security:
   *       - ApiKeyAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/BatchScreenshotRequest'
   *           examples:
   *             simple:
   *               summary: Simple batch job
   *               value:
   *                 urls:
   *                   - "https://example.com"
   *                   - "https://google.com"
   *                   - "https://github.com"
   *                 options:
   *                   format: "png"
   *                   width: 1280
   *                   height: 720
   *             scheduled:
   *               summary: Scheduled batch with webhook
   *               value:
   *                 urls:
   *                   - "https://example.com"
   *                   - "https://google.com"
   *                 options:
   *                   format: "jpeg"
   *                   width: 1920
   *                   height: 1080
   *                   fullPage: true
   *                 webhook_url: "https://your-app.com/webhook"
   *                 webhook_auth: "Bearer your-token"
   *                 scheduled_at: "2025-07-27T10:00:00Z"
   *                 priority: "high"
   *                 concurrency: 10
   *     responses:
   *       202:
   *         description: Batch job created successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/BatchJobResponse'
   *             example:
   *               success: true
   *               job_id: "batch_abc123def456"
   *               status: "pending"
   *               total_urls: 3
   *               estimated_completion: "2025-07-26T12:05:00Z"
   *       400:
   *         $ref: '#/components/responses/BadRequest'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       429:
   *         $ref: '#/components/responses/RateLimited'
   *       500:
   *         $ref: '#/components/responses/InternalError'
   */
  /**
   * Create a batch screenshot job
   * POST /batch/screenshots
   */
  async createBatch({ request, response }: HttpContext) {
    const startTime = Date.now()

    try {
      // Validate request data
      const validatedData = await validateBatchRequest(request.all())

      logger.info('Processing batch screenshot request', {
        itemCount: validatedData.items.length,
        config: validatedData.config
      })

      // Set defaults for batch configuration
      const batchConfig = {
        parallel: validatedData.config?.parallel || 3,
        timeout: validatedData.config?.timeout || 30000,
        webhook_url: validatedData.config?.webhook_url,
        webhook_auth: validatedData.config?.webhook_auth,
        fail_fast: validatedData.config?.fail_fast || false,
        cache: validatedData.config?.cache !== false, // Default to true
        priority: validatedData.config?.priority || 'normal',
        scheduled_time: validatedData.config?.scheduled_time,
        recurrence: validatedData.config?.recurrence,
        recurrence_interval: validatedData.config?.recurrence_interval,
        recurrence_count: validatedData.config?.recurrence_count,
        recurrence_cron: validatedData.config?.recurrence_cron,
        rate_limit: validatedData.config?.rate_limit
      }

      // Determine if this is a scheduled job
      let scheduledAt: DateTime | undefined
      if (batchConfig.scheduled_time) {
        scheduledAt = DateTime.fromISO(batchConfig.scheduled_time)
        if (!scheduledAt.isValid) {
          return response.status(400).json({
            detail: {
              error: 'invalid_scheduled_time',
              message: 'scheduled_time must be a valid ISO 8601 date string'
            }
          })
        }
      }

      // Create batch job in database
      const batchJob = await BatchJob.createBatchJob(
        validatedData.items.length,
        batchConfig,
        scheduledAt
      )

      // Initialize results array with pending status for all items
      const initialResults = validatedData.items.map(item => ({
        itemId: item.id,
        status: 'pending' as const,
        url: undefined,
        error: undefined,
        cached: undefined,
        processingTime: undefined
      }))

      batchJob.results = initialResults
      await batchJob.save()

      // Prepare batch job data for queue
      const batchJobData = {
        id: batchJob.id.toString(),
        items: validatedData.items.map(item => ({
          id: item.id,
          url: item.url,
          format: item.format || 'png',
          width: item.width || 1280,
          height: item.height || 720
        })),
        config: batchConfig,
        apiKeyId: 'placeholder' // This should come from auth middleware
      }

      // Add job to queue (scheduled or immediate)
      if (scheduledAt) {
        await queueService.scheduleJob('batch', batchJobData, scheduledAt.toJSDate())
        logger.info('Batch job scheduled', {
          batchId: batchJob.id,
          scheduledTime: scheduledAt.toISO()
        })
      } else {
        const priority = batchConfig.priority === 'high' ? 10 : batchConfig.priority === 'low' ? -10 : 0
        await queueService.addBatchJob(batchJobData, { priority })
        logger.info('Batch job queued', {
          batchId: batchJob.id,
          priority: batchConfig.priority
        })
      }

      const processingTime = Date.now() - startTime

      logger.info('Batch job created successfully', {
        batchId: batchJob.id,
        itemCount: validatedData.items.length,
        processingTime
      })

      // Return batch job status
      return response.status(202).json({
        job_id: batchJob.id.toString(),
        status: batchJob.status,
        total: batchJob.totalItems,
        completed: batchJob.completedItems,
        failed: batchJob.failedItems,
        priority: batchConfig.priority,
        created_at: batchJob.createdAt.toISO(),
        updated_at: batchJob.updatedAt?.toISO(),
        scheduled_time: batchJob.scheduledAt?.toISO(),
        next_scheduled_time: undefined, // TODO: Implement for recurring jobs
        estimated_completion: batchJob.estimatedCompletion?.toISO()
      })

    } catch (error) {
      const processingTime = Date.now() - startTime

      logger.error('Batch job creation failed', {
        error: error.message,
        processingTime
      })

      // Handle validation errors
      if (error.messages) {
        return response.status(400).json({
          detail: {
            error: 'validation_failed',
            message: 'Request validation failed',
            errors: error.messages
          }
        })
      }

      // Handle specific validation errors from custom validators
      if (error.message.includes('webhook_auth') ||
        error.message.includes('recurrence') ||
        error.message.includes('scheduled_time') ||
        error.message.includes('dimensions')) {
        return response.status(400).json({
          detail: {
            error: 'validation_failed',
            message: error.message
          }
        })
      }

      // Generic error response
      return response.status(500).json({
        detail: {
          error: 'batch_creation_failed',
          message: 'Failed to create batch job. Please try again later.'
        }
      })
    }
  }

  /**
   * @swagger
   * /batch/screenshots/{job_id}:
   *   get:
   *     summary: Get batch job status and results
   *     description: |
   *       Retrieves the current status of a batch screenshot job including
   *       progress information and download URLs for completed screenshots.
   *     tags:
   *       - Batch Screenshots
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - name: job_id
   *         in: path
   *         required: true
   *         description: Unique identifier of the batch job
   *         schema:
   *           type: string
   *           example: "batch_abc123def456"
   *     responses:
   *       200:
   *         description: Batch job status retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/BatchStatusResponse'
   *             examples:
   *               processing:
   *                 summary: Job in progress
   *                 value:
   *                   job_id: "batch_abc123def456"
   *                   status: "processing"
   *                   progress:
   *                     completed: 2
   *                     failed: 0
   *                     total: 5
   *                     percentage: 40
   *                   results:
   *                     - url: "https://example.com"
   *                       screenshot_url: "https://api.web2img.com/images/img1.png"
   *                       status: "completed"
   *                     - url: "https://google.com"
   *                       screenshot_url: "https://api.web2img.com/images/img2.png"
   *                       status: "completed"
   *                     - url: "https://github.com"
   *                       status: "pending"
   *                   created_at: "2025-07-26T10:00:00Z"
   *               completed:
   *                 summary: Job completed
   *                 value:
   *                   job_id: "batch_abc123def456"
   *                   status: "completed"
   *                   progress:
   *                     completed: 5
   *                     failed: 0
   *                     total: 5
   *                     percentage: 100
   *                   results:
   *                     - url: "https://example.com"
   *                       screenshot_url: "https://api.web2img.com/images/img1.png"
   *                       status: "completed"
   *                     - url: "https://google.com"
   *                       screenshot_url: "https://api.web2img.com/images/img2.png"
   *                       status: "completed"
   *                   created_at: "2025-07-26T10:00:00Z"
   *                   completed_at: "2025-07-26T10:02:30Z"
   *       400:
   *         $ref: '#/components/responses/BadRequest'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       404:
   *         description: Batch job not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *             example:
   *               detail:
   *                 error: "job_not_found"
   *                 message: "Batch job with the specified ID was not found"
   *       429:
   *         $ref: '#/components/responses/RateLimited'
   *       500:
   *         $ref: '#/components/responses/InternalError'
   */
  /**
   * Get batch job status
   * GET /batch/screenshots/{job_id}
   */
  async getBatchStatus({ params, response }: HttpContext) {
    try {
      const jobId = params.job_id

      if (!jobId) {
        return response.status(400).json({
          detail: {
            error: 'missing_job_id',
            message: 'job_id parameter is required'
          }
        })
      }

      // Find batch job by ID
      const batchJob = await BatchJob.find(parseInt(jobId))

      if (!batchJob) {
        return response.status(404).json({
          detail: {
            error: 'job_not_found',
            message: 'Batch job not found'
          }
        })
      }

      logger.debug('Retrieved batch job status', {
        jobId: batchJob.id,
        status: batchJob.status,
        progress: batchJob.progressPercentage
      })

      // Return comprehensive batch job status
      return response.json({
        job_id: batchJob.id.toString(),
        status: batchJob.status,
        total: batchJob.totalItems,
        completed: batchJob.completedItems,
        failed: batchJob.failedItems,
        progress_percentage: batchJob.progressPercentage,
        created_at: batchJob.createdAt.toISO(),
        updated_at: batchJob.updatedAt?.toISO(),
        scheduled_time: batchJob.scheduledAt?.toISO(),
        completed_at: batchJob.completedAt?.toISO(),
        estimated_completion: batchJob.estimatedCompletion?.toISO(),
        next_scheduled_time: batchJob.nextScheduledTime?.toISO(),
        config: batchJob.config,
        results: batchJob.results,
        successful_results: batchJob.successfulResults,
        failed_results: batchJob.failedResults
      })

    } catch (error) {
      logger.error('Failed to get batch job status', {
        jobId: params.job_id,
        error: error.message
      })

      return response.status(500).json({
        detail: {
          error: 'status_retrieval_failed',
          message: 'Failed to retrieve batch job status'
        }
      })
    }
  }
}