/**
 * Core types and interfaces for the screenshot system
 */

export type ScreenshotFormat = 'png' | 'jpeg' | 'webp'
export type BatchJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'scheduled'
export type BatchItemStatus = 'success' | 'error' | 'pending' | 'processing'
export type JobPriority = 'high' | 'normal' | 'low'
export type RecurrencePattern = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'

/**
 * Single screenshot request interface
 */
export interface SingleScreenshotRequest {
    url: string
    format?: ScreenshotFormat
    width?: number // 1-5000
    height?: number // 1-5000
    timeout?: number // 5-60 seconds
    cache?: boolean
}

/**
 * Single screenshot response interface
 */
export interface SingleScreenshotResponse {
    url: string // ImgProxy URL
    cached?: boolean
    processingTime?: number
}

/**
 * Batch screenshot item interface
 */
export interface BatchItem {
    id: string
    url: string
    format?: ScreenshotFormat
    width?: number
    height?: number
}

/**
 * Batch configuration interface
 */
export interface BatchConfig {
    parallel?: number // 1-50, default 3
    timeout?: number // 5-60 seconds, default 30
    webhook?: string
    webhook_auth?: string
    fail_fast?: boolean
    cache?: boolean
    priority?: JobPriority
    scheduled_time?: string // ISO 8601
    recurrence?: RecurrencePattern
    recurrence_interval?: number
    recurrence_count?: number
    recurrence_cron?: string
    rate_limit?: number
}

/**
 * Batch screenshot request interface
 */
export interface BatchScreenshotRequest {
    items: BatchItem[]
    config?: BatchConfig
}

/**
 * Batch job result interface
 */
export interface BatchResult {
    itemId: string
    status: BatchItemStatus
    url?: string
    error?: string
    cached?: boolean
    processingTime?: number
}

/**
 * Batch screenshot response interface
 */
export interface BatchResponse {
    job_id: string
    status: BatchJobStatus
    total: number
    completed: number
    failed: number
    created_at: string
    updated_at: string
    scheduled_time?: string
    next_scheduled_time?: string
    estimated_completion?: string
    results?: BatchResult[]
}

/**
 * Screenshot parameters for internal processing
 */
export interface ScreenshotParams {
    url: string
    format: ScreenshotFormat
    width: number
    height: number
    timeout: number
    useCache: boolean
}

/**
 * Screenshot result for internal processing
 */
export interface ScreenshotResult {
    imageUrl: string
    cached: boolean
    processingTime?: number
}

/**
 * Page options for browser configuration
 */
export interface PageOptions {
    width: number
    height: number
    timeout: number
}

/**
 * Screenshot capture options
 */
export interface ScreenshotOptions {
    format: ScreenshotFormat
    quality?: number
}

/**
 * ImgProxy options for URL generation
 */
export interface ImgProxyOptions {
    width?: number
    height?: number
    format?: string
    quality?: number
    resize?: 'fit' | 'fill' | 'crop'
}

/**
 * Webhook configuration
 */
export interface WebhookConfig {
    url: string
    auth?: string
    maxRetries: number
}

/**
 * Webhook data for delivery
 */
export interface WebhookData {
    url: string
    payload: any
    auth?: string
    maxRetries: number
}

/**
 * Recurrence configuration
 */
export interface RecurrenceConfig {
    pattern: RecurrencePattern
    interval?: number
    count?: number
    cron?: string
}

/**
 * Job status information
 */
export interface JobStatus {
    id: string
    status: BatchJobStatus
    progress: {
        total: number
        completed: number
        failed: number
    }
    createdAt: Date
    updatedAt: Date
    completedAt?: Date
}

/**
 * Queue metrics
 */
export interface QueueMetrics {
    waiting: number
    active: number
    completed: number
    failed: number
    delayed: number
}

/**
 * Cache statistics
 */
export interface CacheStats {
    hits: number
    misses: number
    keys: number
    memory: number
}