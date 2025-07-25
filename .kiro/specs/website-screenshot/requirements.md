# Requirements Document

## Introduction

The Website Screenshot API feature enables users to capture screenshots of web pages by providing URLs through both single and batch processing endpoints. This API integrates with the existing web2img application, providing authenticated users with powerful screenshot generation capabilities including intelligent caching, queue management, webhook notifications, and scheduled/recurring batch jobs. The system supports various screenshot configurations, multiple output formats, and advanced features like URL transformations and imgproxy integration.

## Requirements

### Requirement 1

**User Story:** As an API user, I want to submit a URL and receive a screenshot of the website, so that I can capture visual representations of web pages programmatically.

#### Acceptance Criteria

1. WHEN a valid URL is provided to the POST /screenshot endpoint THEN the system SHALL generate a screenshot of the webpage
2. WHEN the screenshot is successfully generated THEN the system SHALL return an imgproxy URL for the screenshot
3. WHEN an invalid URL is provided THEN the system SHALL return an appropriate error message with HTTP 400 status
4. WHEN the URL points to a non-existent or inaccessible website THEN the system SHALL return an error message with appropriate HTTP status
5. WHEN cache parameter is true THEN the system SHALL check cache before generating new screenshot
6. WHEN cache parameter is false THEN the system SHALL bypass cache and generate fresh screenshot

### Requirement 2

**User Story:** As an API user, I want to authenticate my screenshot requests using API keys, so that only authorized users can access the screenshot functionality.

#### Acceptance Criteria

1. WHEN a screenshot request is made without X-API-Key header THEN the system SHALL return HTTP 401 unauthorized error
2. WHEN a screenshot request is made with valid API key THEN the system SHALL process the request
3. WHEN a screenshot request is made with invalid or expired API key THEN the system SHALL return HTTP 401 unauthorized error

### Requirement 3

**User Story:** As an API user, I want to specify screenshot options like dimensions and format, so that I can customize the output according to my needs.

#### Acceptance Criteria

1. WHEN width and height parameters are provided (1-5000 pixels) THEN the system SHALL capture the screenshot with the specified viewport dimensions
2. WHEN no dimensions are specified THEN the system SHALL use default dimensions (1280x720)
3. WHEN format parameter is provided (png, jpeg, webp) THEN the system SHALL return the screenshot in the requested format
4. WHEN no format is specified THEN the system SHALL default to PNG format

### Requirement 4

**User Story:** As an API user, I want to process multiple screenshot requests as batch jobs, so that I can efficiently capture screenshots of multiple URLs.

#### Acceptance Criteria

1. WHEN a batch request is submitted to POST /batch/screenshots THEN the system SHALL create a batch job with unique job_id
2. WHEN batch contains 1-200 items THEN the system SHALL accept and process the batch
3. WHEN batch contains more than 200 items THEN the system SHALL return HTTP 400 error
4. WHEN parallel parameter is specified (1-50) THEN the system SHALL process items with specified concurrency
5. WHEN no parallel parameter is provided THEN the system SHALL default to 3 parallel processes
6. WHEN batch job is created THEN the system SHALL return HTTP 202 with job status information

### Requirement 5

**User Story:** As an API user, I want to check the status of my batch jobs, so that I can monitor progress and retrieve results.

#### Acceptance Criteria

1. WHEN GET /batch/screenshots/{job_id} is called with valid job_id THEN the system SHALL return current job status
2. WHEN job_id does not exist THEN the system SHALL return HTTP 404 error
3. WHEN batch job is completed THEN the system SHALL return full results with individual item statuses
4. WHEN batch job is in progress THEN the system SHALL return current progress information

### Requirement 6

**User Story:** As an API user, I want to receive webhook notifications when batch jobs complete, so that I can be notified asynchronously of job completion.

#### Acceptance Criteria

1. WHEN webhook URL is provided in batch config THEN the system SHALL POST to webhook URL upon job completion
2. WHEN webhook_auth is provided THEN the system SHALL include Authorization header in webhook request
3. WHEN webhook request fails THEN the system SHALL retry webhook delivery with exponential backoff
4. WHEN webhook payload is sent THEN it SHALL include job status, results, and processing time

### Requirement 7

**User Story:** As an API user, I want to schedule batch jobs for future execution and set up recurring jobs, so that I can automate screenshot capture.

#### Acceptance Criteria

1. WHEN scheduled_time is provided in ISO 8601 format THEN the system SHALL execute the job at the specified time
2. WHEN recurrence pattern is specified (hourly, daily, weekly, monthly) THEN the system SHALL create recurring jobs
3. WHEN recurrence_count is specified THEN the system SHALL limit the number of recurrences
4. WHEN recurrence_cron is provided THEN the system SHALL use custom cron expression for scheduling
5. WHEN recurrence_interval is specified THEN the system SHALL use the interval for recurring jobs

### Requirement 8

**User Story:** As an API user, I want intelligent caching of screenshots, so that I can get faster responses for previously captured URLs.

#### Acceptance Criteria

1. WHEN a screenshot request is made THEN the system SHALL check cache using original URL as key
2. WHEN cached screenshot exists and is not expired THEN the system SHALL return cached result
3. WHEN cache is disabled via parameter THEN the system SHALL bypass cache and generate fresh screenshot
4. WHEN screenshot is generated THEN the system SHALL store result in cache for future requests
5. WHEN URL transformations are applied THEN the system SHALL use original URL for cache key

### Requirement 9

**User Story:** As a system administrator, I want comprehensive error handling and rate limiting, so that the service remains stable and prevents abuse.

#### Acceptance Criteria

1. WHEN system is overloaded THEN the system SHALL return HTTP 503 with service_overloaded error
2. WHEN rate limit is exceeded THEN the system SHALL return HTTP 429 with retry_after header
3. WHEN request times out in queue THEN the system SHALL return request_timeout error
4. WHEN screenshot capture fails THEN the system SHALL return descriptive error message
5. WHEN storage upload fails THEN the system SHALL return storage_error message

### Requirement 10

**User Story:** As a system administrator, I want to configure imgproxy integration through environment variables, so that screenshots can be served through imgproxy for optimized delivery and transformations.

#### Acceptance Criteria

1. WHEN IMGPROXY_URL environment variable is set THEN the system SHALL use it as the base URL for imgproxy
2. WHEN IMGPROXY_KEY and IMGPROXY_SALT environment variables are set THEN the system SHALL use them to generate signed imgproxy URLs
3. WHEN screenshot is successfully captured and stored THEN the system SHALL generate a signed imgproxy URL for the image
4. WHEN imgproxy configuration is missing THEN the system SHALL return direct storage URLs as fallback
5. WHEN imgproxy URL generation fails THEN the system SHALL log error and return direct storage URL

### Requirement 11

**User Story:** As an API user, I want the system to handle URL transformations and special content types, so that I can capture screenshots of various website configurations.

#### Acceptance Criteria

1. WHEN URL matches transformation patterns (e.g., viding.co) THEN the system SHALL transform to internal URL format
2. WHEN URL contains JavaScript-heavy content THEN the system SHALL wait for JavaScript execution before capturing
3. WHEN URL redirects to another page THEN the system SHALL follow redirects and capture final destination
4. WHEN timeout parameter is specified (5-60 seconds) THEN the system SHALL use specified timeout for page loading
5. WHEN no timeout is specified THEN the system SHALL default to 30 seconds timeout