import { z } from 'zod';
import { ParsedSchema, SchemaField } from './types.js';

/**
 * Converts a ParsedSchema to a Zod schema
 */
export function parsedSchemaToZod(schema: ParsedSchema): z.ZodSchema {
  if (schema.type !== 'object') {
    throw new Error('Only object schemas are supported for Zod conversion');
  }

  const shape: Record<string, z.ZodSchema> = {};

  for (const [fieldName, field] of Object.entries(schema.properties)) {
    const isRequired = schema.required?.includes(fieldName) ?? false;
    let zodField = convertFieldToZod(field);

    if (!isRequired) {
      zodField = zodField.optional();
    }

    shape[fieldName] = zodField;
  }

  return z.object(shape);
}

/**
 * Converts a SchemaField to a Zod schema
 */
function convertFieldToZod(field: SchemaField): z.ZodSchema {
  switch (field.type) {
    case 'string':
      if (field.enum) {
        return z.enum(field.enum as [string, ...string[]]);
      }
      return z.string();

    case 'number':
      return z.number();

    case 'boolean':
      return z.boolean();

    case 'array':
      if (field.items) {
        const itemSchema = convertFieldToZod(field.items);
        return z.array(itemSchema);
      }
      return z.array(z.unknown());

    case 'object':
      if (field.properties) {
        const objectShape: Record<string, z.ZodSchema> = {};
        for (const [propName, propField] of Object.entries(field.properties)) {
          objectShape[propName] = convertFieldToZod(propField);
        }
        return z.object(objectShape);
      }
      return z.record(z.unknown());

    default:
      return z.unknown();
  }
}
