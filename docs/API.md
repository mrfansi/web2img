# Website Screenshot API Documentation

## Overview

The Website Screenshot API provides powerful screenshot generation capabilities for web pages through both single and batch processing endpoints. The API supports various screenshot configurations, intelligent caching, queue management, webhook notifications, and scheduled/recurring batch jobs.

## 📚 Interactive Documentation

**🎯 For the complete, interactive API documentation, visit:**
```
http://localhost:3333/docs
```

The Swagger UI provides:
- Complete API reference with all endpoints
- Interactive testing interface
- Request/response examples
- Authentication setup
- Parameter validation
- Error code documentation

**📋 OpenAPI Specification:**
```
http://localhost:3333/docs/openapi.json
```

---

## Quick Reference

### Base URL

```
https://your-domain.com
```

## Authentication

All API endpoints require authentication using an API key passed in the `X-API-Key` header.

```http
X-API-Key: your-api-key-here
```

## Rate Limiting

API requests are rate-limited based on your API key configuration. Rate limit information is included in response headers:

- `X-RateLimit-Limit`: Maximum requests allowed per time window
- `X-RateLimit-Remaining`: Remaining requests in current time window
- `X-RateLimit-Reset`: Time when the rate limit resets

## Error Handling

The API uses standard HTTP status codes and returns error responses in the following format:

```json
{
  "detail": {
    "error": "error_code",
    "message": "Human-readable error message",
    "retry_after": 60
  }
}
```

### Common Error Codes

- `missing_api_key`: API key not provided
- `invalid_api_key`: API key is invalid or expired
- `rate_limited`: Rate limit exceeded
- `validation_failed`: Request validation failed
- `invalid_url`: URL is invalid or inaccessible
- `timeout`: Screenshot capture timed out
- `screenshot_failed`: Screenshot generation failed
- `storage_error`: File storage error
- `service_overloaded`: Service temporarily overloaded

## Endpoints

### Single Screenshot

Generate a screenshot of a single web page.

#### Request

```http
POST /screenshot
Content-Type: application/json
X-API-Key: your-api-key-here

{
  "url": "https://example.com",
  "format": "png",
  "width": 1280,
  "height": 720,
  "timeout": 30000,
  "cache": true
}
```

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | - | URL of the webpage to screenshot |
| `format` | string | No | `"png"` | Image format: `"png"`, `"jpeg"`, `"webp"` |
| `width` | integer | No | `1280` | Viewport width (1-5000 pixels) |
| `height` | integer | No | `720` | Viewport height (1-5000 pixels) |
| `timeout` | integer | No | `30000` | Page load timeout in milliseconds (5000-60000) |
| `cache` | boolean | No | `true` | Whether to use cached results |

#### Response

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "url": "https://imgproxy.example.com/signature/screenshot.png",
  "cached": false
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | ImgProxy URL for the generated screenshot |
| `cached` | boolean | Whether the result was served from cache |

### Create Batch Job

Create a batch job to process multiple screenshots.

#### Request

```http
POST /batch/screenshots
Content-Type: application/json
X-API-Key: your-api-key-here

{
  "items": [
    {
      "id": "item-1",
      "url": "https://example.com",
      "format": "png",
      "width": 1280,
      "height": 720
    },
    {
      "id": "item-2",
      "url": "https://google.com",
      "format": "jpeg",
      "width": 800,
      "height": 600
    }
  ],
  "config": {
    "parallel": 3,
    "timeout": 30000,
    "webhook": "https://your-app.com/webhook",
    "webhook_auth": "Bearer your-webhook-token",
    "fail_fast": false,
    "cache": true,
    "priority": "normal",
    "scheduled_time": "2024-01-15T10:00:00Z",
    "recurrence": "daily",
    "recurrence_interval": 1,
    "recurrence_count": 30
  }
}
```

#### Parameters

##### Items Array

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `id` | string | Yes | - | Unique identifier for the item |
| `url` | string | Yes | - | URL of the webpage to screenshot |
| `format` | string | No | `"png"` | Image format: `"png"`, `"jpeg"`, `"webp"` |
| `width` | integer | No | `1280` | Viewport width (1-5000 pixels) |
| `height` | integer | No | `720` | Viewport height (1-5000 pixels) |

##### Config Object

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `parallel` | integer | No | `3` | Number of parallel processes (1-50) |
| `timeout` | integer | No | `30000` | Page load timeout in milliseconds (5000-60000) |
| `webhook` | string | No | - | Webhook URL for completion notification |
| `webhook_auth` | string | No | - | Authorization header for webhook requests |
| `fail_fast` | boolean | No | `false` | Stop processing on first failure |
| `cache` | boolean | No | `true` | Whether to use cached results |
| `priority` | string | No | `"normal"` | Job priority: `"high"`, `"normal"`, `"low"` |
| `scheduled_time` | string | No | - | ISO 8601 timestamp for scheduled execution |
| `recurrence` | string | No | - | Recurrence pattern: `"hourly"`, `"daily"`, `"weekly"`, `"monthly"` |
| `recurrence_interval` | integer | No | `1` | Interval for recurrence |
| `recurrence_count` | integer | No | - | Maximum number of recurrences |
| `recurrence_cron` | string | No | - | Custom cron expression for scheduling |

#### Response

```http
HTTP/1.1 202 Accepted
Content-Type: application/json

{
  "job_id": "batch-job-123",
  "status": "pending",
  "total": 2,
  "completed": 0,
  "failed": 0,
  "created_at": "2024-01-15T09:00:00Z",
  "updated_at": "2024-01-15T09:00:00Z",
  "scheduled_time": "2024-01-15T10:00:00Z",
  "estimated_completion": "2024-01-15T10:05:00Z"
}
```

### Get Batch Job Status

Retrieve the status and results of a batch job.

#### Request

```http
GET /batch/screenshots/{job_id}
X-API-Key: your-api-key-here
```

#### Response

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "job_id": "batch-job-123",
  "status": "completed",
  "total": 2,
  "completed": 2,
  "failed": 0,
  "progress_percentage": 100,
  "created_at": "2024-01-15T09:00:00Z",
  "updated_at": "2024-01-15T10:05:00Z",
  "completed_at": "2024-01-15T10:05:00Z",
  "config": {
    "parallel": 3,
    "timeout": 30000,
    "cache": true
  },
  "results": [
    {
      "itemId": "item-1",
      "status": "success",
      "url": "https://imgproxy.example.com/signature/screenshot1.png",
      "cached": false,
      "processingTime": 2500
    },
    {
      "itemId": "item-2",
      "status": "success",
      "url": "https://imgproxy.example.com/signature/screenshot2.jpg",
      "cached": true,
      "processingTime": 150
    }
  ]
}
```

#### Status Values

- `pending`: Job is queued but not yet started
- `scheduled`: Job is scheduled for future execution
- `processing`: Job is currently being processed
- `completed`: Job completed successfully
- `failed`: Job failed to complete

## Webhook Notifications

When a webhook URL is provided in batch job configuration, the system will send a POST request to the webhook URL upon job completion.

### Webhook Payload

```json
{
  "job_id": "batch-job-123",
  "status": "completed",
  "total": 2,
  "completed": 2,
  "failed": 0,
  "created_at": "2024-01-15T09:00:00Z",
  "completed_at": "2024-01-15T10:05:00Z",
  "processing_time": 300000,
  "results": [
    {
      "itemId": "item-1",
      "status": "success",
      "url": "https://imgproxy.example.com/signature/screenshot1.png",
      "cached": false,
      "processingTime": 2500
    },
    {
      "itemId": "item-2",
      "status": "error",
      "error": "Failed to capture screenshot: timeout",
      "processingTime": 30000
    }
  ]
}
```

### Webhook Headers

```http
POST /your-webhook-endpoint
Content-Type: application/json
User-Agent: web2img-webhook/1.0
Authorization: Bearer your-webhook-token
```

### Webhook Retry Logic

- Failed webhook deliveries are retried with exponential backoff
- Maximum of 5 retry attempts
- Base delay of 1 second, maximum delay of 30 seconds

## Health Check Endpoints

### Basic Health Check

```http
GET /health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:00:00Z",
  "uptime": 3600
}
```

### Detailed Health Check

```http
GET /health/detailed
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:00:00Z",
  "uptime": 3600,
  "components": {
    "database": {
      "status": "healthy",
      "responseTime": 5
    },
    "redis": {
      "status": "healthy",
      "responseTime": 2
    },
    "browser": {
      "status": "healthy",
      "responseTime": 10
    },
    "storage": {
      "status": "healthy",
      "responseTime": 3
    }
  }
}
```

## Metrics Endpoints

### Request Metrics

```http
GET /metrics/requests
```

### Processing Metrics

```http
GET /metrics/processing
```

### System Metrics

```http
GET /metrics/system
```

## Examples

### Single Screenshot Example

```bash
curl -X POST https://api.example.com/screenshot \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url": "https://example.com",
    "format": "png",
    "width": 1920,
    "height": 1080,
    "cache": true
  }'
```

### Batch Job Example

```bash
curl -X POST https://api.example.com/batch/screenshots \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "items": [
      {
        "id": "homepage",
        "url": "https://example.com",
        "format": "png"
      },
      {
        "id": "about",
        "url": "https://example.com/about",
        "format": "jpeg"
      }
    ],
    "config": {
      "parallel": 2,
      "webhook": "https://your-app.com/webhook",
      "webhook_auth": "Bearer webhook-token"
    }
  }'
```

### Scheduled Batch Job Example

```bash
curl -X POST https://api.example.com/batch/screenshots \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "items": [
      {
        "id": "daily-report",
        "url": "https://dashboard.example.com/report",
        "format": "png",
        "width": 1920,
        "height": 1080
      }
    ],
    "config": {
      "scheduled_time": "2024-01-16T08:00:00Z",
      "recurrence": "daily",
      "recurrence_count": 30,
      "webhook": "https://your-app.com/daily-report-webhook"
    }
  }'
```

## SDKs and Libraries

### JavaScript/Node.js

```javascript
const ScreenshotAPI = require('@your-org/screenshot-api');

const client = new ScreenshotAPI({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.example.com'
});

// Single screenshot
const screenshot = await client.screenshot({
  url: 'https://example.com',
  format: 'png',
  width: 1280,
  height: 720
});

// Batch job
const batchJob = await client.createBatch({
  items: [
    { id: 'item1', url: 'https://example.com' },
    { id: 'item2', url: 'https://google.com' }
  ],
  config: {
    parallel: 2,
    webhook: 'https://your-app.com/webhook'
  }
});

// Check batch status
const status = await client.getBatchStatus(batchJob.job_id);
```

### Python

```python
from screenshot_api import ScreenshotClient

client = ScreenshotClient(
    api_key='your-api-key',
    base_url='https://api.example.com'
)

# Single screenshot
screenshot = client.screenshot(
    url='https://example.com',
    format='png',
    width=1280,
    height=720
)

# Batch job
batch_job = client.create_batch(
    items=[
        {'id': 'item1', 'url': 'https://example.com'},
        {'id': 'item2', 'url': 'https://google.com'}
    ],
    config={
        'parallel': 2,
        'webhook': 'https://your-app.com/webhook'
    }
)

# Check batch status
status = client.get_batch_status(batch_job['job_id'])
```

## Best Practices

### Performance Optimization

1. **Use Caching**: Enable caching for frequently requested URLs
2. **Batch Processing**: Use batch jobs for multiple screenshots
3. **Appropriate Dimensions**: Use reasonable viewport dimensions
4. **Parallel Processing**: Configure appropriate parallel limits
5. **Timeout Settings**: Set reasonable timeouts based on page complexity

### Error Handling

1. **Retry Logic**: Implement exponential backoff for transient errors
2. **Webhook Reliability**: Ensure webhook endpoints are reliable
3. **Status Monitoring**: Regularly check batch job status
4. **Graceful Degradation**: Handle service unavailability gracefully

### Security

1. **API Key Management**: Rotate API keys regularly
2. **Webhook Security**: Validate webhook authenticity
3. **URL Validation**: Validate URLs before submission
4. **Rate Limiting**: Respect rate limits and implement backoff

### Monitoring

1. **Health Checks**: Monitor service health endpoints
2. **Metrics Tracking**: Track request rates and processing times
3. **Error Monitoring**: Monitor error rates and types
4. **Resource Usage**: Monitor queue depths and processing capacity

## Troubleshooting

### Common Issues

#### Screenshot Timeouts
- Increase timeout value for slow-loading pages
- Check if the target URL is accessible
- Verify network connectivity

#### Rate Limiting
- Check rate limit headers in responses
- Implement exponential backoff
- Consider upgrading API key limits

#### Webhook Failures
- Verify webhook URL accessibility
- Check webhook authentication
- Monitor webhook delivery logs

#### Cache Issues
- Disable cache for testing
- Check cache TTL settings
- Verify cache key generation

### Support

For technical support and questions:
- Email: support@example.com
- Documentation: https://docs.example.com
- Status Page: https://status.example.com