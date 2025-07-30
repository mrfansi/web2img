import type { OpenAPIV3 } from 'openapi-types'

/**
 * Centralized schema registry for managing all OpenAPI schemas
 */
export interface SchemaRegistry {
  requests: Record<string, OpenAPIV3.SchemaObject>
  responses: Record<string, OpenAPIV3.SchemaObject>
  errors: Record<string, OpenAPIV3.SchemaObject>
  components: Record<string, OpenAPIV3.SchemaObject>
}

/**
 * Schema validation result
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Schema registry service for managing OpenAPI schemas
 */
class SchemaRegistryService {
  private registry: SchemaRegistry = {
    requests: {},
    responses: {},
    errors: {},
    components: {},
  }

  /**
   * Initialize the schema registry with default schemas
   */
  initialize(): void {
    this.loadRequestSchemas()
    this.loadResponseSchemas()
    this.loadErrorSchemas()
    this.loadComponentSchemas()
  }

  /**
   * Get the complete schema registry
   */
  getRegistry(): SchemaRegistry {
    return this.registry
  }

  /**
   * Get all schemas for OpenAPI components section
   */
  getAllSchemas(): Record<string, OpenAPIV3.SchemaObject> {
    return {
      ...this.registry.requests,
      ...this.registry.responses,
      ...this.registry.errors,
      ...this.registry.components,
    }
  }

  /**
   * Register a new schema
   */
  registerSchema(
    category: keyof SchemaRegistry,
    name: string,
    schema: OpenAPIV3.SchemaObject
  ): void {
    this.registry[category][name] = schema
  }

  /**
   * Get a specific schema by category and name
   */
  getSchema(category: keyof SchemaRegistry, name: string): OpenAPIV3.SchemaObject | undefined {
    return this.registry[category][name]
  }

  /**
   * Validate schema consistency and completeness
   */
  validateSchemas(): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // Check for missing required schemas
    const requiredSchemas = [
      'ScreenshotRequest',
      'ScreenshotResponse',
      'BatchRequest',
      'BatchResponse',
      'Error',
      'HealthResponse',
    ]

    for (const schemaName of requiredSchemas) {
      if (!this.findSchemaByName(schemaName)) {
        errors.push(`Required schema '${schemaName}' is missing`)
      }
    }

    // Validate schema references
    this.validateSchemaReferences(errors, warnings)

    // Validate schema structure
    this.validateSchemaStructure(errors, warnings)

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  /**
   * Find a schema by name across all categories
   */
  private findSchemaByName(name: string): OpenAPIV3.SchemaObject | undefined {
    for (const category of Object.keys(this.registry) as Array<keyof SchemaRegistry>) {
      if (this.registry[category][name]) {
        return this.registry[category][name]
      }
    }
    return undefined
  }

  /**
   * Validate schema references ($ref)
   */
  private validateSchemaReferences(errors: string[], warnings: string[]): void {
    const allSchemas = this.getAllSchemas()

    for (const [schemaName, schema] of Object.entries(allSchemas)) {
      this.validateSchemaRefsRecursive(schema, schemaName, allSchemas, errors, warnings)
    }
  }

  /**
   * Recursively validate schema references
   */
  private validateSchemaRefsRecursive(
    obj: any,
    parentName: string,
    allSchemas: Record<string, OpenAPIV3.SchemaObject>,
    errors: string[],
    warnings: string[]
  ): void {
    if (!obj || typeof obj !== 'object') return

    if (obj.$ref && typeof obj.$ref === 'string') {
      // Extract schema name from $ref (e.g., '#/components/schemas/SchemaName' -> 'SchemaName')
      const refMatch = obj.$ref.match(/#\/components\/schemas\/(.+)$/)
      if (refMatch) {
        const referencedSchema = refMatch[1]
        if (!allSchemas[referencedSchema]) {
          errors.push(`Schema '${parentName}' references missing schema '${referencedSchema}'`)
        }
      } else {
        warnings.push(`Schema '${parentName}' has invalid $ref format: ${obj.$ref}`)
      }
    }

    // Recursively check nested objects
    for (const value of Object.values(obj)) {
      if (typeof value === 'object') {
        this.validateSchemaRefsRecursive(value, parentName, allSchemas, errors, warnings)
      }
    }
  }

  /**
   * Validate schema structure
   */
  private validateSchemaStructure(errors: string[], warnings: string[]): void {
    const allSchemas = this.getAllSchemas()

    for (const [schemaName, schema] of Object.entries(allSchemas)) {
      // Check for required properties
      if (schema.type === 'object' && schema.properties) {
        if (!schema.required || schema.required.length === 0) {
          warnings.push(`Object schema '${schemaName}' has no required properties`)
        }

        // Check if required properties exist in properties
        if (schema.required) {
          for (const requiredProp of schema.required) {
            if (!schema.properties[requiredProp]) {
              errors.push(
                `Schema '${schemaName}' requires property '${requiredProp}' but it's not defined in properties`
              )
            }
          }
        }
      }

      // Check for missing descriptions
      if (!schema.description) {
        warnings.push(`Schema '${schemaName}' is missing a description`)
      }

      // Validate property descriptions for object schemas
      if (schema.type === 'object' && schema.properties) {
        for (const [propName, propSchema] of Object.entries(schema.properties)) {
          if (typeof propSchema === 'object' && !('$ref' in propSchema) && !(propSchema as OpenAPIV3.SchemaObject).description) {
            warnings.push(`Property '${propName}' in schema '${schemaName}' is missing a description`)
          }
        }
      }
    }
  }

  /**
   * Load request schemas
   */
  private loadRequestSchemas(): void {
    // Screenshot request schemas
    this.registry.requests.ScreenshotRequest = {
      type: 'object',
      required: ['url'],
      properties: {
        url: {
          type: 'string',
          format: 'uri',
          description: 'Website URL to screenshot',
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
          minimum: 1,
          maximum: 5000,
          default: 1280,
          description: 'Screenshot width in pixels',
        },
        height: {
          type: 'integer',
          minimum: 1,
          maximum: 5000,
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
        fullPage: {
          type: 'boolean',
          default: false,
          description: 'Capture full page instead of viewport',
        },
        cache: {
          type: 'boolean',
          default: true,
          description: 'Whether to use cached results if available',
        },
      },
      description: 'Request schema for single screenshot capture',
    }

    // Batch request schemas
    this.registry.requests.BatchItem = {
      type: 'object',
      required: ['id', 'url'],
      properties: {
        id: {
          type: 'string',
          minLength: 1,
          description: 'Unique identifier for this batch item',
          example: 'item_1',
        },
        url: {
          type: 'string',
          format: 'uri',
          description: 'Website URL to screenshot',
          example: 'https://example.com',
        },
        format: {
          type: 'string',
          enum: ['png', 'jpeg', 'webp'],
          description: 'Output image format for this item',
        },
        width: {
          type: 'integer',
          minimum: 1,
          maximum: 5000,
          description: 'Screenshot width in pixels for this item',
        },
        height: {
          type: 'integer',
          minimum: 1,
          maximum: 5000,
          description: 'Screenshot height in pixels for this item',
        },
      },
      description: 'Individual item in a batch screenshot request',
    }

    this.registry.requests.BatchConfig = {
      type: 'object',
      properties: {
        parallel: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          default: 5,
          description: 'Number of parallel screenshot processes',
        },
        timeout: {
          type: 'integer',
          minimum: 5000,
          maximum: 60000,
          default: 30000,
          description: 'Timeout for each screenshot in milliseconds',
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
        fail_fast: {
          type: 'boolean',
          default: false,
          description: 'Stop processing on first failure',
        },
        cache: {
          type: 'boolean',
          default: true,
          description: 'Whether to use cached results if available',
        },
        priority: {
          type: 'string',
          enum: ['high', 'normal', 'low'],
          default: 'normal',
          description: 'Job priority level',
        },
        scheduled_time: {
          type: 'string',
          format: 'date-time',
          description: 'ISO 8601 timestamp for scheduled execution',
        },
      },
      description: 'Configuration options for batch screenshot processing',
    }

    this.registry.requests.BatchRequest = {
      type: 'object',
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: { $ref: '#/components/schemas/BatchItem' },
          minItems: 1,
          maxItems: 200,
          description: 'Array of screenshot items to process',
        },
        config: {
          $ref: '#/components/schemas/BatchConfig',
          description: 'Batch processing configuration',
        },
      },
      description: 'Request schema for batch screenshot processing',
    }
  }

  /**
   * Load response schemas
   */
  private loadResponseSchemas(): void {
    // Screenshot response schemas
    this.registry.responses.ScreenshotResponse = {
      type: 'object',
      required: ['success', 'screenshot_url'],
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the request was successful',
          example: true,
        },
        screenshot_url: {
          type: 'string',
          format: 'uri',
          description: 'URL to access the screenshot',
          example: 'https://api.web2img.com/images/screenshot_123.png',
        },
        cache_hit: {
          type: 'boolean',
          description: 'Whether the result was served from cache',
          example: false,
        },
        processing_time_ms: {
          type: 'integer',
          description: 'Total processing time in milliseconds',
          example: 2500,
        },
        file_size_bytes: {
          type: 'integer',
          description: 'Screenshot file size in bytes',
          example: 245760,
        },
        expires_at: {
          type: 'string',
          format: 'date-time',
          description: 'When the screenshot URL expires',
          example: '2025-07-27T12:00:00Z',
        },
      },
      description: 'Response schema for successful screenshot capture',
    }

    // Batch response schemas
    this.registry.responses.BatchResponse = {
      type: 'object',
      required: ['success', 'job_id', 'status'],
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the batch job was successfully created',
          example: true,
        },
        job_id: {
          type: 'string',
          description: 'Unique identifier for the batch job',
          example: 'batch_abc123def456',
        },
        status: {
          type: 'string',
          enum: ['pending', 'processing', 'completed', 'failed'],
          description: 'Current status of the batch job',
          example: 'pending',
        },
        total_items: {
          type: 'integer',
          description: 'Total number of items in the batch',
          example: 10,
        },
        estimated_completion: {
          type: 'string',
          format: 'date-time',
          description: 'Estimated completion time',
          example: '2025-07-26T12:05:30Z',
        },
      },
      description: 'Response schema for batch job creation',
    }

    this.registry.responses.BatchStatusResponse = {
      type: 'object',
      required: ['job_id', 'status'],
      properties: {
        job_id: {
          type: 'string',
          description: 'Unique identifier for the batch job',
          example: 'batch_abc123def456',
        },
        status: {
          type: 'string',
          enum: ['pending', 'processing', 'completed', 'failed'],
          description: 'Current status of the batch job',
          example: 'processing',
        },
        progress: {
          $ref: '#/components/schemas/BatchProgress',
          description: 'Progress information for the batch job',
        },
        results: {
          type: 'array',
          items: { $ref: '#/components/schemas/BatchResult' },
          description: 'Results for completed items',
        },
        created_at: {
          type: 'string',
          format: 'date-time',
          description: 'When the batch job was created',
          example: '2025-07-26T11:30:00Z',
        },
        completed_at: {
          type: 'string',
          format: 'date-time',
          description: 'When the batch job was completed (if applicable)',
          example: '2025-07-26T12:05:30Z',
        },
      },
      description: 'Response schema for batch job status',
    }

    // Health response schemas
    this.registry.responses.HealthResponse = {
      type: 'object',
      required: ['status', 'timestamp'],
      properties: {
        status: {
          type: 'string',
          enum: ['healthy', 'unhealthy', 'degraded'],
          description: 'Overall system health status',
          example: 'healthy',
        },
        timestamp: {
          type: 'string',
          format: 'date-time',
          description: 'Timestamp of the health check',
          example: '2025-07-26T12:00:00Z',
        },
        uptime: {
          type: 'number',
          description: 'Application uptime in seconds',
          example: 86400,
        },
      },
      description: 'Basic health check response',
    }

    this.registry.responses.DetailedHealthResponse = {
      type: 'object',
      required: ['status', 'timestamp', 'components'],
      properties: {
        status: {
          type: 'string',
          enum: ['healthy', 'unhealthy', 'degraded'],
          description: 'Overall system health status',
          example: 'healthy',
        },
        timestamp: {
          type: 'string',
          format: 'date-time',
          description: 'Timestamp of the health check',
          example: '2025-07-26T12:00:00Z',
        },
        uptime: {
          type: 'number',
          description: 'Application uptime in seconds',
          example: 86400,
        },
        components: {
          type: 'object',
          properties: {
            database: { $ref: '#/components/schemas/ComponentHealth' },
            redis: { $ref: '#/components/schemas/ComponentHealth' },
            queues: { $ref: '#/components/schemas/ComponentHealth' },
            browser: { $ref: '#/components/schemas/ComponentHealth' },
            storage: { $ref: '#/components/schemas/ComponentHealth' },
          },
          description: 'Health status of individual system components',
        },
      },
      description: 'Detailed health check response with component status',
    }
  }

  /**
   * Load error schemas
   */
  private loadErrorSchemas(): void {
    this.registry.errors.Error = {
      type: 'object',
      required: ['detail'],
      properties: {
        detail: {
          type: 'object',
          required: ['error', 'message'],
          properties: {
            error: {
              type: 'string',
              description: 'Error code identifier',
              example: 'VALIDATION_ERROR',
            },
            message: {
              type: 'string',
              description: 'Human-readable error message',
              example: 'Invalid URL format provided',
            },
            field: {
              type: 'string',
              description: 'Field name for validation errors',
              example: 'url',
            },
            code: {
              type: 'string',
              description: 'Specific error code',
              example: 'INVALID_URL_FORMAT',
            },
          },
        },
      },
      description: 'Standard error response format',
    }

    this.registry.errors.ValidationError = {
      type: 'object',
      required: ['detail'],
      properties: {
        detail: {
          type: 'object',
          required: ['error', 'message'],
          properties: {
            error: {
              type: 'string',
              enum: ['VALIDATION_ERROR'],
              description: 'Validation error code',
            },
            message: {
              type: 'string',
              description: 'Validation error message',
              example: 'Invalid URL format provided',
            },
            field: {
              type: 'string',
              description: 'Field that failed validation',
              example: 'url',
            },
          },
        },
      },
      description: 'Validation error response',
    }

    this.registry.errors.AuthenticationError = {
      type: 'object',
      required: ['detail'],
      properties: {
        detail: {
          type: 'object',
          required: ['error', 'message'],
          properties: {
            error: {
              type: 'string',
              enum: ['UNAUTHORIZED'],
              description: 'Authentication error code',
            },
            message: {
              type: 'string',
              description: 'Authentication error message',
              example: 'Invalid API key',
            },
          },
        },
      },
      description: 'Authentication error response',
    }

    this.registry.errors.RateLimitError = {
      type: 'object',
      required: ['detail'],
      properties: {
        detail: {
          type: 'object',
          required: ['error', 'message'],
          properties: {
            error: {
              type: 'string',
              enum: ['RATE_LIMITED'],
              description: 'Rate limit error code',
            },
            message: {
              type: 'string',
              description: 'Rate limit error message',
              example: 'Rate limit exceeded. Try again in 45 minutes.',
            },
          },
        },
      },
      description: 'Rate limit exceeded error response',
    }
  }

  /**
   * Load component schemas
   */
  private loadComponentSchemas(): void {
    this.registry.components.ComponentHealth = {
      type: 'object',
      required: ['status'],
      properties: {
        status: {
          type: 'string',
          enum: ['healthy', 'unhealthy', 'degraded'],
          description: 'Component health status',
          example: 'healthy',
        },
        response_time: {
          type: 'number',
          description: 'Response time in milliseconds',
          example: 15.5,
        },
        details: {
          type: 'object',
          description: 'Component-specific health details',
          additionalProperties: true,
        },
      },
      description: 'Health status of an individual system component',
    }

    this.registry.components.BatchProgress = {
      type: 'object',
      required: ['completed', 'failed', 'total', 'percentage'],
      properties: {
        completed: {
          type: 'integer',
          minimum: 0,
          description: 'Number of completed screenshots',
          example: 7,
        },
        failed: {
          type: 'integer',
          minimum: 0,
          description: 'Number of failed screenshots',
          example: 1,
        },
        total: {
          type: 'integer',
          minimum: 1,
          description: 'Total number of screenshots',
          example: 10,
        },
        percentage: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: 'Completion percentage',
          example: 80.0,
        },
      },
      description: 'Progress information for batch processing',
    }

    this.registry.components.BatchResult = {
      type: 'object',
      required: ['url', 'status'],
      properties: {
        url: {
          type: 'string',
          format: 'uri',
          description: 'Original URL that was processed',
          example: 'https://example.com',
        },
        screenshot_url: {
          type: 'string',
          format: 'uri',
          description: 'URL to access the screenshot (if successful)',
          example: 'https://api.web2img.com/images/screenshot_123.png',
        },
        status: {
          type: 'string',
          enum: ['completed', 'failed', 'pending'],
          description: 'Status of this individual item',
          example: 'completed',
        },
        error: {
          type: 'string',
          description: 'Error message if status is failed',
          example: 'Timeout while loading page',
        },
        processing_time_ms: {
          type: 'integer',
          description: 'Processing time for this item in milliseconds',
          example: 2500,
        },
      },
      description: 'Result for an individual item in a batch job',
    }
  }
}

// Export singleton instance
const schemaRegistry = new SchemaRegistryService()
export default schemaRegistry