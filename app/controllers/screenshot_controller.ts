import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import {
  validateSingleScreenshotRequest,
  validateBatchRequest,
} from '#validators/screenshot_validator'
import cacheService from '#services/cache_service'
import { screenshotWorkerService } from '#services/screenshot_worker_service'
import fileStorageService from '#services/file_storage_service'
import imgProxyService from '#services/imgproxy_service'
import queueService from '#services/queue_service'
import BatchJob, { BatchJobStatus } from '#models/batch_job'
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
   *     description: Captures a screenshot of the specified website URL with customizable options.
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
        useCache: validatedData.cache !== false, // Default to true unless explicitly false
      }

      logger.info('Processing single screenshot request', {
        url: validatedData.url,
        options: screenshotOptions,
      })

      // Generate cache key
      const cacheKey = cacheService.generateCacheKey(validatedData.url, {
        format: screenshotOptions.format as 'png' | 'jpeg' | 'webp',
        width: screenshotOptions.width,
        height: screenshotOptions.height,
      })

      // Check cache if enabled
      let cachedUrl: string | null = null

      if (screenshotOptions.useCache) {
        cachedUrl = await cacheService.get(cacheKey)
        if (cachedUrl) {
          const processingTime = Date.now() - startTime

          logger.info('Returning cached screenshot', {
            url: validatedData.url,
            cacheKey: cacheKey.substring(0, 16) + '...',
            processingTime,
          })

          return response.json({
            url: cachedUrl,
          })
        }
      }

      // Check if URL is currently being processed to prevent duplicate work
      if (await cacheService.isProcessing(validatedData.url)) {
        return response.status(429).json({
          detail: {
            error: 'processing_in_progress',
            message: 'This URL is currently being processed. Please try again in a moment.',
          },
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
            fullPage: screenshotOptions.fullPage,
          },
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
          height: screenshotOptions.height,
        })

        // Cache the result if caching is enabled
        if (screenshotOptions.useCache) {
          await cacheService.set(cacheKey, finalUrl)
        }

        const processingTime = Date.now() - startTime

        logger.info('Screenshot processed successfully', {
          url: validatedData.url,
          finalUrl: finalUrl.substring(0, 100) + '...',
          processingTime,
          fileSizeBytes,
          cached: false,
        })

        return response.json({
          url: finalUrl,
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
        processingTime,
      })

      // Handle validation errors
      if (error.messages) {
        return response.status(400).json({
          detail: {
            error: 'validation_failed',
            message: 'Request validation failed',
            errors: error.messages,
          },
        })
      }

      // Handle timeout errors
      if (error.message.includes('timeout') || error.message.includes('Navigation timeout')) {
        return response.status(408).json({
          detail: {
            error: 'timeout',
            message:
              'Screenshot capture timed out. The website may be slow to load or unresponsive.',
          },
        })
      }

      // Handle URL-related errors
      if (error.message.includes('HTTP 4') || error.message.includes('HTTP 5')) {
        return response.status(400).json({
          detail: {
            error: 'invalid_url',
            message: `Unable to access the provided URL: ${error.message}`,
          },
        })
      }

      // Handle storage errors
      if (error.code === 'STORAGE_SAVE_FAILED') {
        return response.status(500).json({
          detail: {
            error: 'storage_error',
            message: 'Failed to save screenshot to storage',
          },
        })
      }

      // Generic error response
      return response.status(500).json({
        detail: {
          error: 'screenshot_failed',
          message: 'Failed to capture screenshot. Please try again later.',
        },
      })
    }
  }

  /**
   * @swagger
   * /batch/screenshots:
   *   post:
   *     summary: Create a batch screenshot job
   *     description: Creates a batch job to capture screenshots of multiple URLs with configurable options.
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
   *                 items:
   *                   - url: "https://example.com"
   *                     id: "example"
   *                     format: "png"
   *                     width: 1280
   *                     height: 720
   *                   - url: "https://google.com"
   *                     id: "google"
   *                   - url: "https://github.com"
   *                     id: "github"
   *             scheduled:
   *               summary: Scheduled batch with webhook
   *               value:
   *                 items:
   *                   - url: "https://example.com"
   *                     id: "example"
   *                     format: "jpeg"
   *                     width: 1920
   *                     height: 1080
   *                     fullPage: true
   *                   - url: "https://google.com"
   *                     id: "google"
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
   *               batch_id: 123
   *               status: "pending"
   *               total_items: 3
   *               estimated_completion: "2025-07-26T12:05:00Z"
   *               created_at: "2025-07-26T12:00:00Z"
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
  async createBatch(ctx: HttpContext) {
    const { request, response } = ctx
    const startTime = Date.now()

    try {
      // Validate request data
      const validatedData = await validateBatchRequest(request.all())

      logger.info('Processing batch screenshot request', {
        itemCount: validatedData.items.length,
        config: validatedData.config,
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
        recurrence: validatedData.config?.recurrence ? {
          pattern: validatedData.config.recurrence,
          interval: validatedData.config.recurrence_interval,
          count: validatedData.config.recurrence_count,
          cron: validatedData.config.recurrence_cron,
        } : undefined,
        rate_limit: validatedData.config?.rate_limit,
      }

      // Determine if this is a scheduled job
      let scheduledAt: DateTime | undefined
      if (batchConfig.scheduled_time) {
        scheduledAt = DateTime.fromISO(batchConfig.scheduled_time)
        if (!scheduledAt.isValid) {
          return response.status(400).json({
            detail: {
              error: 'invalid_scheduled_time',
              message: 'scheduled_time must be a valid ISO 8601 date string',
            },
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
      const initialResults = validatedData.items.map((item) => ({
        itemId: item.id,
        status: 'pending' as const,
        url: undefined,
        error: undefined,
        cached: undefined,
        processingTime: undefined,
      }))

      batchJob.results = initialResults
      await batchJob.save()

      // Prepare batch job data for queue

      // Create queue-compatible config (only include fields expected by BatchJobData interface)
      const queueConfig = {
        parallel: batchConfig.parallel,
        timeout: batchConfig.timeout,
        webhook: batchConfig.webhook_url,
        webhook_auth: batchConfig.webhook_auth,
        fail_fast: batchConfig.fail_fast,
        cache: batchConfig.cache,
        priority: batchConfig.priority,
      }

      const batchJobData = {
        id: batchJob.id.toString(),
        items: validatedData.items.map((item) => ({
          id: item.id,
          url: item.url,
          format: item.format || 'png',
          width: item.width || 1280,
          height: item.height || 720,
        })),
        config: queueConfig,
        apiKeyId: ctx.apiKey?.id?.toString() || 'unknown',
      }


      // Add job to queue (scheduled or immediate)

      if (scheduledAt) {
        try {
          await queueService.scheduleJob('batch', batchJobData, scheduledAt.toJSDate())
          logger.info('Batch job scheduled', {
            batchId: batchJob.id,
            scheduledTime: scheduledAt.toISO(),
          })
        } catch (queueError) {
          logger.error('Failed to schedule batch job', {
            error: queueError.message,
            stack: queueError.stack,
            batchJobData,
          })
          throw queueError
        }
      } else {
        const priority =
          batchConfig.priority === 'high' ? 10 : batchConfig.priority === 'low' ? -10 : 0
        await queueService.addBatchJob(batchJobData, { priority })
        logger.info('Batch job queued', {
          batchId: batchJob.id,
          priority: batchConfig.priority,
        })
      }


      const processingTime = Date.now() - startTime

      logger.info('Batch job created successfully', {
        batchId: batchJob.id,
        itemCount: validatedData.items.length,
        processingTime,
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
        estimated_completion: batchJob.estimatedCompletion?.toISO(),
      })
    } catch (error) {
      const processingTime = Date.now() - startTime

      logger.error('Batch job creation failed', {
        error: error.message,
        processingTime,
      })

      // Handle validation errors
      if (error.messages) {
        return response.status(400).json({
          detail: {
            error: 'validation_failed',
            message: 'Request validation failed',
            errors: error.messages,
          },
        })
      }

      // Handle specific validation errors from custom validators
      if (
        error.message.includes('webhook_auth') ||
        error.message.includes('recurrence') ||
        error.message.includes('scheduled_time') ||
        error.message.includes('dimensions')
      ) {
        return response.status(400).json({
          detail: {
            error: 'validation_failed',
            message: error.message,
          },
        })
      }

      // Generic error response
      return response.status(500).json({
        detail: {
          error: 'batch_creation_failed',
          message: 'Failed to create batch job. Please try again later.',
        },
      })
    }
  }

  /**
   * @swagger
   * /batch/screenshots/{batch_id}:
   *   get:
   *     summary: Get batch job status and results
   *     description: Retrieves the current status of a batch screenshot job including progress and results.
   *     tags:
   *       - Batch Screenshots
   *     security:
   *       - ApiKeyAuth: []
   *     parameters:
   *       - name: batch_id
   *         in: path
   *         required: true
   *         description: Unique identifier of the batch job
   *         schema:
   *           type: integer
   *           example: 123
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
   *                   batch_id: 123
   *                   status: "processing"
   *                   progress:
   *                     completed: 2
   *                     failed: 0
   *                     total: 3
   *                     percentage: 67
   *                   results:
   *                     - itemId: "example"
   *                       status: "success"
   *                       url: "https://api.web2img.com/images/img1.png"
   *                       cached: false
   *                       processingTime: 2500
   *                     - itemId: "google"
   *                       status: "success"
   *                       url: "https://api.web2img.com/images/img2.png"
   *                       cached: false
   *                       processingTime: 3200
   *                     - itemId: "github"
   *                       status: "error"
   *                       error: "Timeout after 30000ms"
   *                       cached: false
   *                       processingTime: 30000
   *                   created_at: "2025-07-26T10:00:00Z"
   *                   updated_at: "2025-07-26T10:01:30Z"
   *               completed:
   *                 summary: Job completed
   *                 value:
   *                   batch_id: 123
   *                   status: "completed"
   *                   progress:
   *                     completed: 2
   *                     failed: 1
   *                     total: 3
   *                     percentage: 100
   *                   results:
   *                     - itemId: "example"
   *                       status: "success"
   *                       url: "https://api.web2img.com/images/img1.png"
   *                       cached: false
   *                       processingTime: 2500
   *                     - itemId: "google"
   *                       status: "success"
   *                       url: "https://api.web2img.com/images/img2.png"
   *                       cached: false
   *                       processingTime: 3200
   *                   created_at: "2025-07-26T10:00:00Z"
   *                   updated_at: "2025-07-26T10:02:30Z"
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
   * @swagger
   * /batch/screenshots/active:
   *   get:
   *     summary: Get all active batch jobs
   *     description: Retrieves a list of all batch jobs that are currently processing or scheduled.
   *     tags:
   *       - Batch Screenshots
   *     security:
   *       - ApiKeyAuth: []
   *     responses:
   *       200:
   *         description: Active batch jobs retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 active_jobs:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/BatchStatusResponse'
   *                 total_active:
   *                   type: integer
   *                   description: Total number of active jobs
   *             example:
   *               success: true
   *               active_jobs:
   *                 - batch_id: 123
   *                   status: "processing"
   *                   progress:
   *                     completed: 2
   *                     failed: 0
   *                     total: 5
   *                     percentage: 40
   *                   created_at: "2025-07-26T10:00:00Z"
   *                 - batch_id: 124
   *                   status: "scheduled"
   *                   progress:
   *                     completed: 0
   *                     failed: 0
   *                     total: 3
   *                     percentage: 0
   *                   scheduled_at: "2025-07-26T15:00:00Z"
   *               total_active: 2
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       429:
   *         $ref: '#/components/responses/RateLimited'
   *       500:
   *         $ref: '#/components/responses/InternalError'
   */
  /**
   * Get active batch jobs
   * GET /batch/screenshots/active
   */
  async getActiveBatchJobs({ response }: HttpContext) {
    try {
      // Find all batch jobs with status 'processing' or 'scheduled'
      const activeJobs = await BatchJob.query()
        .whereIn('status', [BatchJobStatus.PROCESSING, BatchJobStatus.SCHEDULED])
        .orderBy('created_at', 'desc')

      logger.debug('Retrieved active batch jobs', {
        count: activeJobs.length,
      })

      // Format jobs for response
      const formattedJobs = activeJobs.map((job) => ({
        job_id: job.id.toString(),
        status: job.status,
        total: job.totalItems,
        completed: job.completedItems,
        failed: job.failedItems,
        created_at: job.createdAt.toISO(),
        updated_at: job.updatedAt?.toISO(),
        estimated_completion: job.estimatedCompletion?.toISO(),
        scheduled_time: job.scheduledAt?.toISO(),
        next_scheduled_time: job.nextScheduledTime?.toISO(),
      }))

      return response.json({
        jobs: formattedJobs,
      })
    } catch (error) {
      logger.error('Failed to get active batch jobs', {
        error: error.message,
      })

      return response.status(500).json({
        detail: {
          error: 'active_jobs_retrieval_failed',
          message: 'Failed to retrieve active batch jobs',
        },
      })
    }
  }

  /**
   * Schedule a batch job for future execution
   * POST /batch/screenshots/:job_id/schedule
   */
  async scheduleBatchJob({ params, request, response }: HttpContext) {
    try {
      const jobId = params.job_id
      const { scheduled_time } = request.only(['scheduled_time'])

      if (!jobId) {
        return response.status(400).json({
          detail: {
            error: 'missing_job_id',
            message: 'job_id parameter is required',
          },
        })
      }

      if (!scheduled_time) {
        return response.status(422).json({
          detail: {
            error: 'validation_failed',
            message: 'scheduled_time is required',
          },
        })
      }

      // Find batch job by ID
      const batchJob = await BatchJob.find(parseInt(jobId))

      if (!batchJob) {
        return response.status(404).json({
          detail: {
            error: 'job_not_found',
            message: 'Batch job not found',
          },
        })
      }

      // Validate scheduled_time format and ensure it's in the future
      const scheduledDateTime = DateTime.fromISO(scheduled_time)
      if (!scheduledDateTime.isValid) {
        return response.status(422).json({
          detail: {
            error: 'validation_failed',
            message: 'scheduled_time must be a valid ISO 8601 date string',
            errors: ['scheduled_time must be a valid ISO 8601 date string'],
          },
        })
      }

      if (scheduledDateTime <= DateTime.now()) {
        return response.status(400).json({
          detail: {
            error: 'invalid_scheduled_time',
            message: 'scheduled_time must be in the future',
          },
        })
      }

      // Check if job is in a valid state for scheduling
      if (batchJob.status === BatchJobStatus.PROCESSING) {
        return response.status(400).json({
          detail: {
            error: 'job_already_processing',
            message: 'Cannot schedule a job that is already processing',
          },
        })
      }

      if (batchJob.status === BatchJobStatus.COMPLETED) {
        return response.status(400).json({
          detail: {
            error: 'job_already_completed',
            message: 'Cannot schedule a job that is already completed',
          },
        })
      }

      // Update job with scheduled time
      batchJob.scheduledAt = scheduledDateTime
      batchJob.status = BatchJobStatus.SCHEDULED
      await batchJob.save()

      // TODO: Add job to queue with scheduled time
      // await queueService.scheduleJob('batch', batchJobData, scheduledDateTime.toJSDate())

      logger.info('Batch job scheduled successfully', {
        jobId: batchJob.id,
        scheduledTime: scheduledDateTime.toISO(),
      })

      // Return updated job status
      return response.status(202).json({
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
        failed_results: batchJob.failedResults,
      })
    } catch (error) {
      logger.error('Failed to schedule batch job', {
        jobId: params.job_id,
        error: error.message,
      })

      return response.status(500).json({
        detail: {
          error: 'scheduling_failed',
          message: 'Failed to schedule batch job',
        },
      })
    }
  }

  /**
   * Set recurrence configuration for a batch job
   * POST /batch/screenshots/:job_id/recurrence
   */
  async setBatchJobRecurrence({ params, request, response }: HttpContext) {
    try {
      const jobId = params.job_id
      const { pattern, interval, count, cron } = request.only([
        'pattern',
        'interval',
        'count',
        'cron',
      ])

      if (!jobId) {
        return response.status(400).json({
          detail: {
            error: 'missing_job_id',
            message: 'job_id parameter is required',
          },
        })
      }

      if (!pattern) {
        return response.status(422).json({
          detail: {
            error: 'validation_failed',
            message: 'pattern is required',
          },
        })
      }

      // Validate pattern values
      const validPatterns = ['hourly', 'daily', 'weekly', 'monthly', 'custom']
      if (!validPatterns.includes(pattern)) {
        return response.status(422).json({
          detail: {
            error: 'validation_failed',
            message: `pattern must be one of: ${validPatterns.join(', ')}`,
            errors: [`pattern must be one of: ${validPatterns.join(', ')}`],
          },
        })
      }

      // Validate cron expression for custom pattern
      if (pattern === 'custom') {
        if (!cron) {
          return response.status(422).json({
            detail: {
              error: 'validation_failed',
              message: 'cron expression is required when pattern is "custom"',
              errors: ['cron expression is required when pattern is "custom"'],
            },
          })
        }

        // Basic cron validation (5 or 6 fields)
        const cronParts = cron.trim().split(/\s+/)
        if (cronParts.length < 5 || cronParts.length > 6) {
          return response.status(422).json({
            detail: {
              error: 'validation_failed',
              message: 'cron expression must have 5 or 6 fields',
              errors: ['cron expression must have 5 or 6 fields'],
            },
          })
        }
      }

      // Validate interval and count if provided
      if (interval !== undefined && (typeof interval !== 'number' || interval <= 0)) {
        return response.status(422).json({
          detail: {
            error: 'invalid_interval',
            message: 'interval must be a positive number',
          },
        })
      }

      if (count !== undefined && (typeof count !== 'number' || count <= 0)) {
        return response.status(422).json({
          detail: {
            error: 'invalid_count',
            message: 'count must be a positive number',
          },
        })
      }

      // Find batch job by ID
      const batchJob = await BatchJob.find(parseInt(jobId))

      if (!batchJob) {
        return response.status(404).json({
          detail: {
            error: 'job_not_found',
            message: 'Batch job not found',
          },
        })
      }

      // Update job config with recurrence settings
      const updatedConfig = {
        ...batchJob.config,
        recurrence: {
          pattern: pattern,
          interval: interval,
          count: count,
          cron: cron,
        },
      }

      batchJob.config = updatedConfig
      await batchJob.save()

      logger.info('Batch job recurrence configured successfully', {
        jobId: batchJob.id,
        pattern,
        interval,
        count,
        cron: cron ? cron.substring(0, 20) + '...' : undefined,
      })

      // Return updated job status
      return response.status(202).json({
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
        failed_results: batchJob.failedResults,
      })
    } catch (error) {
      logger.error('Failed to set batch job recurrence', {
        jobId: params.job_id,
        error: error.message,
      })

      return response.status(500).json({
        detail: {
          error: 'recurrence_configuration_failed',
          message: 'Failed to configure batch job recurrence',
        },
      })
    }
  }

  /**
   * Cancel a batch job
   * POST /batch/screenshots/:job_id/cancel
   */
  async cancelBatchJob({ params, response }: HttpContext) {
    try {
      const jobId = params.job_id

      if (!jobId) {
        return response.status(400).json({
          detail: {
            error: 'missing_job_id',
            message: 'job_id parameter is required',
          },
        })
      }

      // Find batch job by ID
      const batchJob = await BatchJob.find(parseInt(jobId))

      if (!batchJob) {
        return response.status(404).json({
          detail: {
            error: 'job_not_found',
            message: 'Batch job not found',
          },
        })
      }

      // Check if job is in a valid state for cancellation
      if (batchJob.status === BatchJobStatus.COMPLETED) {
        return response.status(400).json({
          detail: {
            error: 'job_already_completed',
            message: 'Cannot cancel a job that is already completed',
          },
        })
      }

      if (batchJob.status === BatchJobStatus.FAILED) {
        return response.status(400).json({
          detail: {
            error: 'job_already_failed',
            message: 'Cannot cancel a job that has already failed',
          },
        })
      }

      if (batchJob.status === BatchJobStatus.CANCELLED) {
        return response.status(400).json({
          detail: {
            error: 'job_already_cancelled',
            message: 'Job is already cancelled',
          },
        })
      }

      // Cancel the job
      await batchJob.cancel()

      // TODO: Remove job from queue if it's scheduled or pending
      // await queueService.removeJob(batchJob.id.toString())

      // Update any pending results to cancelled
      const updatedResults = batchJob.results.map((result) =>
        result.status === 'pending' || result.status === 'processing'
          ? { ...result, status: 'error' as const, error: 'Job cancelled' }
          : result
      )
      batchJob.results = updatedResults
      await batchJob.save()

      logger.info('Batch job cancelled successfully', {
        jobId: batchJob.id,
        previousStatus: batchJob.status,
      })

      // Return updated job status
      return response.status(200).json({
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
        failed_results: batchJob.failedResults,
      })
    } catch (error) {
      logger.error('Failed to cancel batch job', {
        jobId: params.job_id,
        error: error.message,
      })

      return response.status(500).json({
        detail: {
          error: 'cancellation_failed',
          message: 'Failed to cancel batch job',
        },
      })
    }
  }

  /**
   * Get detailed batch job results
   * GET /batch/screenshots/:job_id/results
   */
  async getBatchJobResults({ params, response }: HttpContext) {
    try {
      const jobId = params.job_id

      if (!jobId) {
        return response.status(400).json({
          detail: {
            error: 'missing_job_id',
            message: 'job_id parameter is required',
          },
        })
      }

      // Find batch job by ID
      const batchJob = await BatchJob.find(parseInt(jobId))

      if (!batchJob) {
        return response.status(404).json({
          detail: {
            error: 'job_not_found',
            message: 'Batch job not found',
          },
        })
      }

      // Calculate processing time
      let processingTime = 0
      if (batchJob.completedAt && batchJob.createdAt) {
        processingTime = batchJob.completedAt.diff(batchJob.createdAt).as('milliseconds')
      } else if (batchJob.status === BatchJobStatus.PROCESSING) {
        processingTime = DateTime.now().diff(batchJob.createdAt).as('milliseconds')
      }

      // Format results for response
      const formattedResults = batchJob.results.map((result) => ({
        id: result.itemId,
        status: result.status,
        url: result.url,
        error: result.error,
        cached: result.cached,
      }))

      logger.debug('Retrieved batch job results', {
        jobId: batchJob.id,
        totalResults: formattedResults.length,
        succeeded: batchJob.successfulResults.length,
        failed: batchJob.failedResults.length,
      })

      return response.json({
        job_id: batchJob.id.toString(),
        status: batchJob.status,
        total: batchJob.totalItems,
        succeeded: batchJob.successfulResults.length,
        failed: batchJob.failedResults.length,
        processing_time: Math.round(processingTime / 1000 * 100) / 100, // Convert to seconds with 2 decimal places
        results: formattedResults,
      })
    } catch (error) {
      logger.error('Failed to get batch job results', {
        jobId: params.job_id,
        error: error.message,
      })

      return response.status(500).json({
        detail: {
          error: 'results_retrieval_failed',
          message: 'Failed to retrieve batch job results',
        },
      })
    }
  }

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
            message: 'job_id parameter is required',
          },
        })
      }

      // Find batch job by ID
      const batchJob = await BatchJob.find(parseInt(jobId))

      if (!batchJob) {
        return response.status(404).json({
          detail: {
            error: 'job_not_found',
            message: 'Batch job not found',
          },
        })
      }

      logger.debug('Retrieved batch job status', {
        jobId: batchJob.id,
        status: batchJob.status,
        progress: batchJob.progressPercentage,
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
        failed_results: batchJob.failedResults,
      })
    } catch (error) {
      logger.error('Failed to get batch job status', {
        jobId: params.job_id,
        error: error.message,
      })

      return response.status(500).json({
        detail: {
          error: 'status_retrieval_failed',
          message: 'Failed to retrieve batch job status',
        },
      })
    }
  }

  /**
   * @swagger
   * /cache/stats:
   *   get:
   *     summary: Get cache statistics
   *     description: Retrieves detailed statistics about the cache system including hit rates and memory usage.
   *     tags:
   *       - Cache Management
   *     security:
   *       - ApiKeyAuth: []
   *     responses:
   *       200:
   *         description: Cache statistics retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 cache_stats:
   *                   type: object
   *                   properties:
   *                     enabled:
   *                       type: boolean
   *                       description: Whether caching is enabled
   *                     hit_rate:
   *                       type: number
   *                       description: Cache hit rate percentage
   *                     total_requests:
   *                       type: integer
   *                       description: Total number of cache requests
   *                     hits:
   *                       type: integer
   *                       description: Number of cache hits
   *                     misses:
   *                       type: integer
   *                       description: Number of cache misses
   *                     memory_usage:
   *                       type: object
   *                       properties:
   *                         used:
   *                           type: integer
   *                           description: Used memory in bytes
   *                         available:
   *                           type: integer
   *                           description: Available memory in bytes
   *             example:
   *               success: true
   *               cache_stats:
   *                 enabled: true
   *                 hit_rate: 85.5
   *                 total_requests: 1000
   *                 hits: 855
   *                 misses: 145
   *                 memory_usage:
   *                   used: 52428800
   *                   available: 134217728
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       429:
   *         $ref: '#/components/responses/RateLimited'
   *       500:
   *         $ref: '#/components/responses/InternalError'
   */
  /**
   * Get cache statistics
   * GET /cache/stats
   */
  async getCacheStats({ response }: HttpContext) {
    try {
      const stats = await cacheService.getEnhancedStats()

      logger.debug('Retrieved cache statistics', {
        enabled: stats.enabled,
        size: stats.size,
        hits: stats.hits,
        misses: stats.misses,
        hit_rate: stats.hit_rate,
      })

      return response.json(stats)
    } catch (error) {
      logger.error('Failed to get cache statistics', {
        error: error.message,
      })

      return response.status(500).json({
        detail: {
          error: 'cache_stats_failed',
          message: 'Failed to retrieve cache statistics',
        },
      })
    }
  }

  /**
   * @swagger
   * /cache:
   *   delete:
   *     summary: Clear entire cache
   *     description: Clears all cached screenshots and resets cache statistics.
   *     tags:
   *       - Cache Management
   *     security:
   *       - ApiKeyAuth: []
   *     responses:
   *       200:
   *         description: Cache cleared successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   *             example:
   *               success: true
   *               message: "Cache cleared successfully"
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       429:
   *         $ref: '#/components/responses/RateLimited'
   *       500:
   *         $ref: '#/components/responses/InternalError'
   */
  /**
   * Clear entire cache
   * DELETE /cache
   */
  async clearCache({ response }: HttpContext) {
    try {
      await cacheService.flush()

      logger.info('Cache cleared successfully')

      return response.status(204).send('')
    } catch (error) {
      logger.error('Failed to clear cache', {
        error: error.message,
      })

      return response.status(500).json({
        detail: {
          error: 'cache_clear_failed',
          message: 'Failed to clear cache',
        },
      })
    }
  }

  /**
   * @swagger
   * /cache/url:
   *   delete:
   *     summary: Invalidate cache entries for a specific URL
   *     description: Removes all cached screenshots for a specific URL.
   *     tags:
   *       - Cache Management
   *     security:
   *       - ApiKeyAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               url:
   *                 type: string
   *                 format: uri
   *                 description: URL to invalidate from cache
   *                 example: "https://example.com"
   *             required:
   *               - url
   *     responses:
   *       200:
   *         description: Cache entries invalidated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   *                 invalidated_entries:
   *                   type: integer
   *                   description: Number of cache entries removed
   *             example:
   *               success: true
   *               message: "Cache entries for URL invalidated successfully"
   *               invalidated_entries: 3
   *       422:
   *         description: Validation Error - URL is required
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *             example:
   *               detail:
   *                 error: "VALIDATION_ERROR"
   *                 message: "URL is required"
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       429:
   *         $ref: '#/components/responses/RateLimited'
   *       500:
   *         $ref: '#/components/responses/InternalError'
   */
  /**
   * Invalidate cache entries for a specific URL
   * DELETE /cache/url
   */
  async invalidateCacheUrl({ request, response }: HttpContext) {
    try {
      const url = request.input('url')

      if (!url) {
        return response.status(422).json({
          detail: {
            error: 'validation_failed',
            message: 'url parameter is required',
          },
        })
      }

      // Validate URL format
      try {
        new URL(url)
      } catch (urlError) {
        return response.status(422).json({
          detail: {
            error: 'validation_failed',
            message: 'url parameter must be a valid URL',
          },
        })
      }

      const invalidatedCount = await cacheService.invalidateByUrl(url)

      logger.info('Cache invalidated for URL', {
        url,
        invalidatedCount,
      })

      return response.json({
        invalidated: invalidatedCount,
      })
    } catch (error) {
      logger.error('Failed to invalidate cache for URL', {
        url: request.input('url'),
        error: error.message,
      })

      return response.status(500).json({
        detail: {
          error: 'cache_invalidation_failed',
          message: 'Failed to invalidate cache entries for URL',
        },
      })
    }
  }
}
