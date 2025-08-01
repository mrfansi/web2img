import swaggerJsdoc from 'swagger-jsdoc'
import swaggerUiExpress from 'swagger-ui-express'
import type { OpenAPIV3 } from 'openapi-types'
import schemaRegistry from '#services/schema_registry'
import vineSchemaGenerator from '#services/vine_schema_generator'
import type { ValidationResult } from '#services/schema_registry'

/**
 * Enhanced service for handling OpenAPI/Swagger documentation
 */
class SwaggerService {
  private _spec: OpenAPIV3.Document | null = null
  private _initialized: boolean = false

  /**
   * Initialize the Swagger documentation with enhanced schema registry
   */
  initialize(): void {
    if (this._initialized) {
      return
    }

    // Initialize schema registry first
    schemaRegistry.initialize()

    this._initializeSwaggerSpec()
    this._initialized = true
  }

  /**
   * Initialize the core Swagger specification
   */
  private _initializeSwaggerSpec(): void {
    const options: swaggerJsdoc.Options = {
      definition: {
        openapi: '3.0.0',
        info: {
          title: 'Web2Img API',
          version: '1.0.0',
          description: 'High-performance website screenshot service with queue processing and batch operations',
          contact: {
            name: 'Web2Img Team',
            email: 'mrfansi17@gmail.com',
          },
          license: {
            name: 'Private',
          },
        },

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
            // Load schemas from registry
            ...schemaRegistry.getAllSchemas(),
            // Legacy schemas for backward compatibility
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
                items: {
                  type: 'array',
                  items: {
                    $ref: '#/components/schemas/BatchScreenshotItem',
                  },
                  minItems: 1,
                  maxItems: 100,
                  description: 'List of screenshot items to process (max 100)',
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
              required: ['items'],
            },
            BatchScreenshotItem: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  format: 'uri',
                  description: 'URL of the website to screenshot',
                  example: 'https://example.com',
                },
                id: {
                  type: 'string',
                  description: 'Unique identifier for this item within the batch',
                  example: 'item-1',
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
              required: ['url', 'id'],
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
                  description: 'Whether the batch job was created successfully',
                },
                batch_id: {
                  type: 'integer',
                  description: 'Unique identifier for the batch job',
                },
                status: {
                  type: 'string',
                  enum: ['pending', 'scheduled', 'processing', 'completed', 'failed', 'cancelled'],
                  description: 'Current status of the batch job',
                },
                total_items: {
                  type: 'integer',
                  description: 'Total number of items in the batch',
                },
                estimated_completion: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Estimated completion time',
                },
                created_at: {
                  type: 'string',
                  format: 'date-time',
                  description: 'When the batch job was created',
                },
                scheduled_at: {
                  type: 'string',
                  format: 'date-time',
                  nullable: true,
                  description: 'When the batch job is scheduled to run (if scheduled)',
                },
              },
              required: ['success', 'batch_id', 'status', 'total_items'],
            },
            BatchStatusResponse: {
              type: 'object',
              properties: {
                batch_id: {
                  type: 'integer',
                  description: 'Unique identifier for the batch job',
                },
                status: {
                  type: 'string',
                  enum: ['pending', 'scheduled', 'processing', 'completed', 'failed', 'cancelled'],
                  description: 'Current status of the batch job',
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
                  required: ['completed', 'failed', 'total', 'percentage'],
                },
                results: {
                  type: 'array',
                  items: {
                    $ref: '#/components/schemas/BatchItemResult',
                  },
                  description: 'Individual results for each item in the batch',
                },
                created_at: {
                  type: 'string',
                  format: 'date-time',
                  description: 'When the batch job was created',
                },
                updated_at: {
                  type: 'string',
                  format: 'date-time',
                  description: 'When the batch job was last updated',
                },
                completed_at: {
                  type: 'string',
                  format: 'date-time',
                  nullable: true,
                  description: 'When the batch job was completed (if completed)',
                },
                scheduled_at: {
                  type: 'string',
                  format: 'date-time',
                  nullable: true,
                  description: 'When the batch job is scheduled to run (if scheduled)',
                },
                webhook_url: {
                  type: 'string',
                  format: 'uri',
                  nullable: true,
                  description: 'Webhook URL for completion notification',
                },
                priority: {
                  type: 'string',
                  enum: ['high', 'normal', 'low'],
                  description: 'Job priority level',
                },
                concurrency: {
                  type: 'integer',
                  description: 'Number of parallel screenshots',
                },
              },
              required: ['batch_id', 'status', 'progress', 'created_at'],
            },
            BatchItemResult: {
              type: 'object',
              properties: {
                itemId: {
                  type: 'string',
                  description: 'Unique identifier for this item within the batch',
                },
                status: {
                  type: 'string',
                  enum: ['success', 'error'],
                  description: 'Status of this individual item',
                },
                url: {
                  type: 'string',
                  format: 'uri',
                  nullable: true,
                  description: 'Screenshot URL if successful',
                },
                error: {
                  type: 'string',
                  nullable: true,
                  description: 'Error message if status is error',
                },
                cached: {
                  type: 'boolean',
                  description: 'Whether the result was served from cache',
                },
                processingTime: {
                  type: 'integer',
                  description: 'Processing time for this item in milliseconds',
                },
              },
              required: ['itemId', 'status', 'cached', 'processingTime'],
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
      apis: ['./app/controllers/*.ts', './start/routes.ts', './docs/swagger/*.ts'],
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

  /**
   * Get the schema registry instance
   */
  getSchemaRegistry() {
    return schemaRegistry
  }

  /**
   * Generate OpenAPI schema from VineJS validator
   */
  generateSchemaFromValidator(validator: any, options?: any): OpenAPIV3.SchemaObject {
    return vineSchemaGenerator.generateFromValidator(validator, options)
  }

  /**
   * Validate the current documentation for completeness and consistency
   */
  validateDocumentation(): ValidationResult {
    if (!this._initialized) {
      this.initialize()
    }

    return schemaRegistry.validateSchemas()
  }

  /**
   * Update server URLs in the specification (useful for different environments)
   */
  updateServerUrls(baseUrl: string): void {
    if (!this._spec) {
      this.initialize()
    }

    if (this._spec) {
      this._spec.servers = [
        {
          url: baseUrl,
          description: 'API Server',
        },
      ]
    }
  }

  /**
   * Register a new schema in the registry
   */
  registerSchema(
    category: 'requests' | 'responses' | 'errors' | 'components',
    name: string,
    schema: OpenAPIV3.SchemaObject
  ): void {
    schemaRegistry.registerSchema(category, name, schema)

    // Invalidate cached spec to force regeneration
    this._spec = null
    this._initialized = false
  }

  /**
   * Get a specific schema from the registry
   */
  getSchema(
    category: 'requests' | 'responses' | 'errors' | 'components',
    name: string
  ): OpenAPIV3.SchemaObject | undefined {
    return schemaRegistry.getSchema(category, name)
  }

  /**
   * Generate schemas from multiple VineJS validators
   */
  generateSchemasFromValidators(
    validators: Record<string, any>,
    options?: any
  ): Record<string, OpenAPIV3.SchemaObject> {
    return vineSchemaGenerator.generateSchemasFromValidators(validators, options)
  }

  /**
   * Refresh the specification (useful after schema updates)
   */
  refresh(): void {
    this._spec = null
    this._initialized = false
    this.initialize()
  }

  /**
   * Get validation results for the current specification
   */
  getValidationResults(): ValidationResult {
    return this.validateDocumentation()
  }

  /**
   * Check if the service has been initialized
   */
  isInitialized(): boolean {
    return this._initialized
  }
}

// Export singleton instance
const swaggerService = new SwaggerService()
export default swaggerService
