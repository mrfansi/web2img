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
    cache: vine.boolean().optional(),
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
  height: vine.number().min(1).max(5000).optional(),
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
  rate_limit: vine.number().min(1).optional(),
})

/**
 * Validation schema for batch screenshot requests
 */
export const batchScreenshotValidator = vine.compile(
  vine.object({
    items: vine.array(batchItemValidator).minLength(1).maxLength(200),
    config: batchConfigValidator.optional(),
  })
)

/**
 * Validation schema for batch job status request
 */
export const batchStatusValidator = vine.compile(
  vine.object({
    job_id: vine.string().trim().minLength(1),
  })
)

/**
 * Validation schema for cache URL invalidation query parameter
 */
export const cacheUrlValidator = vine.compile(
  vine.object({
    url: vine.string().trim().minLength(1),
  })
)

/**
 * Validation schema for job scheduling request
 */
export const scheduleJobValidator = vine.compile(
  vine.object({
    scheduled_time: vine.string().trim().minLength(1),
  })
)

/**
 * Validation schema for job recurrence request
 */
export const recurrenceValidator = vine.compile(
  vine.object({
    pattern: vine.enum(['hourly', 'daily', 'weekly', 'monthly', 'custom']),
    interval: vine.number().min(1).optional(),
    count: vine.number().min(1).optional(),
    cron: vine.string().trim().optional(),
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

/**
 * Validate scheduled time format and ensure it's in the future
 */
export const validateScheduledTimeFormat = (scheduledTime: string) => {
  // Validate ISO 8601 format
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/
  if (!iso8601Regex.test(scheduledTime)) {
    throw new Error('scheduled_time must be in valid ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)')
  }

  // Parse and validate the date
  const scheduledDate = new Date(scheduledTime)
  if (isNaN(scheduledDate.getTime())) {
    throw new Error('scheduled_time must be a valid date')
  }

  // Ensure it's in the future
  const now = new Date()
  if (scheduledDate <= now) {
    throw new Error('scheduled_time must be in the future')
  }

  return scheduledDate
}

/**
 * Comprehensive schedule job validation function
 */
export const validateScheduleJobRequest = async (data: any, jobId?: string) => {
  // First run the schema validation
  const validated = await scheduleJobValidator.validate(data)

  // Validate scheduled time format and future constraint
  validateScheduledTimeFormat(validated.scheduled_time)

  // If jobId is provided, we could add job existence validation here
  // This would require database access, so it's typically done in the controller
  if (jobId && !jobId.trim()) {
    throw new Error('job_id is required and cannot be empty')
  }

  return validated
}

/**
 * Validate cron expression format (basic validation)
 */
export const validateCronExpression = (cronExpression: string) => {
  // Basic cron validation - should have 5 or 6 parts separated by spaces
  const parts = cronExpression.trim().split(/\s+/)
  
  if (parts.length < 5 || parts.length > 6) {
    throw new Error('cron expression must have 5 or 6 parts (minute hour day month weekday [year])')
  }

  // Validate each part contains valid characters
  const cronRegex = /^[0-9\*\-\,\/\?LW#]+$/
  for (let i = 0; i < parts.length; i++) {
    if (!cronRegex.test(parts[i])) {
      throw new Error(`invalid cron expression: part ${i + 1} contains invalid characters`)
    }
  }

  // Basic range validation for common patterns
  const [minute, hour, day, month, weekday] = parts
  
  // Validate minute (0-59)
  if (minute !== '*' && !minute.includes(',') && !minute.includes('/') && !minute.includes('-')) {
    const min = parseInt(minute)
    if (!isNaN(min) && (min < 0 || min > 59)) {
      throw new Error('minute must be between 0 and 59')
    }
  }

  // Validate hour (0-23)
  if (hour !== '*' && !hour.includes(',') && !hour.includes('/') && !hour.includes('-')) {
    const hr = parseInt(hour)
    if (!isNaN(hr) && (hr < 0 || hr > 23)) {
      throw new Error('hour must be between 0 and 23')
    }
  }

  // Validate day (1-31)
  if (day !== '*' && !day.includes(',') && !day.includes('/') && !day.includes('-') && day !== '?') {
    const d = parseInt(day)
    if (!isNaN(d) && (d < 1 || d > 31)) {
      throw new Error('day must be between 1 and 31')
    }
  }

  // Validate month (1-12)
  if (month !== '*' && !month.includes(',') && !month.includes('/') && !month.includes('-')) {
    const m = parseInt(month)
    if (!isNaN(m) && (m < 1 || m > 12)) {
      throw new Error('month must be between 1 and 12')
    }
  }

  // Validate weekday (0-7, where 0 and 7 are Sunday)
  if (weekday !== '*' && !weekday.includes(',') && !weekday.includes('/') && !weekday.includes('-') && weekday !== '?') {
    const wd = parseInt(weekday)
    if (!isNaN(wd) && (wd < 0 || wd > 7)) {
      throw new Error('weekday must be between 0 and 7')
    }
  }

  return true
}

/**
 * Validate recurrence configuration
 */
export const validateRecurrenceConfig = (data: any) => {
  const { pattern, interval, count, cron } = data

  // If pattern is 'custom', cron is required
  if (pattern === 'custom') {
    if (!cron) {
      throw new Error('cron expression is required when pattern is "custom"')
    }
    validateCronExpression(cron)
  } else {
    // For non-custom patterns, cron should not be provided
    if (cron) {
      throw new Error('cron expression can only be used when pattern is "custom"')
    }
  }

  // Validate interval is positive when provided
  if (interval !== undefined && interval <= 0) {
    throw new Error('interval must be a positive integer')
  }

  // Validate count is positive when provided
  if (count !== undefined && count <= 0) {
    throw new Error('count must be a positive integer')
  }

  // Reasonable limits
  if (interval && interval > 1000) {
    throw new Error('interval cannot exceed 1000')
  }

  if (count && count > 10000) {
    throw new Error('count cannot exceed 10000')
  }

  return true
}

/**
 * Comprehensive recurrence validation function
 */
export const validateRecurrenceRequest = async (data: any, jobId?: string) => {
  // First run the schema validation
  const validated = await recurrenceValidator.validate(data)

  // Validate recurrence configuration
  validateRecurrenceConfig(validated)

  // If jobId is provided, validate it's not empty
  if (jobId && !jobId.trim()) {
    throw new Error('job_id is required and cannot be empty')
  }

  return validated
}

/**
 * Validate URL format for cache invalidation
 */
export const validateCacheUrl = (url: string) => {
  // Check if URL is provided
  if (!url || !url.trim()) {
    throw new Error('url parameter is required')
  }

  const trimmedUrl = url.trim()

  // Validate URL format using URL constructor
  try {
    const parsedUrl = new URL(trimmedUrl)
    
    // Ensure it's HTTP or HTTPS
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('url must be a valid HTTP or HTTPS URL')
    }

    // Ensure hostname is present
    if (!parsedUrl.hostname) {
      throw new Error('url must contain a valid hostname')
    }

    // Basic hostname validation (no spaces, valid characters)
    const hostnameRegex = /^[a-zA-Z0-9.-]+$/
    if (!hostnameRegex.test(parsedUrl.hostname)) {
      throw new Error('url contains invalid hostname characters')
    }

    return parsedUrl.href
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('url must be a valid HTTP or HTTPS URL')
    }
    throw error
  }
}

/**
 * Comprehensive cache URL validation function
 */
export const validateCacheUrlRequest = async (data: any) => {
  // First run the schema validation
  const validated = await cacheUrlValidator.validate(data)

  // Validate URL format and protocol
  const validatedUrl = validateCacheUrl(validated.url)

  return {
    ...validated,
    url: validatedUrl
  }
}
