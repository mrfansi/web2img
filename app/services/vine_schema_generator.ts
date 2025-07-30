import type { OpenAPIV3 } from 'openapi-types'
// VineJS types - using any for now due to module resolution issues
type VineValidator<T = any, U = any> = any
type VineType = any

/**
 * Schema generation options
 */
export interface SchemaGenerationOptions {
  includeExamples?: boolean
  includeDescriptions?: boolean
  strictValidation?: boolean
}

/**
 * Utility service for generating OpenAPI schemas from VineJS validators
 */
class VineSchemaGenerator {
  /**
   * Generate OpenAPI schema from VineJS validator
   */
  generateFromValidator(
    validator: VineValidator<any, any>,
    options: SchemaGenerationOptions = {}
  ): OpenAPIV3.SchemaObject {
    const defaultOptions: SchemaGenerationOptions = {
      includeExamples: true,
      includeDescriptions: true,
      strictValidation: true,
      ...options,
    }

    try {
      // Access the validator's schema definition
      const schema = this.extractSchemaFromValidator(validator)
      return this.convertVineSchemaToOpenAPI(schema, defaultOptions)
    } catch (error) {
      throw new Error(`Failed to generate schema from validator: ${error.message}`)
    }
  }

  /**
   * Generate OpenAPI schema from VineJS schema object
   */
  generateFromSchema(
    vineSchema: any,
    options: SchemaGenerationOptions = {}
  ): OpenAPIV3.SchemaObject {
    const defaultOptions: SchemaGenerationOptions = {
      includeExamples: true,
      includeDescriptions: true,
      strictValidation: true,
      ...options,
    }

    return this.convertVineSchemaToOpenAPI(vineSchema, defaultOptions)
  }

  /**
   * Extract schema definition from compiled VineJS validator
   */
  private extractSchemaFromValidator(validator: VineValidator<any, any>): any {
    // VineJS validators have internal schema structure
    // This is a simplified extraction - in practice, you might need to access
    // the validator's internal structure differently based on VineJS version
    if (validator && typeof validator === 'object' && 'schema' in validator) {
      return (validator as any).schema
    }

    // Fallback: try to access the schema through other properties
    if (validator && typeof validator === 'object') {
      const keys = Object.keys(validator)
      for (const key of keys) {
        if (key.includes('schema') || key.includes('definition')) {
          return (validator as any)[key]
        }
      }
    }

    throw new Error('Unable to extract schema from VineJS validator')
  }

  /**
   * Convert VineJS schema to OpenAPI schema
   */
  private convertVineSchemaToOpenAPI(
    vineSchema: any,
    options: SchemaGenerationOptions
  ): OpenAPIV3.SchemaObject {
    if (!vineSchema || typeof vineSchema !== 'object') {
      throw new Error('Invalid VineJS schema provided')
    }

    // Handle different VineJS schema types
    if (vineSchema.type) {
      return this.convertVineTypeToOpenAPI(vineSchema, options)
    }

    // Handle object schemas
    if (vineSchema.properties || vineSchema.fields) {
      return this.convertObjectSchema(vineSchema, options)
    }

    // Handle array schemas
    if (vineSchema.items || vineSchema.each) {
      return this.convertArraySchema(vineSchema, options)
    }

    // Fallback for unknown schema structure
    return {
      type: 'object',
      description: 'Generated from VineJS schema',
    }
  }

  /**
   * Convert VineJS type to OpenAPI schema
   */
  private convertVineTypeToOpenAPI(
    vineType: any,
    options: SchemaGenerationOptions
  ): OpenAPIV3.SchemaObject {
    const schema: OpenAPIV3.SchemaObject = {}

    // Map VineJS types to OpenAPI types
    switch (vineType.type) {
      case 'string':
        schema.type = 'string'
        this.applyStringConstraints(schema, vineType, options)
        break

      case 'number':
        schema.type = 'number'
        this.applyNumberConstraints(schema, vineType, options)
        break

      case 'integer':
        schema.type = 'integer'
        this.applyNumberConstraints(schema, vineType, options)
        break

      case 'boolean':
        schema.type = 'boolean'
        break

      case 'array':
        return this.convertArraySchema(vineType, options)

      case 'object':
        schema.type = 'object'
        this.applyObjectConstraints(schema, vineType, options)
        break

      case 'enum':
        this.applyEnumConstraints(schema, vineType, options)
        break

      default:
        schema.type = 'string'
        if (options.includeDescriptions) {
          schema.description = `Unknown VineJS type: ${vineType.type}`
        }
    }

    // Apply common constraints
    this.applyCommonConstraints(schema, vineType, options)

    return schema
  }

  /**
   * Apply string-specific constraints
   */
  private applyStringConstraints(
    schema: OpenAPIV3.SchemaObject,
    vineType: any,
    options: SchemaGenerationOptions
  ): void {
    // URL format
    if (vineType.rules?.some((rule: any) => rule.name === 'url')) {
      schema.format = 'uri'
    }

    // Email format
    if (vineType.rules?.some((rule: any) => rule.name === 'email')) {
      schema.format = 'email'
    }

    // Date format
    if (vineType.rules?.some((rule: any) => rule.name === 'date')) {
      schema.format = 'date'
    }

    // DateTime format
    if (vineType.rules?.some((rule: any) => rule.name === 'datetime')) {
      schema.format = 'date-time'
    }

    // Min/Max length
    const minLengthRule = vineType.rules?.find((rule: any) => rule.name === 'minLength')
    if (minLengthRule) {
      schema.minLength = minLengthRule.options?.length || minLengthRule.value
    }

    const maxLengthRule = vineType.rules?.find((rule: any) => rule.name === 'maxLength')
    if (maxLengthRule) {
      schema.maxLength = maxLengthRule.options?.length || maxLengthRule.value
    }

    // Pattern
    const regexRule = vineType.rules?.find((rule: any) => rule.name === 'regex')
    if (regexRule) {
      schema.pattern = regexRule.options?.pattern || regexRule.value
    }

    // Examples for string types
    if (options.includeExamples) {
      if (schema.format === 'uri') {
        schema.example = 'https://example.com'
      } else if (schema.format === 'email') {
        schema.example = 'user@example.com'
      } else if (schema.format === 'date') {
        schema.example = '2025-07-26'
      } else if (schema.format === 'date-time') {
        schema.example = '2025-07-26T12:00:00Z'
      }
    }
  }

  /**
   * Apply number-specific constraints
   */
  private applyNumberConstraints(
    schema: OpenAPIV3.SchemaObject,
    vineType: any,
    options: SchemaGenerationOptions
  ): void {
    // Min/Max values
    const minRule = vineType.rules?.find((rule: any) => rule.name === 'min')
    if (minRule) {
      schema.minimum = minRule.options?.min || minRule.value
    }

    const maxRule = vineType.rules?.find((rule: any) => rule.name === 'max')
    if (maxRule) {
      schema.maximum = maxRule.options?.max || maxRule.value
    }

    // Positive/Negative constraints
    if (vineType.rules?.some((rule: any) => rule.name === 'positive')) {
      schema.minimum = 0
      schema.exclusiveMinimum = true
    }

    if (vineType.rules?.some((rule: any) => rule.name === 'negative')) {
      schema.maximum = 0
      schema.exclusiveMaximum = true
    }

    // Examples for number types
    if (options.includeExamples) {
      if (schema.minimum !== undefined && schema.maximum !== undefined) {
        schema.example = Math.floor((schema.minimum + schema.maximum) / 2)
      } else if (schema.minimum !== undefined) {
        schema.example = schema.minimum + 10
      } else if (schema.maximum !== undefined) {
        schema.example = Math.max(0, schema.maximum - 10)
      } else {
        schema.example = schema.type === 'integer' ? 42 : 42.5
      }
    }
  }

  /**
   * Apply array-specific constraints
   */
  private applyArrayConstraints(
    schema: OpenAPIV3.ArraySchemaObject,
    vineType: any,
    options: SchemaGenerationOptions
  ): void {
    // Min/Max items
    const minLengthRule = vineType.rules?.find((rule: any) => rule.name === 'minLength')
    if (minLengthRule) {
      schema.minItems = minLengthRule.options?.length || minLengthRule.value
    }

    const maxLengthRule = vineType.rules?.find((rule: any) => rule.name === 'maxLength')
    if (maxLengthRule) {
      schema.maxItems = maxLengthRule.options?.length || maxLengthRule.value
    }

    // Array items schema
    if (vineType.items || vineType.each) {
      const itemSchema = vineType.items || vineType.each
      schema.items = this.convertVineSchemaToOpenAPI(itemSchema, options)
    } else {
      // Default to string items if no specific type is defined
      schema.items = { type: 'string' }
    }
  }

  /**
   * Apply object-specific constraints
   */
  private applyObjectConstraints(
    schema: OpenAPIV3.SchemaObject,
    vineType: any,
    options: SchemaGenerationOptions
  ): void {
    const properties = vineType.properties || vineType.fields || {}
    const required: string[] = []

    schema.properties = {}

    for (const [key, value] of Object.entries(properties)) {
      schema.properties[key] = this.convertVineSchemaToOpenAPI(value, options)

      // Check if field is required (not optional)
      if (value && typeof value === 'object' && !(value as any).optional) {
        required.push(key)
      }
    }

    if (required.length > 0) {
      schema.required = required
    }
  }

  /**
   * Apply enum constraints
   */
  private applyEnumConstraints(
    schema: OpenAPIV3.SchemaObject,
    vineType: any,
    options: SchemaGenerationOptions
  ): void {
    schema.type = 'string'

    if (vineType.options && Array.isArray(vineType.options)) {
      schema.enum = vineType.options
    } else if (vineType.choices && Array.isArray(vineType.choices)) {
      schema.enum = vineType.choices
    }

    // Set example to first enum value
    if (options.includeExamples && schema.enum && schema.enum.length > 0) {
      schema.example = schema.enum[0]
    }
  }

  /**
   * Apply common constraints that apply to all types
   */
  private applyCommonConstraints(
    schema: OpenAPIV3.SchemaObject,
    vineType: any,
    options: SchemaGenerationOptions
  ): void {
    // Default value
    if (vineType.default !== undefined) {
      schema.default = vineType.default
    }

    // Description
    if (options.includeDescriptions && vineType.description) {
      schema.description = vineType.description
    }

    // Optional fields
    if (vineType.optional) {
      // This is handled at the parent object level
    }

    // Nullable
    if (vineType.nullable) {
      schema.nullable = true
    }
  }

  /**
   * Convert object schema with properties
   */
  private convertObjectSchema(
    vineSchema: any,
    options: SchemaGenerationOptions
  ): OpenAPIV3.SchemaObject {
    const schema: OpenAPIV3.SchemaObject = {
      type: 'object',
      properties: {},
    }

    const properties = vineSchema.properties || vineSchema.fields || {}
    const required: string[] = []

    for (const [key, value] of Object.entries(properties)) {
      schema.properties![key] = this.convertVineSchemaToOpenAPI(value, options)

      // Check if field is required
      if (value && typeof value === 'object' && !(value as any).optional) {
        required.push(key)
      }
    }

    if (required.length > 0) {
      schema.required = required
    }

    return schema
  }

  /**
   * Convert array schema
   */
  private convertArraySchema(
    vineSchema: any,
    options: SchemaGenerationOptions
  ): OpenAPIV3.ArraySchemaObject {
    const schema: OpenAPIV3.ArraySchemaObject = {
      type: 'array',
      items: { type: 'string' }, // Default items
    }

    // Array items schema
    const itemSchema = vineSchema.items || vineSchema.each
    if (itemSchema) {
      schema.items = this.convertVineSchemaToOpenAPI(itemSchema, options)
    }

    // Apply array constraints
    this.applyArrayConstraints(schema, vineSchema, options)

    return schema
  }

  /**
   * Generate schema for a specific validator by name
   */
  generateSchemaForValidator(
    validatorName: string,
    validator: VineValidator<any, any>,
    options: SchemaGenerationOptions = {}
  ): { name: string; schema: OpenAPIV3.SchemaObject } {
    const schema = this.generateFromValidator(validator, options)

    // Add description based on validator name if not present
    if (!schema.description && options.includeDescriptions) {
      schema.description = `Generated schema for ${validatorName} validator`
    }

    return {
      name: validatorName,
      schema,
    }
  }

  /**
   * Batch generate schemas from multiple validators
   */
  generateSchemasFromValidators(
    validators: Record<string, VineValidator<any, any>>,
    options: SchemaGenerationOptions = {}
  ): Record<string, OpenAPIV3.SchemaObject> {
    const schemas: Record<string, OpenAPIV3.SchemaObject> = {}

    for (const [name, validator] of Object.entries(validators)) {
      try {
        const result = this.generateSchemaForValidator(name, validator, options)
        schemas[result.name] = result.schema
      } catch (error) {
        console.warn(`Failed to generate schema for validator '${name}':`, error.message)
        // Continue with other validators
      }
    }

    return schemas
  }

  /**
   * Validate that a generated schema is valid OpenAPI
   */
  validateGeneratedSchema(schema: OpenAPIV3.SchemaObject): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    // Basic validation
    if (!schema.type && !('$ref' in schema) && !('allOf' in schema) && !('oneOf' in schema) && !('anyOf' in schema)) {
      errors.push('Schema must have a type or reference')
    }

    // Object validation
    if (schema.type === 'object') {
      if (schema.required && schema.properties) {
        for (const requiredProp of schema.required) {
          if (!schema.properties[requiredProp]) {
            errors.push(`Required property '${requiredProp}' not found in properties`)
          }
        }
      }
    }

    // Array validation
    if (schema.type === 'array' && !(schema as OpenAPIV3.ArraySchemaObject).items) {
      errors.push('Array schema must define items')
    }

    // Number validation
    if ((schema.type === 'number' || schema.type === 'integer') && schema.minimum !== undefined && schema.maximum !== undefined) {
      if (schema.minimum > schema.maximum) {
        errors.push('Minimum value cannot be greater than maximum value')
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }
}

// Export singleton instance
const vineSchemaGenerator = new VineSchemaGenerator()
export default vineSchemaGenerator