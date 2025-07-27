# Requirements Document

## Introduction

This feature implements the missing API endpoints and enhances existing endpoints based on the web2img.json Postman collection documentation. The current implementation has 3 basic endpoints (POST /screenshot, POST /batch/screenshots, GET /batch/screenshots/:job_id) but they need enhancements to match the documented API specification. Additionally, 8 missing endpoints need to be implemented to complete the API functionality for batch job management and cache operations.

## Requirements

### Requirement 1

**User Story:** As an API consumer, I want the POST /screenshot endpoint to return enhanced response data, so that I can get comprehensive information about the screenshot operation.

#### Acceptance Criteria

1. WHEN I send a POST request to /screenshot THEN the system SHALL return success, screenshot_url, cache_hit, processing_time_ms, file_size_bytes, and expires_at fields
2. WHEN the screenshot is served from cache THEN the system SHALL return cache_hit: true and faster processing_time_ms
3. WHEN the screenshot is newly generated THEN the system SHALL return cache_hit: false and actual processing time
4. WHEN file_size_bytes is available THEN the system SHALL include the size of the generated screenshot file
5. WHEN expires_at is applicable THEN the system SHALL include the cache expiration timestamp
6. WHEN the request includes cache=false parameter THEN the system SHALL bypass cache and return fresh screenshot
7. WHEN timeout parameter is provided THEN the system SHALL respect the custom timeout value
8. WHEN fullPage parameter is true THEN the system SHALL capture the entire page height

### Requirement 2

**User Story:** As an API consumer, I want the POST /batch/screenshots endpoint to support comprehensive configuration options, so that I can control batch processing behavior.

#### Acceptance Criteria

1. WHEN I send a POST request to /batch/screenshots with config object THEN the system SHALL accept parallel, timeout, webhook, webhook_auth, fail_fast, cache, priority, scheduled_time, recurrence, and rate_limit parameters
2. WHEN webhook_url is provided THEN the system SHALL send notifications to the webhook on job completion
3. WHEN webhook_auth is provided THEN the system SHALL include authentication headers in webhook requests
4. WHEN fail_fast is true THEN the system SHALL stop processing on first failure
5. WHEN priority is "high" THEN the system SHALL process the job with higher queue priority
6. WHEN scheduled_time is provided THEN the system SHALL schedule the job for future execution
7. WHEN recurrence parameters are provided THEN the system SHALL set up recurring job execution
8. WHEN rate_limit is specified THEN the system SHALL throttle processing to respect the limit

### Requirement 3

**User Story:** As an API consumer, I want the GET /batch/screenshots/:job_id endpoint to return comprehensive job status information, so that I can monitor job progress and access detailed results.

#### Acceptance Criteria

1. WHEN I send a GET request to /batch/screenshots/:job_id THEN the system SHALL return job_id, status, total, completed, failed, progress_percentage, created_at, updated_at, scheduled_time, completed_at, estimated_completion, config, results, successful_results, and failed_results
2. WHEN the job is scheduled THEN the system SHALL include scheduled_time and next_scheduled_time for recurring jobs
3. WHEN the job is processing THEN the system SHALL include estimated_completion based on current progress
4. WHEN results are available THEN the system SHALL include detailed results array with individual item status
5. WHEN the job has webhook configuration THEN the system SHALL include webhook details in config
6. WHEN progress_percentage is calculable THEN the system SHALL return accurate completion percentage

### Requirement 4

**User Story:** As an API consumer, I want to retrieve all active batch jobs, so that I can monitor currently running and scheduled batch operations.

#### Acceptance Criteria

1. WHEN I send a GET request to /batch/screenshots/active THEN the system SHALL return a list of all batch jobs with status "processing" or "scheduled"
2. WHEN there are no active batch jobs THEN the system SHALL return an empty jobs array with 200 status
3. WHEN the request is successful THEN the system SHALL return job details including job_id, status, total, completed, failed, created_at, updated_at, and estimated_completion
4. WHEN a job is scheduled THEN the system SHALL include scheduled_time and next_scheduled_time fields
5. WHEN the request fails THEN the system SHALL return appropriate error responses with proper HTTP status codes

### Requirement 2

**User Story:** As an API consumer, I want to schedule a batch job for future execution, so that I can control when batch operations are performed.

#### Acceptance Criteria

1. WHEN I send a POST request to /batch/screenshots/:job_id/schedule with a valid scheduled_time THEN the system SHALL update the job's scheduled time
2. WHEN the scheduled_time is in the past THEN the system SHALL return a 400 error with appropriate message
3. WHEN the job_id does not exist THEN the system SHALL return a 404 error
4. WHEN the job is already processing or completed THEN the system SHALL return a 400 error indicating invalid state
5. WHEN scheduling is successful THEN the system SHALL return the updated job status with 202 status code
6. WHEN the scheduled_time format is invalid THEN the system SHALL return a 422 validation error

### Requirement 3

**User Story:** As an API consumer, I want to set recurrence patterns for batch jobs, so that I can automate regular screenshot captures.

#### Acceptance Criteria

1. WHEN I send a POST request to /batch/screenshots/:job_id/recurrence with valid recurrence settings THEN the system SHALL configure the job for recurring execution
2. WHEN pattern is "daily", "weekly", "monthly", or "hourly" THEN the system SHALL accept the recurrence configuration
3. WHEN pattern is "custom" and cron expression is provided THEN the system SHALL validate and accept the cron pattern
4. WHEN interval and count are provided THEN the system SHALL configure limited recurrence execution
5. WHEN the job_id does not exist THEN the system SHALL return a 404 error
6. WHEN recurrence parameters are invalid THEN the system SHALL return a 422 validation error
7. WHEN recurrence is set successfully THEN the system SHALL return updated job status with next_scheduled_time

### Requirement 4

**User Story:** As an API consumer, I want to retrieve all active batch jobs, so that I can monitor currently running and scheduled batch operations.

#### Acceptance Criteria

1. WHEN I send a GET request to /batch/screenshots/active THEN the system SHALL return a list of all batch jobs with status "processing" or "scheduled"
2. WHEN there are no active batch jobs THEN the system SHALL return an empty jobs array with 200 status
3. WHEN the request is successful THEN the system SHALL return job details including job_id, status, total, completed, failed, created_at, updated_at, and estimated_completion
4. WHEN a job is scheduled THEN the system SHALL include scheduled_time and next_scheduled_time fields
5. WHEN the request fails THEN the system SHALL return appropriate error responses with proper HTTP status codes

### Requirement 5

**User Story:** As an API consumer, I want to schedule a batch job for future execution, so that I can control when batch operations are performed.

#### Acceptance Criteria

1. WHEN I send a POST request to /batch/screenshots/:job_id/schedule with a valid scheduled_time THEN the system SHALL update the job's scheduled time
2. WHEN the scheduled_time is in the past THEN the system SHALL return a 400 error with appropriate message
3. WHEN the job_id does not exist THEN the system SHALL return a 404 error
4. WHEN the job is already processing or completed THEN the system SHALL return a 400 error indicating invalid state
5. WHEN scheduling is successful THEN the system SHALL return the updated job status with 202 status code
6. WHEN the scheduled_time format is invalid THEN the system SHALL return a 422 validation error

### Requirement 6

**User Story:** As an API consumer, I want to set recurrence patterns for batch jobs, so that I can automate regular screenshot captures.

#### Acceptance Criteria

1. WHEN I send a POST request to /batch/screenshots/:job_id/recurrence with valid recurrence settings THEN the system SHALL configure the job for recurring execution
2. WHEN pattern is "daily", "weekly", "monthly", or "hourly" THEN the system SHALL accept the recurrence configuration
3. WHEN pattern is "custom" and cron expression is provided THEN the system SHALL validate and accept the cron pattern
4. WHEN interval and count are provided THEN the system SHALL configure limited recurrence execution
5. WHEN the job_id does not exist THEN the system SHALL return a 404 error
6. WHEN recurrence parameters are invalid THEN the system SHALL return a 422 validation error
7. WHEN recurrence is set successfully THEN the system SHALL return updated job status with next_scheduled_time

### Requirement 7

**User Story:** As an API consumer, I want to cancel batch jobs, so that I can stop processing or scheduled jobs when needed.

#### Acceptance Criteria

1. WHEN I send a POST request to /batch/screenshots/:job_id/cancel THEN the system SHALL cancel the specified batch job
2. WHEN the job is currently processing THEN the system SHALL stop processing and mark remaining items as cancelled
3. WHEN the job is scheduled THEN the system SHALL remove it from the schedule and mark as cancelled
4. WHEN the job is already completed or failed THEN the system SHALL return a 400 error indicating invalid state
5. WHEN the job_id does not exist THEN the system SHALL return a 404 error
6. WHEN cancellation is successful THEN the system SHALL return the updated job status with "cancelled" status

### Requirement 8

**User Story:** As an API consumer, I want to retrieve detailed results of completed batch jobs, so that I can access all generated screenshots and error information.

#### Acceptance Criteria

1. WHEN I send a GET request to /batch/screenshots/:job_id/results THEN the system SHALL return detailed results for all items in the batch
2. WHEN the job is not yet completed THEN the system SHALL return current results with partial completion status
3. WHEN the job_id does not exist THEN the system SHALL return a 404 error
4. WHEN results are retrieved successfully THEN the system SHALL include job_id, status, total, succeeded, failed, processing_time, and results array
5. WHEN individual results are included THEN each SHALL contain id, status, url (if successful), error (if failed), and cached flag
6. WHEN the job has no results yet THEN the system SHALL return empty results array

### Requirement 9

**User Story:** As an API consumer, I want to clear the entire cache, so that I can force fresh screenshots for all URLs.

#### Acceptance Criteria

1. WHEN I send a DELETE request to /cache THEN the system SHALL remove all cached screenshot entries
2. WHEN cache clearing is successful THEN the system SHALL return 204 No Content status
3. WHEN cache clearing fails THEN the system SHALL return 500 error with appropriate message
4. WHEN cache is already empty THEN the system SHALL still return 204 status
5. WHEN the operation completes THEN all subsequent screenshot requests SHALL generate fresh captures

### Requirement 10

**User Story:** As an API consumer, I want to retrieve cache statistics, so that I can monitor cache performance and usage.

#### Acceptance Criteria

1. WHEN I send a GET request to /cache/stats THEN the system SHALL return comprehensive cache statistics
2. WHEN statistics are retrieved successfully THEN the system SHALL include enabled, size, max_size, ttl, hits, misses, hit_rate, and cleanup_interval
3. WHEN cache is disabled THEN the system SHALL return enabled: false with other stats as null or zero
4. WHEN hit_rate calculation is possible THEN the system SHALL return ratio of hits to total requests
5. WHEN statistics retrieval fails THEN the system SHALL return 500 error with appropriate message

### Requirement 11

**User Story:** As an API consumer, I want to invalidate cache entries for specific URLs, so that I can force fresh screenshots for particular websites.

#### Acceptance Criteria

1. WHEN I send a DELETE request to /cache/url with a valid URL parameter THEN the system SHALL remove all cache entries for that URL
2. WHEN URL parameter is missing THEN the system SHALL return 422 validation error
3. WHEN URL parameter is invalid format THEN the system SHALL return 422 validation error
4. WHEN cache entries are found and removed THEN the system SHALL return count of invalidated entries
5. WHEN no cache entries exist for the URL THEN the system SHALL return invalidated count of 0
6. WHEN invalidation is successful THEN subsequent requests for that URL SHALL generate fresh screenshots