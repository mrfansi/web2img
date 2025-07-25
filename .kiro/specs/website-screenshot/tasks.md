# Implementation Plan

- [x] 1. Set up project dependencies and configuration
  - Install Playwright, BullMQ, Redis client, and other required packages
  - Configure environment variables for ImgProxy, Redis, and storage settings
  - Set up TypeScript types and interfaces for the screenshot system
  - _Requirements: 2.2, 10.1, 10.2, 10.3_

- [x] 2. Implement core data models and validation
  - [x] 2.1 Create API key model and migration
    - Write migration for api_keys table with fields: id, key, name, user_id, rate_limit, is_active
    - Create ApiKey Lucid model with relationships and validation
    - Write unit tests for ApiKey model methods
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 2.2 Create batch job model and migration
    - Write migration for batch_jobs table with fields: id, status, total_items, completed_items, failed_items, config, results
    - Create BatchJob Lucid model with JSON fields and status enums
    - Write unit tests for BatchJob model state transitions
    - _Requirements: 4.1, 4.2, 5.1, 5.2, 5.3_

  - [x] 2.3 Implement request validation schemas
    - Create Vine validation schemas for single screenshot requests (URL, format, dimensions)
    - Create Vine validation schemas for batch screenshot requests with item validation
    - Create validation schemas for batch configuration options
    - Write unit tests for all validation schemas
    - _Requirements: 1.1, 1.3, 3.1, 3.2, 3.3, 4.1, 4.2_

- [x] 3. Implement authentication and middleware
  - [x] 3.1 Create API key authentication middleware
    - Write middleware to extract and validate X-API-Key header
    - Implement API key lookup and validation against database
    - Add request context enrichment with authenticated API key data
    - Write unit tests for authentication middleware
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.2 Implement rate limiting middleware
    - Create Redis-based rate limiting middleware using API key limits
    - Implement sliding window rate limiting algorithm
    - Add rate limit headers to responses (X-RateLimit-Limit, X-RateLimit-Remaining)
    - Write unit tests for rate limiting logic
    - _Requirements: 9.2, 9.3_

- [x] 4. Set up Redis and caching infrastructure
  - [x] 4.1 Configure Redis connection and client
    - Set up Redis connection configuration in config/redis.ts
    - Create Redis service wrapper with connection pooling
    - Implement Redis health check functionality
    - Write unit tests for Redis connection handling
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 4.2 Implement cache service for screenshots
    - Create CacheService class with get, set, delete methods
    - Implement cache key generation using URL and screenshot options
    - Add cache TTL management and expiration handling
    - Write unit tests for cache operations and key generation
    - _Requirements: 1.5, 1.6, 8.1, 8.2, 8.4, 8.5_

- [x] 5. Implement screenshot capture service
  - [x] 5.1 Create Playwright browser service
    - Set up Playwright browser instance management with pooling
    - Implement browser page creation with viewport configuration
    - Add browser cleanup and resource management
    - Write unit tests for browser lifecycle management
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 5.2 Implement URL transformation service
    - Create URL transformation logic for special domains (viding.co, etc.)
    - Implement URL validation and sanitization
    - Add support for redirect following and final URL capture
    - Write unit tests for URL transformation patterns
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 5.3 Create screenshot capture worker
    - Implement core screenshot capture logic using Playwright
    - Add support for different formats (PNG, JPEG, WebP) and quality settings
    - Implement timeout handling and error recovery
    - Write unit tests for screenshot capture with mocked browser
    - _Requirements: 1.1, 1.2, 3.1, 3.2, 3.3, 11.4, 11.5_

- [x] 6. Implement file storage and ImgProxy integration
  - [x] 6.1 Create file storage service
    - Implement local file storage with organized directory structure
    - Add file cleanup and temporary file management
    - Create storage health checks and disk space monitoring
    - Write unit tests for file storage operations
    - _Requirements: 1.1, 1.2, 9.4, 9.5_

  - [x] 6.2 Implement ImgProxy URL generation
    - Create ImgProxy service with signed URL generation
    - Implement configuration validation for IMGPROXY_URL, IMGPROXY_KEY, IMGPROXY_SALT
    - Add fallback to direct storage URLs when ImgProxy is unavailable
    - Write unit tests for ImgProxy URL generation and signing
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [ ] 7. Set up BullMQ job queue system
  - [ ] 7.1 Configure BullMQ queues and workers
    - Set up BullMQ queue configuration with Redis connection
    - Create screenshot job queue with appropriate concurrency settings
    - Implement job retry logic and dead letter queue handling
    - Write unit tests for queue configuration and job lifecycle
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ] 7.2 Implement batch job processing
    - Create batch job processor that handles multiple screenshot items
    - Implement parallel processing with configurable concurrency limits
    - Add individual item failure handling without failing entire batch
    - Write unit tests for batch processing logic
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ] 7.3 Add job scheduling and recurrence
    - Implement scheduled job execution using BullMQ delayed jobs
    - Create recurring job system with cron expression support
    - Add job cancellation and modification capabilities
    - Write unit tests for scheduling and recurrence logic
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 8. Implement webhook notification system
  - [ ] 8.1 Create webhook service
    - Implement webhook delivery with HTTP POST requests
    - Add authentication header support for webhook requests
    - Create webhook payload formatting for batch completion
    - Write unit tests for webhook delivery logic
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ] 8.2 Add webhook retry mechanism
    - Implement exponential backoff retry logic for failed webhooks
    - Add webhook delivery status tracking and logging
    - Create webhook failure alerting and monitoring
    - Write unit tests for retry mechanism and failure handling
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 9. Create API controllers and routes
  - [ ] 9.1 Implement single screenshot endpoint
    - Create POST /screenshot controller method
    - Add request validation and authentication checks
    - Implement cache checking and screenshot generation workflow
    - Write unit tests for single screenshot endpoint
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ] 9.2 Implement batch screenshot endpoints
    - Create POST /batch/screenshots controller for batch job creation
    - Create GET /batch/screenshots/{job_id} controller for status checking
    - Add batch job validation and queue submission logic
    - Write unit tests for batch endpoints
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3_

  - [ ] 9.3 Set up API routes and middleware chain
    - Configure routes in start/routes.ts with proper middleware order
    - Add CORS configuration for API endpoints
    - Implement request logging and error handling middleware
    - Write integration tests for complete request/response flow
    - _Requirements: 2.1, 2.2, 2.3, 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 10. Implement comprehensive error handling
  - [ ] 10.1 Create error response system
    - Define error codes and standardized error response format
    - Implement custom exception classes for different error types
    - Add error logging with correlation IDs and context
    - Write unit tests for error handling and response formatting
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ] 10.2 Add monitoring and health checks
    - Create health check endpoints for system components
    - Implement metrics collection for request rates and processing times
    - Add alerting for critical system failures
    - Write unit tests for health check functionality
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 11. Write comprehensive tests
  - [ ] 11.1 Create integration tests
    - Write integration tests for complete screenshot workflow
    - Test batch job processing from creation to completion
    - Test webhook delivery and retry mechanisms
    - Test rate limiting and authentication flows
    - _Requirements: All requirements_

  - [ ] 11.2 Add performance and load tests
    - Create load tests for concurrent screenshot requests
    - Test queue performance under high batch job loads
    - Measure memory usage and resource consumption
    - Test cache performance and hit rates
    - _Requirements: All requirements_

- [ ] 12. Final integration and deployment preparation
  - [ ] 12.1 Complete system integration
    - Wire all services together in the main application
    - Test complete workflows from API request to ImgProxy URL response
    - Verify webhook delivery for batch job completions
    - Test scheduled and recurring job execution
    - _Requirements: All requirements_

  - [ ] 12.2 Add documentation and deployment configuration
    - Create API documentation with request/response examples
    - Add environment variable documentation and configuration examples
    - Create deployment scripts and Docker configuration if needed
    - Write operational runbooks for monitoring and troubleshooting
    - _Requirements: All requirements_