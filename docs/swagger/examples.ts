/**
 * @swagger
 * components:
 *   examples:
 *     # Screenshot Examples
 *     BasicScreenshot:
 *       summary: Basic website screenshot
 *       description: Simple screenshot with default settings
 *       value:
 *         url: "https://example.com"
 *     
 *     HighResScreenshot:
 *       summary: High resolution screenshot
 *       description: Large viewport with custom dimensions
 *       value:
 *         url: "https://example.com"
 *         format: "png"
 *         width: 1920
 *         height: 1080
 *         fullPage: false
 *         deviceScale: 2
 *     
 *     MobileScreenshot:
 *       summary: Mobile viewport screenshot
 *       description: Screenshot optimized for mobile viewport
 *       value:
 *         url: "https://example.com"
 *         format: "webp"
 *         width: 375
 *         height: 667
 *         userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15"
 *     
 *     FullPageScreenshot:
 *       summary: Full page capture
 *       description: Capture entire page content, not just viewport
 *       value:
 *         url: "https://example.com"
 *         format: "jpeg"
 *         width: 1280
 *         height: 720
 *         fullPage: true
 *         waitFor: 2000
 *     
 *     AdBlockScreenshot:
 *       summary: Screenshot with ad blocking
 *       description: Capture page with ads and tracking scripts blocked
 *       value:
 *         url: "https://example.com"
 *         format: "png"
 *         width: 1280
 *         height: 720
 *         blockAds: true
 *         timeout: 15000
 *     
 *     # Batch Examples
 *     SimpleBatch:
 *       summary: Simple batch job
 *       description: Basic batch screenshot job with minimal configuration
 *       value:
 *         urls:
 *           - "https://example.com"
 *           - "https://google.com"
 *           - "https://github.com"
 *         options:
 *           format: "png"
 *           width: 1280
 *           height: 720
 *     
 *     ScheduledBatch:
 *       summary: Scheduled batch with webhook
 *       description: Batch job scheduled for future execution with webhook notification
 *       value:
 *         urls:
 *           - "https://news.ycombinator.com"
 *           - "https://reddit.com"
 *           - "https://stackoverflow.com"
 *         options:
 *           format: "webp"
 *           width: 1920
 *           height: 1080
 *           fullPage: true
 *           cache: false
 *         webhook_url: "https://your-app.com/webhooks/screenshots"
 *         webhook_auth: "Bearer your-webhook-token"
 *         scheduled_at: "2025-07-27T09:00:00Z"
 *         priority: "high"
 *         concurrency: 5
 *     
 *     LargeBatch:
 *       summary: Large batch job
 *       description: High-volume batch job with custom settings
 *       value:
 *         urls:
 *           - "https://site1.com"
 *           - "https://site2.com"
 *           - "https://site3.com"
 *           # ... up to 100 URLs
 *         options:
 *           format: "jpeg"
 *           width: 1280
 *           height: 720
 *           timeout: 45000
 *           deviceScale: 1.5
 *           waitFor: 3000
 *         priority: "normal"
 *         concurrency: 20
 *     
 *     # Error Examples
 *     ValidationError:
 *       summary: Validation error example
 *       description: Example of validation error response
 *       value:
 *         detail:
 *           error: "VALIDATION_ERROR"
 *           message: "Invalid URL format. Please provide a valid HTTP or HTTPS URL."
 *     
 *     UnauthorizedError:
 *       summary: Unauthorized error example
 *       description: Example of unauthorized access attempt
 *       value:
 *         detail:
 *           error: "UNAUTHORIZED"
 *           message: "Invalid API key. Please check your X-API-Key header."
 *     
 *     RateLimitError:
 *       summary: Rate limit error example
 *       description: Example of rate limit exceeded response
 *       value:
 *         detail:
 *           error: "RATE_LIMITED"
 *           message: "Rate limit exceeded. You can make 100 requests per hour. Try again in 45 minutes."
 *     
 *     NotFoundError:
 *       summary: Resource not found example
 *       description: Example of batch job not found
 *       value:
 *         detail:
 *           error: "JOB_NOT_FOUND"
 *           message: "Batch job with ID 'batch_invalid123' was not found."
 */
