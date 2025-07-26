import swaggerJsdoc from 'swagger-jsdoc'
import swaggerUiExpress from 'swagger-ui-express'
import type { OpenAPIV3 } from 'openapi-types'
import env from '#start/env'

/**
 * Service for handling OpenAPI/Swagger documentation
 */
class SwaggerService {
    private _spec: OpenAPIV3.Document | null = null

    /**
     * Initialize the Swagger documentation
     */
    initialize(): void {
        const options: swaggerJsdoc.Options = {
            definition: {
                openapi: '3.0.0',
                info: {
                    title: 'Web2Img API',
                    version: '1.0.0',
                    description: 'High-performance website screenshot service with queue processing and batch operations',
                    contact: {
                        name: 'Web2Img Support',
                        email: 'support@web2img.com',
                    },
                    license: {
                        name: 'Private',
                    },
                },
                servers: [
                    {
                        url: 'https://api.web2img.com',
                        description: 'Production server',
                    },
                ],
                components: {
                    securitySchemes: {
                        ApiKeyAuth: {
                            type: 'apiKey',
                            in: 'header',
                            name: 'X-API-Key',
                            description: 'API key for authentication',
                        },
                    },
                    schemas: {
                        Error: {
                            type: 'object',
                            properties: {
                                detail: {
                                    type: 'object',
                                    properties: {
                                        error: {
                                            type: 'string',
                                            description: 'Error code',
                                        },
                                        message: {
                                            type: 'string',
                                            description: 'Human-readable error message',
                                        },
                                    },
                                    required: ['error', 'message'],
                                },
                            },
                            required: ['detail'],
                        },
                        ScreenshotRequest: {
                            type: 'object',
                            properties: {
                                url: {
                                    type: 'string',
                                    format: 'uri',
                                    description: 'URL of the website to screenshot',
                                    example: 'https://example.com',
                                },
                                format: {
                                    type: 'string',
                                    enum: ['png', 'jpeg', 'webp'],
                                    default: 'png',
                                    description: 'Output image format',
                                },
                                width: {
                                    type: 'integer',
                                    minimum: 100,
                                    maximum: 3840,
                                    default: 1280,
                                    description: 'Screenshot width in pixels',
                                },
                                height: {
                                    type: 'integer',
                                    minimum: 100,
                                    maximum: 2160,
                                    default: 720,
                                    description: 'Screenshot height in pixels',
                                },
                                timeout: {
                                    type: 'integer',
                                    minimum: 5000,
                                    maximum: 60000,
                                    default: 30000,
                                    description: 'Request timeout in milliseconds',
                                },
                                cache: {
                                    type: 'boolean',
                                    default: true,
                                    description: 'Whether to use cached results if available',
                                },
                                fullPage: {
                                    type: 'boolean',
                                    default: false,
                                    description: 'Capture full page instead of viewport',
                                },
                                waitFor: {
                                    type: 'integer',
                                    minimum: 0,
                                    maximum: 10000,
                                    description: 'Additional wait time in milliseconds before capturing',
                                },
                                userAgent: {
                                    type: 'string',
                                    description: 'Custom user agent string',
                                },
                                deviceScale: {
                                    type: 'number',
                                    minimum: 0.5,
                                    maximum: 3,
                                    default: 1,
                                    description: 'Device pixel ratio',
                                },
                                blockAds: {
                                    type: 'boolean',
                                    default: false,
                                    description: 'Block ads and tracking scripts',
                                },
                            },
                            required: ['url'],
                        },
                        ScreenshotResponse: {
                            type: 'object',
                            properties: {
                                success: {
                                    type: 'boolean',
                                    description: 'Whether the request was successful',
                                },
                                screenshot_url: {
                                    type: 'string',
                                    format: 'uri',
                                    description: 'URL to access the screenshot',
                                },
                                cache_hit: {
                                    type: 'boolean',
                                    description: 'Whether the result was served from cache',
                                },
                                processing_time_ms: {
                                    type: 'integer',
                                    description: 'Total processing time in milliseconds',
                                },
                                file_size_bytes: {
                                    type: 'integer',
                                    description: 'Screenshot file size in bytes',
                                },
                                expires_at: {
                                    type: 'string',
                                    format: 'date-time',
                                    description: 'When the screenshot URL expires',
                                },
                            },
                            required: ['success', 'screenshot_url'],
                        },
                        BatchScreenshotRequest: {
                            type: 'object',
                            properties: {
                                urls: {
                                    type: 'array',
                                    items: {
                                        type: 'string',
                                        format: 'uri',
                                    },
                                    minItems: 1,
                                    maxItems: 100,
                                    description: 'List of URLs to screenshot (max 100)',
                                },
                                options: {
                                    $ref: '#/components/schemas/BatchOptions',
                                },
                                webhook_url: {
                                    type: 'string',
                                    format: 'uri',
                                    description: 'URL to receive completion webhook',
                                },
                                webhook_auth: {
                                    type: 'string',
                                    description: 'Authentication header value for webhook',
                                },
                                scheduled_at: {
                                    type: 'string',
                                    format: 'date-time',
                                    description: 'ISO 8601 timestamp for scheduled execution',
                                },
                                priority: {
                                    type: 'string',
                                    enum: ['high', 'normal', 'low'],
                                    default: 'normal',
                                    description: 'Job priority level',
                                },
                                concurrency: {
                                    type: 'integer',
                                    minimum: 1,
                                    maximum: 50,
                                    default: 5,
                                    description: 'Number of parallel screenshots',
                                },
                            },
                            required: ['urls'],
                        },
                        BatchOptions: {
                            type: 'object',
                            properties: {
                                format: {
                                    type: 'string',
                                    enum: ['png', 'jpeg', 'webp'],
                                    default: 'png',
                                },
                                width: {
                                    type: 'integer',
                                    minimum: 100,
                                    maximum: 3840,
                                    default: 1280,
                                },
                                height: {
                                    type: 'integer',
                                    minimum: 100,
                                    maximum: 2160,
                                    default: 720,
                                },
                                timeout: {
                                    type: 'integer',
                                    minimum: 5000,
                                    maximum: 60000,
                                    default: 30000,
                                },
                                cache: {
                                    type: 'boolean',
                                    default: true,
                                },
                                fullPage: {
                                    type: 'boolean',
                                    default: false,
                                },
                                waitFor: {
                                    type: 'integer',
                                    minimum: 0,
                                    maximum: 10000,
                                },
                                userAgent: {
                                    type: 'string',
                                },
                                deviceScale: {
                                    type: 'number',
                                    minimum: 0.5,
                                    maximum: 3,
                                    default: 1,
                                },
                                blockAds: {
                                    type: 'boolean',
                                    default: false,
                                },
                            },
                        },
                        BatchJobResponse: {
                            type: 'object',
                            properties: {
                                success: {
                                    type: 'boolean',
                                },
                                job_id: {
                                    type: 'string',
                                    description: 'Unique identifier for the batch job',
                                },
                                status: {
                                    type: 'string',
                                    enum: ['pending', 'processing', 'completed', 'failed'],
                                },
                                total_urls: {
                                    type: 'integer',
                                    description: 'Total number of URLs in the batch',
                                },
                                estimated_completion: {
                                    type: 'string',
                                    format: 'date-time',
                                    description: 'Estimated completion time',
                                },
                            },
                            required: ['success', 'job_id', 'status'],
                        },
                        BatchStatusResponse: {
                            type: 'object',
                            properties: {
                                job_id: {
                                    type: 'string',
                                },
                                status: {
                                    type: 'string',
                                    enum: ['pending', 'processing', 'completed', 'failed'],
                                },
                                progress: {
                                    type: 'object',
                                    properties: {
                                        completed: {
                                            type: 'integer',
                                            description: 'Number of completed screenshots',
                                        },
                                        failed: {
                                            type: 'integer',
                                            description: 'Number of failed screenshots',
                                        },
                                        total: {
                                            type: 'integer',
                                            description: 'Total number of screenshots',
                                        },
                                        percentage: {
                                            type: 'number',
                                            minimum: 0,
                                            maximum: 100,
                                            description: 'Completion percentage',
                                        },
                                    },
                                },
                                results: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            url: {
                                                type: 'string',
                                                format: 'uri',
                                            },
                                            screenshot_url: {
                                                type: 'string',
                                                format: 'uri',
                                            },
                                            status: {
                                                type: 'string',
                                                enum: ['completed', 'failed', 'pending'],
                                            },
                                            error: {
                                                type: 'string',
                                                description: 'Error message if status is failed',
                                            },
                                        },
                                    },
                                },
                                created_at: {
                                    type: 'string',
                                    format: 'date-time',
                                },
                                completed_at: {
                                    type: 'string',
                                    format: 'date-time',
                                },
                            },
                            required: ['job_id', 'status'],
                        },
                        HealthResponse: {
                            type: 'object',
                            properties: {
                                status: {
                                    type: 'string',
                                    enum: ['healthy', 'unhealthy', 'degraded'],
                                },
                                timestamp: {
                                    type: 'string',
                                    format: 'date-time',
                                },
                                uptime: {
                                    type: 'number',
                                    description: 'Application uptime in seconds',
                                },
                            },
                            required: ['status', 'timestamp'],
                        },
                        DetailedHealthResponse: {
                            type: 'object',
                            properties: {
                                status: {
                                    type: 'string',
                                    enum: ['healthy', 'unhealthy', 'degraded'],
                                },
                                timestamp: {
                                    type: 'string',
                                    format: 'date-time',
                                },
                                uptime: {
                                    type: 'number',
                                },
                                components: {
                                    type: 'object',
                                    properties: {
                                        database: {
                                            $ref: '#/components/schemas/ComponentHealth',
                                        },
                                        redis: {
                                            $ref: '#/components/schemas/ComponentHealth',
                                        },
                                        queues: {
                                            $ref: '#/components/schemas/ComponentHealth',
                                        },
                                        browser: {
                                            $ref: '#/components/schemas/ComponentHealth',
                                        },
                                        storage: {
                                            $ref: '#/components/schemas/ComponentHealth',
                                        },
                                    },
                                },
                            },
                            required: ['status', 'timestamp', 'components'],
                        },
                        ComponentHealth: {
                            type: 'object',
                            properties: {
                                status: {
                                    type: 'string',
                                    enum: ['healthy', 'unhealthy', 'degraded'],
                                },
                                response_time: {
                                    type: 'number',
                                    description: 'Response time in milliseconds',
                                },
                                details: {
                                    type: 'object',
                                    description: 'Component-specific health details',
                                },
                            },
                            required: ['status'],
                        },
                        RateLimitHeaders: {
                            type: 'object',
                            properties: {
                                'X-RateLimit-Limit': {
                                    type: 'integer',
                                    description: 'Total number of requests allowed per window',
                                },
                                'X-RateLimit-Remaining': {
                                    type: 'integer',
                                    description: 'Number of requests remaining in current window',
                                },
                                'X-RateLimit-Reset': {
                                    type: 'integer',
                                    description: 'Unix timestamp when the rate limit window resets',
                                },
                            },
                        },
                    },
                    responses: {
                        BadRequest: {
                            description: 'Bad Request - Invalid input parameters',
                            content: {
                                'application/json': {
                                    schema: {
                                        $ref: '#/components/schemas/Error',
                                    },
                                    example: {
                                        detail: {
                                            error: 'VALIDATION_ERROR',
                                            message: 'Invalid URL format provided',
                                        },
                                    },
                                },
                            },
                        },
                        Unauthorized: {
                            description: 'Unauthorized - Invalid or missing API key',
                            content: {
                                'application/json': {
                                    schema: {
                                        $ref: '#/components/schemas/Error',
                                    },
                                    example: {
                                        detail: {
                                            error: 'UNAUTHORIZED',
                                            message: 'Invalid API key',
                                        },
                                    },
                                },
                            },
                        },
                        RateLimited: {
                            description: 'Too Many Requests - Rate limit exceeded',
                            headers: {
                                'X-RateLimit-Limit': {
                                    schema: {
                                        type: 'integer',
                                    },
                                },
                                'X-RateLimit-Remaining': {
                                    schema: {
                                        type: 'integer',
                                    },
                                },
                                'X-RateLimit-Reset': {
                                    schema: {
                                        type: 'integer',
                                    },
                                },
                            },
                            content: {
                                'application/json': {
                                    schema: {
                                        $ref: '#/components/schemas/Error',
                                    },
                                    example: {
                                        detail: {
                                            error: 'RATE_LIMITED',
                                            message: 'Rate limit exceeded. Try again later.',
                                        },
                                    },
                                },
                            },
                        },
                        InternalError: {
                            description: 'Internal Server Error',
                            content: {
                                'application/json': {
                                    schema: {
                                        $ref: '#/components/schemas/Error',
                                    },
                                    example: {
                                        detail: {
                                            error: 'INTERNAL_ERROR',
                                            message: 'An unexpected error occurred',
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                security: [
                    {
                        ApiKeyAuth: [],
                    },
                ],
            },
            apis: [
                './app/controllers/*.ts',
                './start/routes.ts',
                './docs/swagger/*.ts',
            ],
        }

        this._spec = swaggerJsdoc(options) as OpenAPIV3.Document
    }

    /**
     * Get the OpenAPI specification
     */
    getSpec(): OpenAPIV3.Document {
        if (!this._spec) {
            this.initialize()
        }
        return this._spec!
    }

    /**
     * Get Swagger UI middleware
     */
    getUiMiddleware() {
        return swaggerUiExpress.serve
    }

    /**
     * Get Swagger UI setup
     */
    getUiSetup() {
        const spec = this.getSpec()
        return swaggerUiExpress.setup(spec, {
            explorer: true,
            customCss: `
        .swagger-ui .topbar { display: none }
        .swagger-ui .info .title { color: #3b82f6 }
      `,
            customSiteTitle: 'Web2Img API Documentation',
            swaggerOptions: {
                persistAuthorization: true,
                displayRequestDuration: true,
                filter: true,
                tryItOutEnabled: true,
            },
        })
    }

    /**
     * Get the OpenAPI spec as JSON
     */
    getSpecJson(): string {
        return JSON.stringify(this.getSpec(), null, 2)
    }
}

// Export singleton instance
const swaggerService = new SwaggerService()
export default swaggerService
