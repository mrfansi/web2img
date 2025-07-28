# Web2Img AI Coding Agent Instructions

## Architecture Overview

Web2Img is a high-performance website screenshot service built with **AdonisJS v6** using a microservices-oriented architecture with Redis queues and browser automation. The system processes screenshot requests through multiple stages: URL validation → queue processing → browser capture → file storage → ImgProxy URL generation.

### Core Service Dependencies

```
ApplicationBootstrap → CentralRedisManager → QueueService → BrowserService
                    ↘ CacheService → FileStorageService → ImgProxyService
```

## Critical Patterns & Conventions

### Singleton Services with Centralized Redis Management

Most services follow the singleton pattern. **Always use `getCentralRedisManager()`** for Redis connections:

```typescript
// ✅ Correct - shared connection for simple operations
const client = getCentralRedisManager().getClient()
await client.get('key')

// ✅ Correct - duplicate for BullMQ/blocking operations
const bullmqClient = getCentralRedisManager().duplicateForBullMQ()
// Must call await client.quit() when done!
```

### Import Path Patterns

Use AdonisJS path imports exclusively:

- `#services/*` for services (singletons)
- `#controllers/*` for HTTP controllers
- `#middleware/*` for middleware
- `#models/*` for Lucid models
- `#validators/*` for Vine validators
- `#types/*` for TypeScript interfaces

### Queue Architecture

Screenshot processing uses **BullMQ** with two queue types:

- `screenshot` queue: Single screenshot jobs
- `batch` queue: Bulk processing jobs

Queue workers are managed by `ApplicationBootstrap` and must be properly initialized/shutdown.

### Service Layer Structure

Services are organized by responsibility:

- **Worker Services**: `screenshot_worker_service`, `screenshot_queue_worker`, `batch_queue_worker`
- **Infrastructure**: `browser_service`, `cache_service`, `file_storage_service`, `redis_service`
- **External Integration**: `imgproxy_service`, `webhook_service`, `url_transformation_service`
- **System**: `application_bootstrap`, `config_service`, `metrics_service`, `health_check_service`

## Development Workflows

### Testing Approach

The project uses **Japa** with automatic Redis connection leak detection. Tests are organized in:

- `unit/` - Service and component unit tests
- `integration/` - Cross-service integration tests
- `performance/` - Load and performance tests

**Critical**: All tests include automatic Redis connection leak detection in `tests/bootstrap.ts`. Tests will fail if connections aren't properly closed.

### Application Lifecycle Management

**ApplicationBootstrap** manages the complete system lifecycle:

```typescript
// Always initialize in this order
await applicationBootstrap.initialize()
// ... run application
await applicationBootstrap.shutdown() // Graceful shutdown
```

The bootstrap handles proper service initialization order and graceful shutdown with queue draining.

### Error Handling & Health Checks

- Each service implements `healthCheck()` for monitoring
- Use structured logging with correlation IDs via `CorrelationService`
- Errors follow the pattern: `{ detail: { error: 'code', message: 'description' } }`

## Key Integration Points

### API Request/Response Patterns

All API endpoints follow consistent patterns:

- **Authentication**: `X-API-Key` header required for all endpoints
- **Rate Limiting**: Headers include `X-RateLimit-*` fields for client throttling
- **Error Format**: `{ detail: { error: 'code', message: 'description' } }`
- **Validation**: Request validation via `#validators/screenshot_validator`
- **Status Codes**: 200 (success), 202 (accepted/queued), 429 (rate limited), 401 (auth failed)

API routes structure:

```typescript
// Health/metrics routes (no auth)
router.get('/health/**')
router.get('/metrics/**')

// Screenshot API routes (full middleware stack)
router.post('/screenshot') // Single screenshot
router.post('/batch/screenshots') // Create batch job
router.get('/batch/screenshots/:job_id') // Get batch status
```

### Screenshot Processing Pipeline

1. **Validation**: `screenshot_validator` validates requests with format/dimension limits
2. **Cache Check**: Redis-backed caching with TTL and cache key generation
3. **Queue Processing**: BullMQ handles async processing with priority levels
4. **Browser Automation**: Playwright via `browser_service` with timeout management
5. **File Storage**: Local filesystem with configurable paths and cleanup
6. **URL Generation**: ImgProxy for optimization with fallback to direct URLs
7. **Webhook Delivery**: Optional notifications with retry logic and authentication

### Batch Processing & Scheduling

The system supports complex batch operations with:

- **Parallel Processing**: Configurable concurrency (1-50 parallel jobs)
- **Scheduled Jobs**: ISO 8601 timestamps with cron-based recurrence
- **Job Priorities**: `high`, `normal`, `low` queue priorities
- **Progress Tracking**: Real-time status updates and completion percentages
- **Webhook Integration**: Delivery with exponential backoff retry (max 5 attempts)

### Database Models

- `User` - API key owners
- `ApiKey` - Authentication tokens with rate limits
- `BatchJob` - Bulk processing job tracking

Uses **Lucid ORM** with MySQL. Migrations are timestamp-based in `database/migrations/`.

## Configuration & Environment

Critical environment variables:

- Redis: Standard AdonisJS Redis config
- Storage: `STORAGE_PATH`, `STORAGE_BASE_URL`
- ImgProxy: `IMGPROXY_BASE_URL`, `IMGPROXY_KEY`, `IMGPROXY_SALT` (optional)
- Browser: Playwright headless mode settings

Use `ConfigService` for validated environment access with runtime checks.

## Testing & Development Commands

```bash
npm run dev         # Development with HMR
npm test           # Full test suite with leak detection
npm run build      # Production build
node ace migration:run  # Database migrations
```

## Common Pitfalls

1. **Redis Connection Leaks**: Always `await client.quit()` on duplicated connections
2. **Service Initialization Order**: Use `ApplicationBootstrap.initialize()` - don't initialize services manually
3. **Queue Shutdown**: Ensure proper queue draining before Redis shutdown
4. **Test Cleanup**: The test framework will catch Redis leaks - fix them immediately
5. **Path Imports**: Never use relative imports - always use `#services/*` patterns
6. **Webhook Authentication**: Include `webhook_auth` header when configuring batch jobs with webhooks
7. **Batch Job Monitoring**: Always check job status via `/batch/screenshots/:job_id` for long-running operations

When modifying queue processing, browser automation, or Redis usage, always run the integration tests to verify proper resource cleanup.
