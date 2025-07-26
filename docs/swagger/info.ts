/**
 * @swagger
 * tags:
 *   - name: Screenshots
 *     description: |
 *       Single screenshot operations for capturing website images.
 *       
 *       ## Features
 *       - Support for PNG, JPEG, and WebP formats
 *       - Customizable viewport dimensions (100x100 to 3840x2160)
 *       - Full page or viewport-only capture
 *       - Built-in caching for improved performance
 *       - Ad blocking and custom user agents
 *       - Device pixel ratio simulation
 *       
 *       ## Rate Limits
 *       - 100 requests per hour for free tier
 *       - 1000 requests per hour for premium tier
 *       
 *       ## Response Times
 *       - Cached results: ~50ms
 *       - New screenshots: 1-5 seconds (depending on page complexity)
 *       
 *   - name: Batch Screenshots
 *     description: |
 *       Batch operations for processing multiple screenshots efficiently.
 *       
 *       ## Features
 *       - Process up to 100 URLs per batch
 *       - Configurable concurrency (1-50 parallel screenshots)
 *       - Priority queue support (high, normal, low)
 *       - Scheduled execution with ISO 8601 timestamps
 *       - Webhook notifications on completion
 *       - Progress tracking and real-time status updates
 *       
 *       ## Workflow
 *       1. Submit batch job with URLs and options
 *       2. Receive job ID and estimated completion time
 *       3. Poll status endpoint or wait for webhook
 *       4. Download completed screenshots from provided URLs
 *       
 *       ## Webhook Format
 *       ```json
 *       {
 *         "job_id": "batch_abc123",
 *         "status": "completed",
 *         "completed_at": "2025-07-26T12:05:30Z",
 *         "results": [
 *           {
 *             "url": "https://example.com",
 *             "screenshot_url": "https://api.web2img.com/images/img1.png",
 *             "status": "completed"
 *           }
 *         ]
 *       }
 *       ```
 *       
 *   - name: Health & Monitoring
 *     description: |
 *       System health checks and monitoring endpoints for operational visibility.
 *       
 *       ## Available Endpoints
 *       - `/health` - Basic system status
 *       - `/health/detailed` - Component-level health details
 *       - `/health/ready` - Kubernetes readiness probe
 *       - `/health/live` - Kubernetes liveness probe
 *       - `/metrics` - Prometheus-compatible metrics
 *       
 *       ## Health Status Values
 *       - `healthy` - All systems operational
 *       - `degraded` - Some non-critical issues detected
 *       - `unhealthy` - Critical systems failing
 *       
 *       ## Monitored Components
 *       - Database connectivity and performance
 *       - Redis cache availability
 *       - Queue system status
 *       - Browser service health
 *       - File storage accessibility
 *       
 * /info:
 *   summary: API Information
 *   description: |
 *     # Web2Img API
 *     
 *     A high-performance website screenshot service designed for developers and businesses
 *     who need reliable, scalable website-to-image conversion capabilities.
 *     
 *     ## Key Features
 *     
 *     ### 🚀 High Performance
 *     - Optimized browser pools for concurrent processing
 *     - Intelligent caching system for instant results
 *     - Queue-based architecture for handling high loads
 *     
 *     ### 📸 Advanced Screenshot Options
 *     - Multiple image formats (PNG, JPEG, WebP)
 *     - Custom viewport dimensions and device scaling
 *     - Full page capture or viewport-only
 *     - Ad blocking and custom user agents
 *     - Wait conditions and timeouts
 *     
 *     ### 🔄 Batch Processing
 *     - Process up to 100 URLs simultaneously
 *     - Configurable concurrency and priority levels
 *     - Scheduled execution for automated workflows
 *     - Webhook notifications for completion status
 *     
 *     ### 🛡️ Enterprise Ready
 *     - API key authentication
 *     - Rate limiting and abuse protection
 *     - Comprehensive monitoring and health checks
 *     - Detailed logging and error tracking
 *     
 *     ## Getting Started
 *     
 *     ### 1. Obtain API Key
 *     Sign up at [web2img.com](https://web2img.com) to get your API key.
 *     
 *     ### 2. Make Your First Request
 *     ```bash
 *     curl -X POST "https://api.web2img.com/screenshot" \
 *       -H "X-API-Key: your-api-key" \
 *       -H "Content-Type: application/json" \
 *       -d '{"url": "https://example.com"}'
 *     ```
 *     
 *     ### 3. Download Your Screenshot
 *     Use the `screenshot_url` from the response to download your image.
 *     
 *     ## Authentication
 *     
 *     All API requests require authentication using an API key passed in the `X-API-Key` header:
 *     
 *     ```
 *     X-API-Key: your-api-key-here
 *     ```
 *     
 *     ## Rate Limiting
 *     
 *     API requests are rate limited to prevent abuse:
 *     
 *     | Plan | Requests per Hour | Batch Size |
 *     |------|------------------|------------|
 *     | Free | 100 | 10 URLs |
 *     | Pro | 1,000 | 50 URLs |
 *     | Enterprise | 10,000 | 100 URLs |
 *     
 *     Rate limit headers are included in all responses:
 *     - `X-RateLimit-Limit` - Total requests allowed per window
 *     - `X-RateLimit-Remaining` - Requests remaining in current window
 *     - `X-RateLimit-Reset` - Unix timestamp when window resets
 *     
 *     ## Error Handling
 *     
 *     The API uses conventional HTTP status codes and returns detailed error information:
 *     
 *     ```json
 *     {
 *       "detail": {
 *         "error": "VALIDATION_ERROR",
 *         "message": "Invalid URL format provided"
 *       }
 *     }
 *     ```
 *     
 *     Common error codes:
 *     - `VALIDATION_ERROR` - Invalid request parameters
 *     - `UNAUTHORIZED` - Invalid or missing API key
 *     - `RATE_LIMITED` - Too many requests
 *     - `TIMEOUT_ERROR` - Screenshot capture timed out
 *     - `NETWORK_ERROR` - Unable to reach target URL
 *     
 *     ## Support
 *     
 *     - 📧 Email: support@web2img.com
 *     - 📚 Documentation: [docs.web2img.com](https://docs.web2img.com)
 *     - 🐛 Issues: [github.com/web2img/api](https://github.com/web2img/api)
 */
