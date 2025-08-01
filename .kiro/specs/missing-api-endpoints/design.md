# Design Document

## Overview

This design document outlines the implementation of missing API endpoints and enhancements to existing endpoints for the Web2Img screenshot service. The current implementation provides 3 basic endpoints but needs to be expanded to match the documented API specification with 8 additional endpoints and enhanced response data.

The design focuses on extending the existing AdonisJS architecture while maintaining backward compatibility and following established patterns for authentication, validation, caching, and error handling.

## Architecture

### Current Architecture Analysis

The existing system follows a layered architecture:

- **Controllers**: Handle HTTP requests and responses (`screenshot_controller.ts`)
- **Services**: Business logic and external integrations (cache, queue, browser services)
- **Models**: Database entities with Lucid ORM (`batch_job.ts`)
- **Middleware**: Cross-cutting concerns (auth, rate limiting, logging)
- **Queue System**: BullMQ for background processing

### Enhanced Architecture Components

The design extends the current architecture with:

1. **Enhanced Response Formatters**: Standardized response structures with comprehensive metadata
2. **Cache Management Service**: Extended cache operations for URL-specific invalidation and statistics
3. **Job Scheduling Service**: Enhanced batch job management with scheduling and recurrence
4. **Webhook Service**: Notification system for batch job completion
5. **Validation Extensions**: Enhanced request validation for new endpoint parameters

## Components and Interfaces

### 1. Enhanced Screenshot Controller

**Design Decision**: Extend the existing `ScreenshotController` rather than creating new controllers to maintain consistency and reduce code duplication.

#### Enhanced Single Screenshot Endpoint (Requirement 1)

- **Path**: `POST /screenshot`
- **Current Response**: `{url: string, cached: boolean}`
- **New Response Format**:

```typescript
interface EnhancedScreenshotResponse {
  success: boolean
  screenshot_url: string
  cache_hit: boolean
  processing_time_ms: number
  file_size_bytes: number
  expires_at: string | null
}
```

**Implementation Changes**:

- Track processing time from request start to completion
- Calculate file size from screenshot buffer before storage
- Determine cache hit from cache service response
- Calculate expiration timestamp based on cache TTL
- Wrap response in success/error format

#### Enhanced Batch Screenshot Endpoint (Requirement 2)

- **Path**: `POST /batch/screenshots`
- **Current Config**: Basic parallel, timeout, webhook options
- **Enhanced Config Interface**:

```typescript
interface EnhancedBatchConfig {
  parallel?: number
  timeout?: number
  webhook_url?: string
  webhook_auth?: string
  fail_fast?: boolean
  cache?: boolean
  priority?: 'high' | 'normal' | 'low'
  scheduled_time?: string
  recurrence?: RecurrenceConfig
  rate_limit?: number
}

interface RecurrenceConfig {
  pattern: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'
  interval?: number
  count?: number
  cron?: string
}
```

**Implementation Changes**:

- Extend validation to support new config parameters
- Add webhook URL validation and authentication header support
- Implement priority-based queue processing
- Add scheduled job creation with DateTime validation
- Support recurrence configuration with cron parsing

#### Enhanced Batch Status Endpoint (Requirement 3)

- **Path**: `GET /batch/screenshots/:job_id`
- **Current Response**: Basic job status with results array
- **Enhanced Response Format**:

```typescript
interface EnhancedBatchStatusResponse {
  job_id: string
  status: BatchJobStatus
  total: number
  completed: number
  failed: number
  progress_percentage: number
  created_at: string
  updated_at: string
  scheduled_time?: string
  completed_at?: string
  estimated_completion?: string
  next_scheduled_time?: string
  config: EnhancedBatchConfig
  results: BatchResult[]
  successful_results: BatchResult[]
  failed_results: BatchResult[]
}
```

**Implementation Changes**:

- Add progress percentage calculation
- Implement estimated completion time based on processing rate
- Add next scheduled time for recurring jobs
- Separate successful and failed results arrays

### 2. New Batch Management Endpoints

#### Active Jobs Endpoint (Requirement 4)

- **Path**: `GET /batch/screenshots/active`
- **Purpose**: List all processing and scheduled batch jobs
- **Response Format**:

```typescript
interface ActiveJobsResponse {
  jobs: Array<{
    job_id: string
    status: 'processing' | 'scheduled'
    total: number
    completed: number
    failed: number
    created_at: string
    updated_at: string
    scheduled_time?: string
    next_scheduled_time?: string
    estimated_completion?: string
  }>
}
```

- **Implementation**: Query `BatchJob` model for jobs with status 'processing' or 'scheduled'

#### Job Scheduling Endpoint (Requirement 5)

- **Path**: `POST /batch/screenshots/:job_id/schedule`
- **Purpose**: Schedule existing job for future execution
- **Request Body**:

```typescript
interface ScheduleJobRequest {
  scheduled_time: string // ISO 8601 format
}
```

- **Validation**:
  - Ensure scheduled_time is in the future
  - Verify job exists and is in valid state (pending/failed)
  - Validate ISO 8601 date format
- **Response**: Updated job status with 202 status code

#### Job Recurrence Endpoint (Requirement 6)

- **Path**: `POST /batch/screenshots/:job_id/recurrence`
- **Purpose**: Configure recurring job execution
- **Request Body**:

```typescript
interface RecurrenceRequest {
  pattern: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'
  interval?: number
  count?: number
  cron?: string // Required when pattern is 'custom'
}
```

- **Implementation**:
  - Validate recurrence patterns and cron expressions
  - Calculate next execution time
  - Update job configuration and schedule next run
- **Response**: Updated job status with next_scheduled_time

#### Job Cancellation Endpoint (Requirement 7)

- **Path**: `POST /batch/screenshots/:job_id/cancel`
- **Purpose**: Cancel processing or scheduled jobs
- **Implementation**:
  - Update job status to 'cancelled'
  - Remove job from queue if scheduled/pending
  - Stop processing if currently running
- **Response**: Updated job status with 'cancelled' status

#### Job Results Endpoint (Requirement 8)

- **Path**: `GET /batch/screenshots/:job_id/results`
- **Purpose**: Retrieve detailed results for completed jobs
- **Response Format**:

```typescript
interface JobResultsResponse {
  job_id: string
  status: BatchJobStatus
  total: number
  succeeded: number
  failed: number
  processing_time: number
  results: Array<{
    id: string
    status: 'success' | 'error' | 'pending'
    url?: string
    error?: string
    cached?: boolean
  }>
}
```

### 3. Cache Management Endpoints

#### Cache Statistics Endpoint (Requirement 10)

- **Path**: `GET /cache/stats`
- **Purpose**: Provide cache performance metrics
- **Response Format**:

```typescript
interface CacheStatisticsResponse {
  enabled: boolean
  size: number
  max_size: number
  ttl: number
  hits: number
  misses: number
  hit_rate: number
  cleanup_interval: number
}
```

- **Implementation**: Extend existing `cacheService.getStats()` to include hit/miss tracking

#### Cache Clear Endpoint (Requirement 9)

- **Path**: `DELETE /cache`
- **Purpose**: Clear entire cache
- **Implementation**: Use existing `cacheService.flush()` method
- **Response**: 204 No Content on success, 500 on failure

#### URL-Specific Cache Invalidation (Requirement 11)

- **Path**: `DELETE /cache/url`
- **Purpose**: Invalidate cache entries for specific URLs
- **Request Body**:

```typescript
interface CacheInvalidationRequest {
  url: string
}
```

- **Implementation**:
  - Generate cache keys for all possible variations of the URL
  - Delete matching cache entries using pattern matching
  - Return count of invalidated entries
- **Response Format**:

```typescript
interface CacheInvalidationResponse {
  invalidated_count: number
  url: string
}
```

### 4. New Service Classes

#### WebhookService

**Purpose**: Handle webhook notifications for batch job completion

```typescript
interface WebhookService {
  sendNotification(webhookUrl: string, payload: any, authHeader?: string): Promise<boolean>
  validateWebhookUrl(url: string): boolean
  retryFailedWebhook(webhookUrl: string, payload: any, maxRetries: number): Promise<boolean>
}
```

**Implementation**:

- HTTP client for webhook delivery
- Retry mechanism with exponential backoff
- Authentication header support
- Webhook URL validation

#### JobSchedulerService

**Purpose**: Handle job scheduling and recurrence management

```typescript
interface JobSchedulerService {
  scheduleJob(jobId: string, scheduledTime: DateTime): Promise<void>
  setRecurrence(jobId: string, config: RecurrenceConfig): Promise<void>
  calculateNextExecution(config: RecurrenceConfig): DateTime
  cancelScheduledJob(jobId: string): Promise<boolean>
}
```

**Implementation**:

- Cron expression parsing and validation
- Next execution time calculation
- Integration with queue service for scheduling
- Recurrence pattern management

#### Enhanced CacheService

**Purpose**: Extend existing cache service with new functionality

**New Methods**:

- `invalidateByUrl(url: string): Promise<number>` - URL-specific invalidation
- `getDetailedStats(): Promise<CacheStatisticsResponse>` - Enhanced statistics
- `trackHit()` and `trackMiss()` - Hit/miss tracking

## Data Models

### Enhanced BatchJob Model

**Design Decision**: Extend the existing `BatchJob` model with new fields and methods rather than creating separate models to maintain data consistency.

#### New Fields

```typescript
interface BatchConfig {
  // Existing fields...
  webhook_url?: string
  webhook_auth?: string
  fail_fast?: boolean
  priority?: 'high' | 'normal' | 'low'
  scheduled_time?: string
  recurrence?: RecurrenceConfig
  rate_limit?: number
}

interface RecurrenceConfig {
  pattern: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'
  interval?: number
  count?: number
  cron?: string
  next_execution?: DateTime
}
```

#### New Methods

- `scheduleForExecution(scheduledTime: DateTime)`
- `setRecurrence(config: RecurrenceConfig)`
- `calculateNextExecution()`
- `getActiveJobs()` (static method)

### Cache Statistics Model

**Design Decision**: Create a new interface rather than a database model since cache statistics are runtime data.

```typescript
interface CacheStatistics {
  enabled: boolean
  size: number
  max_size: number
  ttl: number
  hits: number
  misses: number
  hit_rate: number
  cleanup_interval: number
}
```

## Error Handling

### Standardized Error Responses

**Design Decision**: Maintain the existing error response format while adding specific error codes for new endpoints.

#### New Error Codes

- `job_not_found`: Batch job ID not found
- `invalid_scheduled_time`: Scheduled time validation failed
- `invalid_recurrence_config`: Recurrence configuration invalid
- `job_already_completed`: Cannot modify completed job
- `cache_operation_failed`: Cache operation error
- `webhook_delivery_failed`: Webhook notification failed

#### Error Response Format

```typescript
interface ErrorResponse {
  detail: {
    error: string
    message: string
    errors?: ValidationError[]
  }
}
```

### Validation Enhancements

**Design Decision**: Extend existing validation schemas in `screenshot_validator.ts` rather than creating new files to maintain consistency.

#### New Validation Rules

- Webhook URL format validation
- Scheduled time future validation
- Recurrence pattern validation
- Priority enum validation
- Rate limit range validation

## Testing Strategy

### Unit Tests

- **Controller Tests**: Test new endpoints with various input scenarios
- **Service Tests**: Test cache operations, job scheduling, and webhook delivery
- **Model Tests**: Test enhanced BatchJob methods and calculations
- **Validation Tests**: Test new validation rules and error cases

### Integration Tests

- **End-to-End Workflows**: Test complete batch job lifecycle with scheduling
- **Cache Integration**: Test cache invalidation and statistics
- **Webhook Integration**: Test webhook delivery with authentication
- **Queue Integration**: Test job scheduling and cancellation

### Performance Tests

- **Cache Performance**: Test cache hit rates and response times
- **Batch Processing**: Test large batch jobs with various configurations
- **Concurrent Operations**: Test multiple simultaneous operations

## Route Changes

### New Routes Required

The following routes need to be added to `start/routes.ts` within the existing screenshot API group:

```typescript
router
  .group(() => {
    // Existing routes
    router.post('/screenshot', '#controllers/screenshot_controller.single')
    router.post('/batch/screenshots', '#controllers/screenshot_controller.createBatch')
    router.get('/batch/screenshots/:job_id', '#controllers/screenshot_controller.getBatchStatus')

    // New batch management routes
    router.get('/batch/screenshots/active', '#controllers/screenshot_controller.getActiveBatchJobs')
    router.post(
      '/batch/screenshots/:job_id/schedule',
      '#controllers/screenshot_controller.scheduleBatchJob'
    )
    router.post(
      '/batch/screenshots/:job_id/recurrence',
      '#controllers/screenshot_controller.setBatchJobRecurrence'
    )
    router.post(
      '/batch/screenshots/:job_id/cancel',
      '#controllers/screenshot_controller.cancelBatchJob'
    )
    router.get(
      '/batch/screenshots/:job_id/results',
      '#controllers/screenshot_controller.getBatchJobResults'
    )

    // New cache management routes
    router.get('/cache/stats', '#controllers/screenshot_controller.getCacheStats')
    router.delete('/cache', '#controllers/screenshot_controller.clearCache')
    router.delete('/cache/url', '#controllers/screenshot_controller.invalidateCacheUrl')
  })
  .middleware([
    middleware.requestLogging(),
    middleware.apiKeyAuth(),
    middleware.rateLimit(),
    middleware.metrics(),
  ])
```

### Route Ordering Considerations

**Design Decision**: Place the `/batch/screenshots/active` route before the parameterized `/batch/screenshots/:job_id` route to prevent routing conflicts where "active" could be interpreted as a job_id.

## Database Schema Changes

### BatchJob Model Enhancements

The existing `batch_jobs` table needs the following schema additions:

```sql
ALTER TABLE batch_jobs
ADD COLUMN next_scheduled_time DATETIME NULL,
ADD COLUMN recurrence_config JSON NULL,
ADD COLUMN webhook_url VARCHAR(2048) NULL,
ADD COLUMN webhook_auth VARCHAR(512) NULL,
ADD COLUMN processing_started_at DATETIME NULL;

-- Add indexes for performance
CREATE INDEX idx_batch_jobs_status_scheduled ON batch_jobs(status, scheduled_at);
CREATE INDEX idx_batch_jobs_next_scheduled ON batch_jobs(next_scheduled_time);
```

### Cache Statistics Storage

**Design Decision**: Cache statistics will be stored in Redis with keys like `cache:stats:hits` and `cache:stats:misses` rather than in the database, as they are runtime metrics that don't need persistence.

## Implementation Phases

### Phase 1: Enhanced Response Data

1. Modify existing endpoints to return enhanced response data
2. Add processing time tracking and file size calculation
3. Implement cache hit detection and expiration timestamps
4. Update response formatters and documentation

### Phase 2: Batch Job Management

1. Implement active jobs listing endpoint
2. Add job scheduling functionality
3. Implement job cancellation with queue integration
4. Add detailed results endpoint

### Phase 3: Recurrence and Advanced Features

1. Implement recurrence configuration
2. Add cron-based scheduling support
3. Implement webhook notification system
4. Add priority-based queue processing

### Phase 4: Cache Management

1. Implement cache statistics endpoint
2. Add cache clearing functionality
3. Implement URL-specific cache invalidation
4. Add cache performance monitoring

## Security Considerations

### Authentication and Authorization

- **Existing Pattern**: Maintain API key authentication for all endpoints
- **Rate Limiting**: Apply existing rate limiting to new endpoints
- **Webhook Security**: Validate webhook URLs and implement secure authentication

### Input Validation

- **URL Validation**: Strict validation for webhook URLs and scheduled times
- **Parameter Sanitization**: Sanitize all input parameters
- **SQL Injection Prevention**: Use parameterized queries for database operations

### Data Privacy

- **Job Isolation**: Ensure users can only access their own batch jobs
- **Cache Isolation**: Implement cache key prefixing for multi-tenant support
- **Audit Logging**: Log all administrative operations

## Performance Optimizations

### Caching Strategy

- **Response Caching**: Cache frequently accessed job status responses
- **Database Query Optimization**: Use database indexes for job queries
- **Memory Management**: Implement cache size limits and cleanup

### Queue Optimization

- **Priority Queues**: Implement priority-based job processing
- **Batch Processing**: Optimize batch job processing with configurable concurrency
- **Dead Letter Queues**: Handle failed jobs with retry mechanisms

### Database Optimization

- **Indexing**: Add indexes for job status and timestamp queries
- **Pagination**: Implement pagination for large result sets
- **Connection Pooling**: Optimize database connection usage

## Monitoring and Observability

### Metrics Collection

- **Endpoint Metrics**: Track response times and error rates for new endpoints
- **Cache Metrics**: Monitor cache hit rates and performance
- **Queue Metrics**: Track job processing times and failure rates

### Logging Strategy

- **Structured Logging**: Use consistent log formats for new functionality
- **Error Tracking**: Implement comprehensive error logging
- **Performance Logging**: Log slow operations and bottlenecks

### Health Checks

- **Cache Health**: Monitor cache service availability
- **Queue Health**: Monitor queue processing status
- **Database Health**: Monitor database connectivity and performance

## Deployment Considerations

### Backward Compatibility

- **API Versioning**: Maintain backward compatibility for existing endpoints
- **Database Migrations**: Implement safe database schema changes
- **Configuration Management**: Handle new configuration parameters gracefully

### Rollout Strategy

- **Feature Flags**: Use feature flags for gradual rollout
- **A/B Testing**: Test new endpoints with subset of users
- **Monitoring**: Implement comprehensive monitoring during rollout

### Scalability

- **Horizontal Scaling**: Ensure new features support horizontal scaling
- **Load Testing**: Test new endpoints under high load
- **Resource Management**: Monitor resource usage of new features
