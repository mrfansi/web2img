# web2img

A high-performance FastAPI service that captures website screenshots, uploads them to Cloudflare R2, and generates signed imgproxy URLs for image transformations.

## Features

- Capture website screenshots using Playwright
- Upload screenshots to Cloudflare R2 storage
- Generate signed imgproxy URLs for image transformations
- Handle concurrent requests reliably
- Validate inputs and provide appropriate error responses
- Clean up temporary files automatically

## Requirements

- Python 3.9+
- FastAPI
- Playwright
- boto3 (for R2 storage)
- imgproxy (external service)

## Installation

1. Clone the repository
2. Create a virtual environment: `python -m venv .venv`
3. Activate the virtual environment:
   - Windows: `.venv\Scripts\activate`
   - Unix/macOS: `source .venv/bin/activate`
4. Install dependencies: `pip install -r requirements.txt`
5. Install Playwright browsers: `playwright install`
6. Copy `.env.example` to `.env` and configure your environment variables

## Configuration

Create a `.env` file with the following variables:

```
# R2 Storage Configuration
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
R2_BUCKET=your_bucket_name
R2_PUBLIC_URL=https://your-public-url.example.com
R2_OBJECT_EXPIRATION_DAYS=3  # Number of days before objects are automatically deleted

# imgproxy Configuration
IMGPROXY_BASE_URL=https://your-imgproxy-url.example.com
IMGPROXY_KEY=your_imgproxy_key
IMGPROXY_SALT=your_imgproxy_salt

# Server Configuration
WORKERS=4

# Cache Configuration
CACHE_ENABLED=True
CACHE_TTL_SECONDS=3600
CACHE_MAX_ITEMS=100

# Browser Pool Configuration
BROWSER_POOL_MIN_SIZE=2
BROWSER_POOL_MAX_SIZE=10
BROWSER_POOL_IDLE_TIMEOUT=300
BROWSER_POOL_MAX_AGE=3600
BROWSER_POOL_CLEANUP_INTERVAL=60

# Timeout Configuration (in milliseconds)
NAVIGATION_TIMEOUT_REGULAR=30000
NAVIGATION_TIMEOUT_COMPLEX=60000
BROWSER_LAUNCH_TIMEOUT=60000
CONTEXT_CREATION_TIMEOUT=30000
PAGE_CREATION_TIMEOUT=30000
SCREENSHOT_TIMEOUT=30000

# Retry Configuration
MAX_RETRIES_REGULAR=3
MAX_RETRIES_COMPLEX=5
RETRY_BASE_DELAY=0.5
RETRY_MAX_DELAY=10.0
RETRY_JITTER=0.1

# Circuit Breaker Configuration
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_RESET_TIME=300
```

### R2 Storage Configuration Options

- `R2_ACCESS_KEY_ID`: Your Cloudflare R2 access key ID
- `R2_SECRET_ACCESS_KEY`: Your Cloudflare R2 secret access key
- `R2_ENDPOINT`: Your Cloudflare R2 endpoint URL (https://<accountid>.r2.cloudflarestorage.com)
- `R2_BUCKET`: The name of your R2 bucket for storing screenshots
- `R2_PUBLIC_URL`: The public URL for accessing your R2 bucket
- `R2_OBJECT_EXPIRATION_DAYS`: Number of days before screenshots are automatically deleted (default: `3`)

> **Important**: To use the automatic R2 expiration policy, your R2 API token must have the `PutBucketLifecycleConfiguration` permission. If this permission is missing, the application will still function, but you'll need to configure the lifecycle policy manually through the Cloudflare dashboard.

### Cache Configuration Options

- `CACHE_ENABLED`: Enable or disable the caching system (default: `True`)
- `CACHE_TTL_SECONDS`: Time-to-live for cache items in seconds (default: `3600` - 1 hour)
- `CACHE_MAX_ITEMS`: Maximum number of items to store in the cache (default: `100`)

### Browser Pool Configuration Options

- `BROWSER_POOL_MIN_SIZE`: Minimum number of browser instances to keep in the pool (default: `2`)
- `BROWSER_POOL_MAX_SIZE`: Maximum number of browser instances allowed in the pool (default: `10`)
- `BROWSER_POOL_IDLE_TIMEOUT`: Time in seconds before idle browsers are cleaned up (default: `300` - 5 minutes)
- `BROWSER_POOL_MAX_AGE`: Maximum age in seconds for a browser instance before recycling (default: `3600` - 1 hour)
- `BROWSER_POOL_CLEANUP_INTERVAL`: Interval in seconds for running the cleanup task (default: `60` - 1 minute)

### Timeout Configuration Options

- `NAVIGATION_TIMEOUT_REGULAR`: Timeout in milliseconds for regular site navigation (default: `30000` - 30 seconds)
- `NAVIGATION_TIMEOUT_COMPLEX`: Timeout in milliseconds for complex site navigation (default: `60000` - 60 seconds)
- `BROWSER_LAUNCH_TIMEOUT`: Timeout in milliseconds for browser launch operations (default: `60000` - 60 seconds)
- `CONTEXT_CREATION_TIMEOUT`: Timeout in milliseconds for browser context creation (default: `30000` - 30 seconds)
- `PAGE_CREATION_TIMEOUT`: Timeout in milliseconds for page creation (default: `30000` - 30 seconds)
- `SCREENSHOT_TIMEOUT`: Timeout in milliseconds for screenshot capture (default: `30000` - 30 seconds)

### Retry Configuration Options

- `MAX_RETRIES_REGULAR`: Maximum number of retry attempts for regular sites (default: `3`)
- `MAX_RETRIES_COMPLEX`: Maximum number of retry attempts for complex sites (default: `5`)
- `RETRY_BASE_DELAY`: Base delay in seconds between retries (default: `0.5`)
- `RETRY_MAX_DELAY`: Maximum delay in seconds between retries (default: `10.0`)
- `RETRY_JITTER`: Jitter factor (0-1) to add randomness to delay (default: `0.1`)

### Circuit Breaker Configuration Options

- `CIRCUIT_BREAKER_THRESHOLD`: Number of failures before opening the circuit (default: `5`)
- `CIRCUIT_BREAKER_RESET_TIME`: Time in seconds before attempting to close the circuit (default: `300` - 5 minutes)

## Usage

### API Documentation

The API is documented using OpenAPI and can be accessed through the Swagger UI at `/docs` or ReDoc at `/redoc`. These interactive documentation pages provide detailed information about all endpoints, including:

- Request parameters and schemas
- Response formats and status codes
- Example requests and responses
- Detailed descriptions of each endpoint

The Swagger UI allows you to test the API directly from the browser, making it easy to explore and understand the service's capabilities.

### Running the Server

```bash
python main.py
```

The server configuration is controlled by environment variables:

- `WORKERS`: The number of worker processes (default: 4)

You can also run with uvicorn directly, specifying the environment variables:

```bash
WORKERS=8 PORT=9000 uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers $WORKERS
```

For production, use gunicorn with uvicorn workers:

```bash
WORKERS=8 PORT=9000 gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w $WORKERS -b 0.0.0.0:$PORT
```

Note: `PORT` and `RELOAD` are handled directly in `main.py` and don't need to be defined in the config.

### API Endpoints

#### Capture Screenshot

**POST /screenshot**

Capture a screenshot of a website, upload it to R2, and return a signed imgproxy URL.

Request body:

```json
{
  "url": "https://example.com",
  "format": "png",
  "width": 1280,
  "height": 720
}
```

Query parameters:

- `cache`: Whether to use cache (if available). Set to `false` to bypass cache and force a fresh screenshot. Default: `true`

Response:

```json
{
  "url": "https://your-imgproxy-url.example.com/<signed_imgproxy_path>"
}
```

#### Batch Screenshot Processing

**POST /batch/screenshots**

Submit multiple screenshot requests to be processed as a batch. The batch job will be processed asynchronously, and you can check the status of the job using the returned job ID.

Request body:

```json
{
  "items": [
    {
      "url": "https://example.com",
      "width": 1280,
      "height": 720,
      "format": "png",
      "id": "example-home"
    },
    {
      "url": "https://example.com/about",
      "width": 1280,
      "height": 720,
      "format": "png",
      "id": "example-about"
    }
  ],
  "config": {
    "parallel": 3,
    "timeout": 30,
    "webhook": "https://api.example.com/callbacks/screenshots",
    "webhook_auth": "Bearer token123",
    "fail_fast": false,
    "cache": true
  }
}
```

Configuration options:

- `parallel`: Maximum number of screenshots to process in parallel (default: 3, max: 10)
- `timeout`: Timeout in seconds for each screenshot (default: 30, max: 60)
- `webhook`: Webhook URL to call when batch processing is complete
- `webhook_auth`: Authorization header value for webhook
- `fail_fast`: Whether to stop processing on first failure (default: false)
- `cache`: Whether to use cache for screenshots (default: true)

Response (Status 202 Accepted):

```json
{
  "job_id": "batch-123456",
  "status": "processing",
  "total": 2,
  "completed": 0,
  "failed": 0,
  "created_at": "2025-05-23T00:30:00Z",
  "updated_at": "2025-05-23T00:30:00Z",
  "estimated_completion": "2025-05-23T00:30:10Z"
}
```

**GET /batch/screenshots/{job_id}**

Get the status of a batch screenshot job.

Response:

```json
{
  "job_id": "batch-123456",
  "status": "processing",
  "total": 2,
  "completed": 1,
  "failed": 0,
  "created_at": "2025-05-23T00:30:00Z",
  "updated_at": "2025-05-23T00:30:02Z",
  "estimated_completion": "2025-05-23T00:30:05Z"
}
```

**GET /batch/screenshots/{job_id}/results**

Get the results of a batch screenshot job.

Response:

```json
{
  "job_id": "batch-123456",
  "status": "completed",
  "total": 2,
  "succeeded": 2,
  "failed": 0,
  "processing_time": 3.45,
  "results": [
    {
      "id": "example-home",
      "status": "success",
      "url": "https://your-imgproxy-url.example.com/signed_path/resize:fit:1280:720/format:png/base64_encoded_url",
      "cached": true
    },
    {
      "id": "example-about",
      "status": "success",
      "url": "https://your-imgproxy-url.example.com/signed_path/resize:fit:1280:720/format:png/base64_encoded_url",
      "cached": false
    }
  ]
}
```

#### Health Check

**GET /health**

Check the health status of the service and its dependencies.

Response:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "services": {
    "screenshot": "ok",
    "storage": "ok",
    "imgproxy": "ok",
    "cache": {
      "status": "ok",
      "enabled": true,
      "size": 42,
      "hit_rate": 0.87
    },
    "system": {
      "python": "3.12.8",
      "platform": "macOS-15.4.1-arm64-arm-64bit"
    }
  }
}
```

Possible status values:

- `ok`: All services are functioning properly
- `degraded`: Some services have issues but the API is still operational
- `error`: Critical services are not functioning

## Performance

The service is designed to handle high volumes of concurrent requests reliably. The following optimizations are in place:

### Batch Processing

- Efficient parallel processing of multiple screenshot requests
- Configurable concurrency limits to optimize resource usage
- Job management system with status tracking and results aggregation
- Webhook notifications for asynchronous processing
- Automatic job cleanup to prevent memory leaks
- Integration with the caching system for maximum performance

### Caching System

- In-memory caching of screenshot results for frequently requested URLs
- Configurable TTL (Time-To-Live) for cache items (default: 1 hour)
- LRU (Least Recently Used) eviction policy when cache is full
- Cache control parameters for bypassing cache when needed
- Detailed cache statistics for monitoring performance
- Cache management API for administrators

### Browser Instance Management

- Browser context pooling for efficient resource reuse
- Optimized browser launch settings for reduced resource consumption
- Intelligent resource limiting to prevent memory exhaustion
- Efficient page configuration to block unnecessary resources
- Automatic cleanup of browser resources
- Site-specific handling for complex websites (LinkedIn, YouTube, etc.)
- Visual content handling for image-rich websites

### Site-Specific Optimizations

- **Complex Site Detection**: Automatically detects complex websites that need special handling
- **Adaptive Navigation Strategies**: Uses different navigation strategies based on site complexity
  - Complex sites: Uses 'domcontentloaded' event with extended timeout (configurable, default: 60s)
  - Regular sites: Uses 'networkidle' event with standard timeout (configurable, default: 30s)
- **Visual Content Handling**: Selectively loads images for websites where visual content is important
  - Visual content sites (e.g., Instagram, TikTok): Loads images but blocks audio/video
  - Complex sites (e.g., LinkedIn, YouTube): Blocks only media files
  - Regular sites: Blocks images, fonts, and media files for maximum performance
- **Resource Optimization**: Intelligently blocks or allows resources based on site type
- **Error Recovery**: Enhanced error handling and retry logic for problematic sites

### Connection Pooling

- Boto3 connection pooling for R2 storage operations (50 connections)
- Proper timeout management for connections (connect: 5s, read: 10s)
- Automatic retry logic with exponential backoff
- Rate limiting detection and handling
- Efficient connection cleanup

### Browser Pool Management

- Efficient reuse of browser instances through a managed pool
- Automatic scaling of pool size based on demand (min/max configurable)
- Intelligent browser recycling based on age and idle time
- Background cleanup task to prevent resource leaks
- Thread-safe implementation for concurrent access

### Resilience Features

- **Retry System**: Comprehensive retry system with exponential backoff and jitter
  - Configurable retry attempts based on site complexity
  - Progressive delay between retries to prevent overwhelming services
  - Jitter to prevent retry storms in high-concurrency scenarios
- **Circuit Breaker Pattern**: Prevents cascading failures during outages
  - Automatically detects persistent failures and stops retry attempts
  - Self-healing with half-open state to test recovery
  - Configurable failure threshold and reset timing
- **Timeout Management**: Granular timeout controls for different operations
  - Navigation timeouts adjusted based on site complexity
  - Separate timeouts for browser launch, context creation, and screenshot capture
  - All timeouts configurable via environment variables

### Temporary File Management

- Automatic periodic cleanup of temporary screenshot files (older than 1 hour)
- Efficient resource release to prevent memory leaks
- Robust error handling during cleanup operations

### Asynchronous Processing

- Non-blocking I/O operations throughout the service
- Efficient worker configuration for optimal concurrency
- Proper resource sharing between worker processes

### Cache Management API

#### Get Cache Statistics

**GET /cache/stats**

Get statistics about the cache, including hit rate, size, and configuration.

Response:

```json
{
  "enabled": true,
  "size": 42,
  "max_size": 100,
  "ttl": 3600,
  "hits": 156,
  "misses": 89,
  "hit_rate": 0.637,
  "cleanup_interval": 300
}
```

#### Clear Cache

**DELETE /cache**

Clear all items from the cache.

Response: 204 No Content

#### Invalidate Cache for URL

**DELETE /cache/url**

Invalidate all cache entries for a specific URL.

Query parameters:

- `url`: URL to invalidate in the cache (required)

Response:

```json
{
  "invalidated": 3
}
```

### Testing

#### Load Testing

A load testing script is included in the `tests` directory to verify performance:

```bash
python tests/load_test.py --concurrency 10 --requests 50
```

The script supports the following options:

- `--url`: API base URL (default: <http://localhost:8000>)
- `--concurrency`: Number of concurrent requests (default: 10)
- `--requests`: Total number of requests to make (default: 50)
- `--output`: Optional JSON file to save detailed results

#### Batch Testing

A batch testing script is included to verify the batch processing API performance:

```bash
python tests/test_batch.py --parallel 3
```

The script supports the following options:

- `--url`: API base URL (default: <http://localhost:8000>)
- `--parallel`: Number of parallel requests (default: 3)
- `--no-cache`: Disable caching

The test includes a diverse set of URLs to validate the service's capabilities:

- Regular websites (example.com, google.com)
- Complex websites (LinkedIn, YouTube, Facebook)
- Visual content websites (Instagram, TikTok)

This comprehensive test suite ensures that the service can handle all types of websites, including those that require special handling for complex layouts or visual content.

#### Cache Testing

A cache testing script is included to verify the caching system performance:

```bash
python tests/test_cache.py --iterations 3
```

The script supports the following options:

- `--url`: API base URL (default: <http://localhost:8000>)
- `--iterations`: Number of times to request each URL (default: 3)

## License

MIT
