import { SchemaField, ParsedSchema } from './types.js';

/**
 * Parse simple DSL schema format like: "name, age int, active bool, tags array"
 * 
 * Supported formats:
 * - "field" -> string field
 * - "field type" -> typed field (string, number, boolean, array)
 * - "field: description" -> field with description
 * - "field type: description" -> typed field with description
 */
export function parseDSLSchema(dsl: string): ParsedSchema {
  if (!dsl || dsl.trim() === '') {
    throw new Error('Schema DSL cannot be empty');
  }

  const properties: Record<string, SchemaField> = {};
  const required: string[] = [];

  // Split by comma and process each field
  const fields = dsl.split(',').map(f => f.trim()).filter(Boolean);
  
  if (fields.length === 0) {
    throw new Error('No valid fields found in schema DSL');
  }

  for (const field of fields) {
    const parsed = parseFieldDSL(field);
    properties[parsed.name] = parsed;
    
    // All fields are required by default in simple DSL
    if (parsed.required !== false) {
      required.push(parsed.name);
    }
  }

  return {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
    description: `Schema with ${Object.keys(properties).length} fields: ${Object.keys(properties).join(', ')}`
  };
}

/**
 * Parse individual field DSL
 * Examples:
 * - "name" -> { name: "name", type: "string" }
 * - "age int" -> { name: "age", type: "number" }
 * - "name: person's full name" -> { name: "name", type: "string", description: "person's full name" }
 * - "age int: person's age in years" -> { name: "age", type: "number", description: "person's age in years" }
 */
function parseFieldDSL(field: string): SchemaField {
  // Split on colon for description
  const [fieldPart, description] = field.split(':').map(s => s.trim());
  
  // Split field part into name and type
  const parts = fieldPart.split(/\s+/);
  const name = parts[0];
  const typeStr = parts[1];

  if (!name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid field name: "${name}". Field names must be valid identifiers.`);
  }

  // Map type strings to our schema types
  const type = mapTypeString(typeStr);

  const schemaField: SchemaField = {
    name,
    type,
    required: true // DSL fields are required by default
  };

  if (description) {
    schemaField.description = description;
  }

  return schemaField;
}

/**
 * Map type strings to schema field types
 */
function mapTypeString(typeStr?: string): SchemaField['type'] {
  if (!typeStr) return 'string'; // default type
  
  const normalized = typeStr.toLowerCase().trim();
  
  switch (normalized) {
    case 'int':
    case 'integer':
    case 'number':
    case 'num':
      return 'number';
    case 'bool':
    case 'boolean':
      return 'boolean';
    case 'array':
    case 'list':
      return 'array';
    case 'object':
    case 'obj':
      return 'object';
    case 'string':
    case 'str':
    case 'text':
      return 'string';
    default:
      throw new Error(`Unknown type: "${typeStr}". Supported types: string, number, boolean, array, object`);
  }
}

/**
 * Convert parsed schema to JSON Schema format for model instructions
 */
export function toJSONSchema(schema: ParsedSchema): object {
  const jsonSchema: any = {
    type: 'object',
    properties: {},
    additionalProperties: false
  };

  if (schema.required && schema.required.length > 0) {
    jsonSchema.required = schema.required;
  }

  if (schema.description) {
    jsonSchema.description = schema.description;
  }

  // Convert each field to JSON Schema property
  for (const [fieldName, field] of Object.entries(schema.properties)) {
    jsonSchema.properties[fieldName] = fieldToJSONSchemaProperty(field);
  }

  return jsonSchema;
}

/**
 * Convert a schema field to JSON Schema property
 */
function fieldToJSONSchemaProperty(field: SchemaField): object {
  const property: any = {};

  switch (field.type) {
    case 'string':
      property.type = 'string';
      break;
    case 'number':
      property.type = 'number';
      break;
    case 'boolean':
      property.type = 'boolean';
      break;
    case 'array':
      property.type = 'array';
      if (field.items) {
        property.items = fieldToJSONSchemaProperty(field.items);
      } else {
        property.items = { type: 'string' }; // default array item type
      }
      break;
    case 'object':
      property.type = 'object';
      if (field.properties) {
        property.properties = {};
        for (const [propName, propField] of Object.entries(field.properties)) {
          property.properties[propName] = fieldToJSONSchemaProperty(propField);
        }
      }
      break;
  }

  if (field.description) {
    property.description = field.description;
  }

  if (field.enum) {
    property.enum = field.enum;
  }

  return property;
}