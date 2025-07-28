# Implementation Plan

- [x] 1. Enhance existing screenshot endpoints to match Postman collection specifications
- [x] 1.1 Modify single screenshot endpoint response format
  - Update POST /screenshot to return enhanced response with success, screenshot_url, cache_hit, processing_time_ms, file_size_bytes, and expires_at fields
  - Change current response from {url, cached} to match Postman collection format
  - Add processing time tracking from request start to completion
  - Calculate file size from screenshot buffer before storage
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 1.2 Enhance batch screenshot creation endpoint
  - Update POST /batch/screenshots to support all config parameters from Postman collection
  - Add support for webhook_url, webhook_auth, fail_fast, priority, scheduled_time, recurrence parameters
  - Ensure response format matches Postman collection with completed, created_at, estimated_completion, failed, job_id, priority, status, total, updated_at fields
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

- [x] 1.3 Enhance batch status endpoint response
  - Update GET /batch/screenshots/:job_id to return comprehensive status matching Postman collection
  - Add progress_percentage, scheduled_time, completed_at, estimated_completion, next_scheduled_time fields
  - Include config, results, successful_results, and failed_results arrays
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 2. Implement batch job management endpoints matching Postman collection
- [x] 2.1 Create active batch jobs listing endpoint
  - Implement GET /batch/screenshots/active endpoint returning {jobs: [...]} format
  - Filter jobs by status ('processing' or 'scheduled') as shown in Postman collection
  - Include job_id, status, total, completed, failed, created_at, updated_at, estimated_completion, scheduled_time, next_scheduled_time fields
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 2.2 Implement batch job scheduling endpoint
  - Create POST /batch/screenshots/:job_id/schedule endpoint with {scheduled_time} request body
  - Validate scheduled_time is in future and in ISO 8601 format
  - Return 202 status with updated job status matching Postman collection response
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 2.3 Implement batch job recurrence configuration endpoint
  - Create POST /batch/screenshots/:job_id/recurrence endpoint with {pattern, interval, count, cron} request body
  - Support pattern values: "daily", "weekly", "monthly", "hourly", "custom"
  - Validate cron expression when pattern is "custom"
  - Return 202 status with updated job status
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 2.4 Implement batch job cancellation endpoint
  - Create POST /batch/screenshots/:job_id/cancel endpoint (no request body)
  - Cancel processing or scheduled jobs and update status to 'cancelled'
  - Return 200 status with updated job status matching Postman collection
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 2.5 Implement detailed batch job results endpoint
  - Create GET /batch/screenshots/:job_id/results endpoint
  - Return {job_id, status, total, succeeded, failed, processing_time, results} format
  - Include results array with {id, status, url, error, cached} objects
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 3. Implement cache management endpoints matching Postman collection
- [x] 3.1 Create cache statistics endpoint
  - Implement GET /cache/stats endpoint returning {enabled, size, max_size, ttl, hits, misses, hit_rate, cleanup_interval}
  - Extend cache service to track hit/miss statistics
  - Calculate hit_rate as ratio of hits to total requests
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 3.2 Implement cache clearing endpoint
  - Create DELETE /cache endpoint (no request/response body)
  - Return 204 No Content status on successful cache clear
  - Use existing cache service flush functionality
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 3.3 Implement URL-specific cache invalidation endpoint
  - Create DELETE /cache/url endpoint with ?url=<url> query parameter
  - Return {invalidated: number} response format matching Postman collection
  - Validate URL parameter and return 422 for validation errors
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] 4. Extend database schema and models to support Postman collection features
- [x] 4.1 Create database migration for batch job enhancements
  - Add next_scheduled_time, recurrence_config, webhook_url, webhook_auth, and processing_started_at columns to batch_jobs table
  - Create indexes for performance: idx_batch_jobs_status_scheduled, idx_batch_jobs_next_scheduled
  - Ensure backward compatibility with existing batch job data
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 4.2 Enhance BatchJob model with methods for Postman collection endpoints
  - Add static method getActiveJobs() to filter jobs by 'processing' or 'scheduled' status
  - Implement scheduleJob(), setRecurrence(), and cancelJob() methods
  - Add calculated properties: progressPercentage, estimatedCompletion, nextScheduledTime
  - Add methods: getSuccessfulResults(), getFailedResults() for results endpoint
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 5. Enhance cache service to support Postman collection cache endpoints
- [x] 5.1 Add hit/miss tracking for cache statistics endpoint
  - Implement Redis counters for cache:stats:hits and cache:stats:misses
  - Modify existing get() method to increment hit counter
  - Modify existing set() method to increment miss counter (on cache miss)
  - Add getHitRate() method to calculate hits/(hits+misses) ratio
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 5.2 Implement URL-specific cache invalidation for DELETE /cache/url
  - Add invalidateByUrl(url: string) method to cache service
  - Generate all possible cache key variations for the URL (different formats/dimensions)
  - Use Redis pattern matching to find and delete matching keys
  - Return count of invalidated entries matching Postman collection response
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] 5.3 Enhance cache statistics to match Postman collection format
  - Extend getStats() method to return {enabled, size, max_size, ttl, hits, misses, hit_rate, cleanup_interval}
  - Add enabled flag based on cache service configuration
  - Include cleanup_interval from environment configuration
  - Calculate current cache size from Redis key count
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 6. Extend validation schemas to match Postman collection request formats
- [x] 6.1 Add validation for scheduling endpoint request body
  - Create scheduleJobValidator for {scheduled_time} request body
  - Validate scheduled_time is valid ISO 8601 format and in future
  - Add custom validation to ensure job exists and is in valid state
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 6.2 Add validation for recurrence endpoint request body
  - Create recurrenceValidator for {pattern, interval, count, cron} request body
  - Validate pattern enum: "hourly", "daily", "weekly", "monthly", "custom"
  - Add cron expression validation when pattern is "custom"
  - Validate interval and count are positive integers when provided
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 6.3 Add validation for cache URL invalidation query parameter
  - Create cacheUrlValidator for ?url=<url> query parameter
  - Validate URL format and ensure it's a valid HTTP/HTTPS URL
  - Return 422 validation error format matching Postman collection
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [ ] 7. Add new routes matching Postman collection structure
- [ ] 7.1 Register batch management routes in correct order
  - Add GET /batch/screenshots/active before parameterized routes to prevent conflicts
  - Add POST /batch/screenshots/:job_id/schedule, /recurrence, /cancel routes
  - Add GET /batch/screenshots/:job_id/results route
  - Apply existing middleware: requestLogging, apiKeyAuth, rateLimit, metrics
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [ ] 7.2 Register cache management routes matching Postman collection
  - Add GET /cache/stats, DELETE /cache, DELETE /cache/url routes
  - Configure proper HTTP methods and query parameter handling for /cache/url
  - Apply security middleware and ensure proper response status codes
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [ ] 8. Implement comprehensive testing matching Postman collection scenarios
- [ ] 8.1 Create unit tests for all new controller methods
  - Test response formats exactly match Postman collection examples
  - Test validation errors return 422 status with proper error format
  - Test success responses return correct status codes (200, 202, 204)
  - Verify all request/response field names match Postman collection
  - _Requirements: All requirements_

- [ ] 8.2 Create integration tests for complete API workflows
  - Test batch job creation → scheduling → recurrence → cancellation flow
  - Test cache stats → clear → URL invalidation workflow
  - Verify webhook delivery with authentication headers
  - Test error scenarios match Postman collection error responses
  - _Requirements: All requirements_

- [ ] 8.3 Add performance tests for enhanced endpoints
  - Test cache hit/miss tracking doesn't impact performance
  - Verify batch job processing with enhanced status tracking
  - Test concurrent cache operations and invalidation
  - Measure response times match Postman collection expectations
  - _Requirements: All requirements_
