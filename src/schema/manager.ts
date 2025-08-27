import { parseDSLSchema, toJSONSchema } from './dsl-parser.js';
import { loadZodSchema } from './zod-loader.js';
import { validateSchema, coerceData } from './validator.js';
import { SchemaSource, ParsedSchema, SchemaValidationResult, SCHEMA_TEMPLATES } from './types.js';
import { readFile, existsSync } from 'fs/promises';

/**
 * Central manager for loading and working with schemas
 */
export class SchemaManager {
  private schemaCache = new Map<string, ParsedSchema>();

  /**
   * Loads a schema from various sources
   */
  async loadSchema(source: SchemaSource): Promise<ParsedSchema> {
    const cacheKey = this.getCacheKey(source);
    
    if (this.schemaCache.has(cacheKey)) {
      return this.schemaCache.get(cacheKey)!;
    }

    let schema: ParsedSchema;

    switch (source.type) {
      case 'dsl':
        schema = parseDSLSchema(source.content);
        break;

      case 'json-inline':
        schema = this.parseJSONSchema(source.content);
        break;

      case 'json-file':
        if (!await existsSync(source.path)) {
          throw new Error(`JSON schema file not found: ${source.path}`);
        }
        const jsonContent = await readFile(source.path, 'utf-8');
        schema = this.parseJSONSchema(jsonContent);
        break;

      case 'zod-file':
        schema = await loadZodSchema(source.path);
        break;

      case 'template':
        if (!(source.name in SCHEMA_TEMPLATES)) {
          throw new Error(`Unknown schema template: ${source.name}. Available templates: ${Object.keys(SCHEMA_TEMPLATES).join(', ')}`);
        }
        schema = SCHEMA_TEMPLATES[source.name as keyof typeof SCHEMA_TEMPLATES];
        break;

      default:
        throw new Error(`Unknown schema source type: ${(source as any).type}`);
    }

    this.schemaCache.set(cacheKey, schema);
    return schema;
  }

  /**
   * Validates data against a loaded schema
   */
  async validateData(data: any, source: SchemaSource, options: {
    coerce?: boolean;
    strict?: boolean;
  } = {}): Promise<SchemaValidationResult> {
    const schema = await this.loadSchema(source);
    
    let processedData = data;
    if (options.coerce) {
      processedData = coerceData(data, schema);
    }

    const result = validateSchema(processedData, schema);
    
    if (!options.strict && result.warnings) {
      // In non-strict mode, warnings don't fail validation
      return {
        ...result,
        success: result.errors === undefined || result.errors.length === 0
      };
    }

    return result;
  }

  /**
   * Converts a schema to JSON Schema format for LLM instructions
   */
  async getJSONSchema(source: SchemaSource): Promise<object> {
    const schema = await this.loadSchema(source);
    return toJSONSchema(schema);
  }

  /**
   * Gets a list of available templates
   */
  getAvailableTemplates(): string[] {
    return Object.keys(SCHEMA_TEMPLATES);
  }

  /**
   * Clears the schema cache
   */
  clearCache(): void {
    this.schemaCache.clear();
  }

  /**
   * Parses a JSON schema string into our internal format
   */
  private parseJSONSchema(jsonContent: string): ParsedSchema {
    try {
      const jsonSchema = JSON.parse(jsonContent);
      
      if (!jsonSchema || typeof jsonSchema !== 'object') {
        throw new Error('JSON schema must be an object');
      }

      if (jsonSchema.type !== 'object') {
        throw new Error('Root schema type must be "object"');
      }

      if (!jsonSchema.properties || typeof jsonSchema.properties !== 'object') {
        throw new Error('Schema must have properties');
      }

      // Convert JSON schema to our internal format
      const properties: Record<string, any> = {};
      
      for (const [fieldName, fieldDef] of Object.entries(jsonSchema.properties as Record<string, any>)) {
        if (!fieldDef || typeof fieldDef !== 'object') {
          throw new Error(`Invalid field definition for ${fieldName}`);
        }

        properties[fieldName] = {
          name: fieldName,
          type: this.mapJSONSchemaType(fieldDef.type),
          description: fieldDef.description,
          required: true, // Will be overridden by required array
          enum: fieldDef.enum,
          items: fieldDef.items ? {
            name: 'item',
            type: this.mapJSONSchemaType(fieldDef.items.type),
            description: fieldDef.items.description
          } : undefined,
          properties: fieldDef.properties ? this.convertNestedProperties(fieldDef.properties) : undefined
        };
      }

      // Set required status based on required array
      const requiredFields = jsonSchema.required || [];
      for (const [fieldName, fieldDef] of Object.entries(properties)) {
        (fieldDef as any).required = requiredFields.includes(fieldName);
      }

      return {
        type: 'object',
        properties,
        required: requiredFields.length > 0 ? requiredFields : undefined,
        description: jsonSchema.description || `JSON Schema with ${Object.keys(properties).length} fields`
      };
    } catch (error) {
      throw new Error(`Failed to parse JSON schema: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Converts nested JSON schema properties
   */
  private convertNestedProperties(properties: Record<string, any>): Record<string, any> {
    const converted: Record<string, any> = {};
    
    for (const [propName, propDef] of Object.entries(properties)) {
      converted[propName] = {
        name: propName,
        type: this.mapJSONSchemaType(propDef.type),
        description: propDef.description,
        required: true, // Default, should be overridden by parent logic
        enum: propDef.enum
      };
    }
    
    return converted;
  }

  /**
   * Maps JSON Schema types to our internal types
   */
  private mapJSONSchemaType(type: string): 'string' | 'number' | 'boolean' | 'array' | 'object' {
    switch (type) {
      case 'string':
        return 'string';
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'array':
        return 'array';
      case 'object':
        return 'object';
      default:
        return 'string'; // Default fallback
    }
  }

  /**
   * Generates a cache key for a schema source
   */
  private getCacheKey(source: SchemaSource): string {
    switch (source.type) {
      case 'dsl':
      case 'json-inline':
        return `${source.type}:${source.content}`;
      case 'json-file':
      case 'zod-file':
        return `${source.type}:${source.path}`;
      case 'template':
        return `${source.type}:${source.name}`;
      default:
        return `unknown:${JSON.stringify(source)}`;
    }
  }
}

// Export a default instance for convenience
export const schemaManager = new SchemaManager();