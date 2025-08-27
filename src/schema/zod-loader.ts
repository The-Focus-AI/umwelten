import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { z } from 'zod';
import { SchemaField, ParsedSchema } from './types.js';

/**
 * Loads and parses a Zod schema file
 */
export async function loadZodSchema(filePath: string): Promise<ParsedSchema> {
  if (!existsSync(filePath)) {
    throw new Error(`Zod schema file not found: ${filePath}`);
  }

  try {
    // Dynamically import the schema file
    const resolvedPath = path.resolve(filePath);
    const schemaModule = await import(resolvedPath);
    
    // Look for common export names
    const zodSchema = schemaModule.default || 
                      schemaModule.schema || 
                      schemaModule.Schema ||
                      schemaModule.zodSchema;

    if (!zodSchema) {
      throw new Error(`No Zod schema found in ${filePath}. Expected exports: default, schema, Schema, or zodSchema`);
    }

    if (!(zodSchema instanceof z.ZodType)) {
      throw new Error(`Export is not a Zod schema: ${typeof zodSchema}`);
    }

    return convertZodToSchema(zodSchema);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load Zod schema from ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Converts a Zod schema to our internal ParsedSchema format
 */
export function convertZodToSchema(zodSchema: z.ZodType): ParsedSchema {
  if (!(zodSchema instanceof z.ZodObject)) {
    throw new Error('Only ZodObject schemas are supported at the root level');
  }

  const properties: Record<string, SchemaField> = {};
  const required: string[] = [];

  // Extract shape from ZodObject
  const shape = zodSchema.shape;

  for (const [fieldName, fieldSchema] of Object.entries(shape)) {
    const schemaField = convertZodFieldToSchemaField(fieldName, fieldSchema as z.ZodType);
    properties[fieldName] = schemaField;

    // Check if field is required (not optional)
    if (!(fieldSchema instanceof z.ZodOptional) && 
        !(fieldSchema instanceof z.ZodDefault) &&
        !(fieldSchema instanceof z.ZodNullable)) {
      required.push(fieldName);
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
    description: getZodDescription(zodSchema) || `Zod schema with ${Object.keys(properties).length} fields`
  };
}

/**
 * Converts a Zod field to our SchemaField format
 */
function convertZodFieldToSchemaField(name: string, zodField: z.ZodType): SchemaField {
  // Unwrap optional, default, and nullable modifiers
  let innerType = zodField;
  let isRequired = true;

  // Handle chained modifiers like .optional().nullable()
  let currentType = zodField;
  while (true) {
    if (currentType instanceof z.ZodOptional) {
      currentType = currentType.unwrap();
      isRequired = false;
    } else if (currentType instanceof z.ZodDefault) {
      currentType = currentType.removeDefault();
      isRequired = false;
    } else if (currentType instanceof z.ZodNullable) {
      currentType = currentType.unwrap();
      // Don't change isRequired for nullable - it just allows null values
    } else {
      break;
    }
  }
  
  innerType = currentType;

  const schemaField: SchemaField = {
    name,
    type: getZodFieldType(innerType),
    required: isRequired
  };

  // Add description if available from any level (original field, or inner type after unwrapping)
  let description = getZodDescription(zodField);
  if (!description && innerType !== zodField) {
    description = getZodDescription(innerType);
  }
  if (description) {
    schemaField.description = description;
  }

  // Handle enum values
  if (innerType instanceof z.ZodEnum) {
    schemaField.enum = innerType.options;
  } else if (innerType instanceof z.ZodLiteral) {
    schemaField.enum = [String(innerType.value)];
  }

  // Handle array items
  if (innerType instanceof z.ZodArray) {
    const itemSchema = convertZodFieldToSchemaField('item', innerType.element);
    schemaField.items = itemSchema;
  }

  // Handle object properties
  if (innerType instanceof z.ZodObject) {
    const nestedProperties: Record<string, SchemaField> = {};
    const shape = innerType.shape;
    
    for (const [propName, propSchema] of Object.entries(shape)) {
      nestedProperties[propName] = convertZodFieldToSchemaField(propName, propSchema as z.ZodType);
    }
    
    schemaField.properties = nestedProperties;
  }

  return schemaField;
}

/**
 * Maps Zod types to our schema field types
 */
function getZodFieldType(zodType: z.ZodType): SchemaField['type'] {
  if (zodType instanceof z.ZodString) return 'string';
  if (zodType instanceof z.ZodNumber) return 'number';
  if (zodType instanceof z.ZodBoolean) return 'boolean';
  if (zodType instanceof z.ZodArray) return 'array';
  if (zodType instanceof z.ZodObject) return 'object';
  if (zodType instanceof z.ZodEnum) return 'string';
  if (zodType instanceof z.ZodLiteral) return typeof zodType.value as SchemaField['type'];
  if (zodType instanceof z.ZodUnion) {
    // For unions, try to infer the most appropriate type
    const options = zodType.options;
    if (options.length > 0) {
      return getZodFieldType(options[0]);
    }
  }
  
  // Default to string for unknown types
  return 'string';
}

/**
 * Extracts description from Zod schema
 */
function getZodDescription(zodType: z.ZodType): string | undefined {
  // Check if the schema has a description in its definition
  if ('_def' in zodType && zodType._def) {
    const def = zodType._def as any;
    if ('description' in def && def.description) {
      return def.description;
    }
    // For some Zod versions, descriptions might be stored differently
    if (def.innerType && 'description' in def.innerType._def) {
      return def.innerType._def.description;
    }
  }
  
  // Try to get it through the description property if it exists
  if ('description' in zodType && (zodType as any).description) {
    return (zodType as any).description;
  }
  
  return undefined;
}

/**
 * Validates that a file exports a valid Zod schema without importing it
 */
export async function validateZodSchemaFile(filePath: string): Promise<{valid: boolean; error?: string}> {
  try {
    if (!existsSync(filePath)) {
      return { valid: false, error: `File not found: ${filePath}` };
    }

    const content = await readFile(filePath, 'utf-8');
    
    // Basic validation - check for Zod imports and exports
    if (!content.includes('import') && !content.includes('require')) {
      return { valid: false, error: 'File does not appear to import Zod' };
    }

    if (!content.includes('export')) {
      return { valid: false, error: 'File does not export a schema' };
    }

    // Try to import it for real validation
    await loadZodSchema(filePath);
    
    return { valid: true };
  } catch (error) {
    return { 
      valid: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}