import vine from '@vinejs/vine'

/**
 * Validation schema for single screenshot requests
 */
export const singleScreenshotValidator = vine.compile(
  vine.object({
    url: vine.string().url().trim(),
    format: vine.enum(['png', 'jpeg', 'webp']).optional(),
    width: vine.number().min(1).max(5000).optional(),
    height: vine.number().min(1).max(5000).optional(),
    timeout: vine.number().min(5000).max(60000).optional(), // 5 seconds to 1 minute
    fullPage: vine.boolean().optional(),
    cache: vine.boolean().optional()
  })
)

/**
 * Validation schema for batch item
 */
export const batchItemValidator = vine.object({
  id: vine.string().trim().minLength(1),
  url: vine.string().url().trim(),
  format: vine.enum(['png', 'jpeg', 'webp']).optional(),
  width: vine.number().min(1).max(5000).optional(),
  height: vine.number().min(1).max(5000).optional()
})

/**
 * Validation schema for batch configuration
 */
export const batchConfigValidator = vine.object({
  parallel: vine.number().min(1).max(50).optional(),
  timeout: vine.number().min(5000).max(60000).optional(), // 5 seconds to 1 minute
  webhook_url: vine.string().url().optional(),
  webhook_auth: vine.string().optional(),
  fail_fast: vine.boolean().optional(),
  cache: vine.boolean().optional(),
  priority: vine.enum(['high', 'normal', 'low']).optional(),
  scheduled_time: vine.string().optional(),
  recurrence: vine.enum(['hourly', 'daily', 'weekly', 'monthly', 'custom']).optional(),
  recurrence_interval: vine.number().min(1).optional(),
  recurrence_count: vine.number().min(1).optional(),
  recurrence_cron: vine.string().optional(),
  rate_limit: vine.number().min(1).optional()
})

/**
 * Validation schema for batch screenshot requests
 */
export const batchScreenshotValidator = vine.compile(
  vine.object({
    items: vine.array(batchItemValidator).minLength(1).maxLength(200),
    config: batchConfigValidator.optional()
  })
)

/**
 * Validation schema for batch job status request
 */
export const batchStatusValidator = vine.compile(
  vine.object({
    job_id: vine.string().trim().minLength(1)
  })
)

/**
 * Custom validation rules
 */

/**
 * Validate that webhook_auth is provided when webhook_url is provided
 */
export const validateWebhookAuth = (data: any) => {
  if (data.config?.webhook_url && !data.config?.webhook_auth) {
    throw new Error('webhook_auth is required when webhook_url is provided')
  }
}

/**
 * Validate recurrence configuration
 */
export const validateRecurrence = (data: any) => {
  const config = data.config
  if (!config) return

  // If recurrence is 'custom', recurrence_cron is required
  if (config.recurrence === 'custom' && !config.recurrence_cron) {
    throw new Error('recurrence_cron is required when recurrence is "custom"')
  }

  // If recurrence is not 'custom', recurrence_interval can be used
  if (config.recurrence && config.recurrence !== 'custom' && config.recurrence_cron) {
    throw new Error('recurrence_cron can only be used when recurrence is "custom"')
  }

  // Validate recurrence_count is reasonable
  if (config.recurrence_count && config.recurrence_count > 1000) {
    throw new Error('recurrence_count cannot exceed 1000')
  }
}

/**
 * Validate scheduled time is in the future
 */
export const validateScheduledTime = (data: any) => {
  if (data.config?.scheduled_time) {
    const scheduledTime = new Date(data.config.scheduled_time)
    const now = new Date()
    
    if (scheduledTime <= now) {
      throw new Error('scheduled_time must be in the future')
    }
  }
}

/**
 * Validate dimensions are reasonable for batch processing
 */
export const validateBatchDimensions = (data: any) => {
  if (!data.items) return

  for (const item of data.items) {
    if (item.width && item.height) {
      const pixels = item.width * item.height
      // Limit to 25 megapixels for batch processing
      if (pixels > 25000000) {
        throw new Error(`Item ${item.id}: dimensions too large (max 25 megapixels)`)
      }
    }
  }
}

/**
 * Comprehensive batch validation function
 */
export const validateBatchRequest = async (data: any) => {
  // First run the schema validation
  const validated = await batchScreenshotValidator.validate(data)
  
  // Then run custom validations
  validateWebhookAuth(validated)
  validateRecurrence(validated)
  validateScheduledTime(validated)
  validateBatchDimensions(validated)
  
  return validated
}

/**
 * Comprehensive single screenshot validation function
 */
export const validateSingleScreenshotRequest = async (data: any) => {
  const validated = await singleScreenshotValidator.validate(data)
  
  // Additional validation for single requests
  if (validated.width && validated.height) {
    const pixels = validated.width * validated.height
    // Limit to 50 megapixels for single requests
    if (pixels > 50000000) {
      throw new Error('dimensions too large (max 50 megapixels)')
    }
  }
  
  return validated
}