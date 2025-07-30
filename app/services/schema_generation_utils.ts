import vineSchemaGenerator from '#services/vine_schema_generator'
import schemaRegistry from '#services/schema_registry'
import type { OpenAPIV3 } from 'openapi-types'

// Import existing validators
import {
  singleScreenshotValidator,
  batchScreenshotValidator,
  batchStatusValidator,
  cacheUrlValidator,
  scheduleJobValidator,
  recurrenceValidator,
} from '#validators/screenshot_validator'

import {
  loginValidator,
  createUserValidator,
  updateUserValidator,
  changePasswordValidator,
} from '#validators/auth_validators'

/**
 * Utility functions for generating and managing OpenAPI schemas
 */
export class SchemaGenerationUtils {
  /**
   * Generate schemas from all existing VineJS validators
   */
  static generateAllValidatorSchemas(): Record<string, OpenAPIV3.SchemaObject> {
    const validators = {
      // Screenshot validators
      SingleScreenshotRequest: singleScreenshotValidator,
      BatchScreenshotRequest: batchScreenshotValidator,
      BatchStatusRequest: batchStatusValidator,
      CacheUrlRequest: cacheUrlValidator,
      ScheduleJobRequest: scheduleJobValidator,
      RecurrenceRequest: recurrenceValidator,

      // Auth validators
      LoginRequest: loginValidator,
      CreateUserRequest: createUserValidator,
      UpdateUserRequest: updateUserValidator,
      ChangePasswordRequest: changePasswordValidator,
    }

    return vineSchemaGenerator.generateSchemasFromValidators(validators, {
      includeExamples: true,
      includeDescriptions: true,
      strictValidation: true,
    })
  }

  /**
   * Register all generated schemas in the schema registry
   */
  static registerGeneratedSchemas(): void {
    const schemas = this.generateAllValidatorSchemas()

    for (const [name, schema] of Object.entries(schemas)) {
      // Determine category based on schema name
      let category: 'requests' | 'responses' | 'errors' | 'components'

      if (name.endsWith('Request')) {
        category = 'requests'
      } else if (name.endsWith('Response')) {
        category = 'responses'
      } else if (name.endsWith('Error')) {
        category = 'errors'
      } else {
        category = 'components'
      }

      schemaRegistry.registerSchema(category, name, schema)
    }
  }

  /**
   * Validate all generated schemas
   */
  static validateAllSchemas(): { valid: boolean; errors: string[]; warnings: string[] } {
    const schemas = this.generateAllValidatorSchemas()
    const allErrors: string[] = []
    const allWarnings: string[] = []

    for (const [name, schema] of Object.entries(schemas)) {
      const validation = vineSchemaGenerator.validateGeneratedSchema(schema)
      
      if (!validation.valid) {
        allErrors.push(`Schema '${name}': ${validation.errors.join(', ')}`)
      }
    }

    // Also validate the registry
    const registryValidation = schemaRegistry.validateSchemas()
    allErrors.push(...registryValidation.errors)
    allWarnings.push(...registryValidation.warnings)

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
    }
  }

  /**
   * Generate schema for a specific validator with custom options
   */
  static generateSchemaForValidator(
    validator: any,
    options?: {
      includeExamples?: boolean
      includeDescriptions?: boolean
      strictValidation?: boolean
    }
  ): OpenAPIV3.SchemaObject {
    return vineSchemaGenerator.generateFromValidator(validator, options)
  }

  /**
   * Create a mapping of validator names to their generated schemas
   */
  static createValidatorSchemaMapping(): Record<string, {
    validator: any
    schema: OpenAPIV3.SchemaObject
    category: string
  }> {
    const mapping: Record<string, any> = {}

    const validators = [
      { name: 'SingleScreenshotRequest', validator: singleScreenshotValidator, category: 'requests' },
      { name: 'BatchScreenshotRequest', validator: batchScreenshotValidator, category: 'requests' },
      { name: 'BatchStatusRequest', validator: batchStatusValidator, category: 'requests' },
      { name: 'CacheUrlRequest', validator: cacheUrlValidator, category: 'requests' },
      { name: 'ScheduleJobRequest', validator: scheduleJobValidator, category: 'requests' },
      { name: 'RecurrenceRequest', validator: recurrenceValidator, category: 'requests' },
      { name: 'LoginRequest', validator: loginValidator, category: 'requests' },
      { name: 'CreateUserRequest', validator: createUserValidator, category: 'requests' },
      { name: 'UpdateUserRequest', validator: updateUserValidator, category: 'requests' },
      { name: 'ChangePasswordRequest', validator: changePasswordValidator, category: 'requests' },
    ]

    for (const { name, validator, category } of validators) {
      try {
        const schema = vineSchemaGenerator.generateFromValidator(validator, {
          includeExamples: true,
          includeDescriptions: true,
          strictValidation: true,
        })

        mapping[name] = {
          validator,
          schema,
          category,
        }
      } catch (error) {
        console.warn(`Failed to generate schema for ${name}:`, error.message)
      }
    }

    return mapping
  }

  /**
   * Generate comprehensive documentation for all schemas
   */
  static generateSchemaDocumentation(): {
    totalSchemas: number
    schemasByCategory: Record<string, number>
    validationResults: { valid: boolean; errors: string[]; warnings: string[] }
    schemaDetails: Array<{
      name: string
      category: string
      type: string
      properties: number
      required: number
      hasExamples: boolean
      hasDescription: boolean
    }>
  } {
    const schemas = this.generateAllValidatorSchemas()
    const registrySchemas = schemaRegistry.getAllSchemas()
    const allSchemas = { ...schemas, ...registrySchemas }

    const schemasByCategory: Record<string, number> = {
      requests: 0,
      responses: 0,
      errors: 0,
      components: 0,
    }

    const schemaDetails: Array<any> = []

    for (const [name, schema] of Object.entries(allSchemas)) {
      // Determine category
      let category = 'components'
      if (name.endsWith('Request')) category = 'requests'
      else if (name.endsWith('Response')) category = 'responses'
      else if (name.endsWith('Error')) category = 'errors'

      schemasByCategory[category]++

      // Analyze schema details
      const schemaObj = schema as OpenAPIV3.SchemaObject
      const properties = schemaObj.properties ? Object.keys(schemaObj.properties).length : 0
      const required = schemaObj.required ? schemaObj.required.length : 0
      const hasExamples = this.hasExamples(schemaObj)
      const hasDescription = !!schemaObj.description

      schemaDetails.push({
        name,
        category,
        type: schemaObj.type || 'unknown',
        properties,
        required,
        hasExamples,
        hasDescription,
      })
    }

    return {
      totalSchemas: Object.keys(allSchemas).length,
      schemasByCategory,
      validationResults: this.validateAllSchemas(),
      schemaDetails,
    }
  }

  /**
   * Check if a schema has examples (recursively)
   */
  private static hasExamples(schema: OpenAPIV3.SchemaObject): boolean {
    if (schema.example !== undefined) return true

    if (schema.properties) {
      for (const prop of Object.values(schema.properties)) {
        if (typeof prop === 'object' && !('$ref' in prop) && (prop as OpenAPIV3.SchemaObject).example !== undefined) {
          return true
        }
      }
    }

    if (schema.type === 'array') {
      const arraySchema = schema as OpenAPIV3.ArraySchemaObject
      if (arraySchema.items && typeof arraySchema.items === 'object' && !('$ref' in arraySchema.items) && (arraySchema.items as OpenAPIV3.SchemaObject).example !== undefined) {
        return true
      }
    }

    return false
  }

  /**
   * Generate a summary report of schema generation
   */
  static generateSummaryReport(): string {
    const doc = this.generateSchemaDocumentation()
    const validation = doc.validationResults

    let report = '# Schema Generation Summary Report\n\n'
    report += `**Total Schemas Generated:** ${doc.totalSchemas}\n\n`
    
    report += '## Schemas by Category\n'
    for (const [category, count] of Object.entries(doc.schemasByCategory)) {
      report += `- ${category}: ${count}\n`
    }
    
    report += '\n## Validation Results\n'
    report += `- **Valid:** ${validation.valid ? 'Yes' : 'No'}\n`
    report += `- **Errors:** ${validation.errors.length}\n`
    report += `- **Warnings:** ${validation.warnings.length}\n`

    if (validation.errors.length > 0) {
      report += '\n### Errors\n'
      for (const error of validation.errors) {
        report += `- ${error}\n`
      }
    }

    if (validation.warnings.length > 0) {
      report += '\n### Warnings\n'
      for (const warning of validation.warnings) {
        report += `- ${warning}\n`
      }
    }

    report += '\n## Schema Details\n'
    report += '| Name | Category | Type | Properties | Required | Examples | Description |\n'
    report += '|------|----------|------|------------|----------|----------|-------------|\n'

    for (const detail of doc.schemaDetails) {
      report += `| ${detail.name} | ${detail.category} | ${detail.type} | ${detail.properties} | ${detail.required} | ${detail.hasExamples ? 'Yes' : 'No'} | ${detail.hasDescription ? 'Yes' : 'No'} |\n`
    }

    return report
  }
}

/**
 * Initialize schema generation and registration
 */
export function initializeSchemaGeneration(): void {
  try {
    // Register all generated schemas
    SchemaGenerationUtils.registerGeneratedSchemas()
    
    console.log('✅ Schema generation and registration completed successfully')
    
    // Validate all schemas
    const validation = SchemaGenerationUtils.validateAllSchemas()
    
    if (validation.valid) {
      console.log('✅ All schemas validated successfully')
    } else {
      console.warn('⚠️ Schema validation completed with issues:')
      validation.errors.forEach(error => console.error(`  - ${error}`))
      validation.warnings.forEach(warning => console.warn(`  - ${warning}`))
    }
  } catch (error) {
    console.error('❌ Failed to initialize schema generation:', error.message)
    throw error
  }
}

// Export utilities
export default SchemaGenerationUtils