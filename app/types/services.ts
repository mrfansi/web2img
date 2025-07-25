/**
 * Service interfaces for the screenshot system
 */

import type { Job } from 'bullmq'
import type { Browser, Page } from 'playwright'
import type {
  ScreenshotParams,
  ScreenshotResult,
  BatchScreenshotRequest,
  BatchResponse,
  PageOptions,
  ScreenshotOptions,
  ImgProxyOptions,
  WebhookData,
  JobStatus,
  QueueMetrics,
  CacheStats,
  RecurrenceConfig
} from './screenshot.js'

/**
 * Screenshot service interface
 */
export interface ScreenshotService {
  captureScreenshot(params: ScreenshotParams): Promise<ScreenshotResult>
  createBatchJob(request: BatchScreenshotRequest): Promise<BatchResponse>
  getBatchJobStatus(jobId: string): Promise<BatchResponse>
  transformUrl(originalUrl: string): string
  getCachedScreenshot(cacheKey: string): Promise<string | null>
  setCachedScreenshot(cacheKey: string, imageUrl: string, ttl: number): Promise<void>
}

/**
 * Queue service interface
 */
export interface QueueService {
  addScreenshotJob(params: ScreenshotJobData): Promise<Job>
  addBatchJob(batchData: BatchJobData): Promise<Job>
  scheduleJob(jobData: any, scheduledTime: Date): Promise<Job>
  createRecurringJob(jobData: any, recurrence: RecurrenceConfig): Promise<Job>
  getJobStatus(jobId: string): Promise<JobStatus>
  getQueueMetrics(): Promise<QueueMetrics>
}

/**
 * Screenshot job data interface
 */
export interface ScreenshotJobData {
  url: string
  format: string
  width: number
  height: number
  timeout: number
  cacheKey: string
  batchId?: string
  itemId?: string
}

/**
 * Batch job data interface
 */
export interface BatchJobData {
  items: any[]
  config: any
  webhook?: any
}

/**
 * Screenshot worker interface
 */
export interface ScreenshotWorker {
  process(job: Job<ScreenshotJobData>): Promise<ScreenshotResult>
  initializeBrowser(): Promise<Browser>
  createPage(browser: Browser, options: PageOptions): Promise<Page>
  captureScreenshot(page: Page, options: ScreenshotOptions): Promise<Buffer>
  saveScreenshot(buffer: Buffer, filename: string): Promise<string>
  generateImgProxyUrl(imagePath: string, options: ImgProxyOptions): string
}

/**
 * Storage service interface
 */
export interface StorageService {
  saveFile(buffer: Buffer, path: string): Promise<string>
  getFileUrl(path: string): string
  deleteFile(path: string): Promise<void>
  cleanupOldFiles(olderThan: Date): Promise<number>
}

/**
 * Cache service interface
 */
export interface CacheService {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttl: number): Promise<void>
  del(key: string): Promise<void>
  generateCacheKey(url: string, options: ScreenshotOptions): string
  clearExpired(): Promise<number>
  getStats(): Promise<CacheStats>
}

/**
 * ImgProxy service interface
 */
export interface ImgProxyService {
  generateUrl(imagePath: string, options: ImgProxyOptions): string
  isConfigured(): boolean
  validateConfig(): boolean
}

/**
 * Webhook service interface
 */
export interface WebhookService {
  sendWebhook(url: string, payload: any, auth?: string): Promise<void>
  retryWebhook(webhookData: WebhookData, attempt: number): Promise<void>
  validateWebhookUrl(url: string): boolean
}