import { SchemaField, ParsedSchema, SchemaValidationResult } from './types.js';

/**
 * Validates data against a parsed schema
 */
export function validateSchema(data: any, schema: ParsedSchema): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      success: false,
      errors: ['Data must be an object']
    };
  }

  // Check required fields
  if (schema.required) {
    for (const requiredField of schema.required) {
      if (!(requiredField in data) || data[requiredField] === undefined || data[requiredField] === null) {
        errors.push(`Missing required field: ${requiredField}`);
      }
    }
  }

  // Validate each field in the schema
  for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
    const value = data[fieldName];

    // Skip validation if field is missing and not required
    if (value === undefined || value === null) {
      if (fieldSchema.required !== false && schema.required?.includes(fieldName)) {
        // Already handled above in required fields check
      }
      continue;
    }

    const fieldErrors = validateField(value, fieldSchema, fieldName);
    errors.push(...fieldErrors);
  }

  // Check for unexpected fields
  for (const dataField of Object.keys(data)) {
    if (!(dataField in schema.properties)) {
      warnings.push(`Unexpected field: ${dataField}`);
    }
  }

  return {
    success: errors.length === 0,
    data: errors.length === 0 ? data : undefined,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

/**
 * Validates a single field value against its schema
 */
function validateField(value: any, fieldSchema: SchemaField, fieldPath: string): string[] {
  const errors: string[] = [];

  switch (fieldSchema.type) {
    case 'string':
      if (typeof value !== 'string') {
        errors.push(`Field ${fieldPath} must be a string, got ${typeof value}`);
      } else if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
        errors.push(`Field ${fieldPath} must be one of: ${fieldSchema.enum.join(', ')}, got "${value}"`);
      }
      break;

    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        errors.push(`Field ${fieldPath} must be a number, got ${typeof value}`);
      }
      break;

    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(`Field ${fieldPath} must be a boolean, got ${typeof value}`);
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        errors.push(`Field ${fieldPath} must be an array, got ${typeof value}`);
      } else if (fieldSchema.items) {
        // Validate array items if item schema is provided
        for (let i = 0; i < value.length; i++) {
          const itemErrors = validateField(value[i], fieldSchema.items, `${fieldPath}[${i}]`);
          errors.push(...itemErrors);
        }
      }
      break;

    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push(`Field ${fieldPath} must be an object, got ${typeof value}`);
      } else if (fieldSchema.properties) {
        // Validate nested object properties
        for (const [propName, propSchema] of Object.entries(fieldSchema.properties)) {
          const propValue = value[propName];
          if (propValue !== undefined && propValue !== null) {
            const propErrors = validateField(propValue, propSchema, `${fieldPath}.${propName}`);
            errors.push(...propErrors);
          } else if (propSchema.required !== false) {
            errors.push(`Missing required property ${fieldPath}.${propName}`);
          }
        }
      }
      break;
  }

  return errors;
}

/**
 * Creates a validation function for a schema that can be reused
 */
export function createValidator(schema: ParsedSchema) {
  return (data: any): SchemaValidationResult => {
    return validateSchema(data, schema);
  };
}

/**
 * Attempts to coerce data types to match the schema where possible
 */
export function coerceData(data: any, schema: ParsedSchema): any {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return data;
  }

  const coerced: any = { ...data };

  for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
    const value = coerced[fieldName];

    if (value === undefined || value === null) {
      continue;
    }

    coerced[fieldName] = coerceValue(value, fieldSchema);
  }

  return coerced;
}

/**
 * Attempts to coerce a single value to match the field schema
 */
function coerceValue(value: any, fieldSchema: SchemaField): any {
  switch (fieldSchema.type) {
    case 'string':
      if (typeof value === 'string') return value;
      return String(value);

    case 'number':
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return isNaN(parsed) ? value : parsed;
      }
      return value;

    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const lower = value.toLowerCase();
        if (lower === 'true' || lower === 'yes' || lower === '1') return true;
        if (lower === 'false' || lower === 'no' || lower === '0') return false;
      }
      if (typeof value === 'number') {
        return value !== 0;
      }
      return value;

    case 'array':
      if (Array.isArray(value)) {
        if (fieldSchema.items) {
          return value.map(item => coerceValue(item, fieldSchema.items!));
        }
        return value;
      }
      // Try to convert string to array (comma-separated)
      if (typeof value === 'string') {
        return value.split(',').map(s => s.trim()).filter(Boolean);
      }
      return value;

    case 'object':
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        if (fieldSchema.properties) {
          const coercedObj: any = { ...value };
          for (const [propName, propSchema] of Object.entries(fieldSchema.properties)) {
            if (coercedObj[propName] !== undefined) {
              coercedObj[propName] = coerceValue(coercedObj[propName], propSchema);
            }
          }
          return coercedObj;
        }
        return value;
      }
      return value;

    default:
      return value;
  }
}