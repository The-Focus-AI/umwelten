import { describe, it, expect } from 'vitest';
import { validateSchema, createValidator, coerceData } from '../validator.js';
import { ParsedSchema } from '../types.js';

describe('Schema Validator', () => {
  const simpleSchema: ParsedSchema = {
    type: 'object',
    properties: {
      name: { name: 'name', type: 'string' },
      age: { name: 'age', type: 'number' },
      active: { name: 'active', type: 'boolean' }
    },
    required: ['name', 'age']
  };

  describe('validateSchema', () => {
    it('should validate valid data', () => {
      const data = { name: 'John', age: 25, active: true };
      const result = validateSchema(data, simpleSchema);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(data);
      expect(result.errors).toBeUndefined();
    });

    it('should validate data with optional fields missing', () => {
      const data = { name: 'John', age: 25 };
      const result = validateSchema(data, simpleSchema);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(data);
    });

    it('should fail for missing required fields', () => {
      const data = { name: 'John' };
      const result = validateSchema(data, simpleSchema);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Missing required field: age');
    });

    it('should fail for wrong data types', () => {
      const data = { name: 'John', age: 'twenty-five', active: 'yes' };
      const result = validateSchema(data, simpleSchema);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Field age must be a number, got string');
      expect(result.errors).toContain('Field active must be a boolean, got string');
    });

    it('should warn about unexpected fields', () => {
      const data = { name: 'John', age: 25, unexpectedField: 'value' };
      const result = validateSchema(data, simpleSchema);

      expect(result.success).toBe(true);
      expect(result.warnings).toContain('Unexpected field: unexpectedField');
    });

    it('should fail for non-object data', () => {
      const result = validateSchema('not an object', simpleSchema);
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Data must be an object');
    });

    it('should fail for null data', () => {
      const result = validateSchema(null, simpleSchema);
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Data must be an object');
    });

    it('should fail for array data', () => {
      const result = validateSchema(['not', 'an', 'object'], simpleSchema);
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Data must be an object');
    });
  });

  describe('enum validation', () => {
    const enumSchema: ParsedSchema = {
      type: 'object',
      properties: {
        status: { name: 'status', type: 'string', enum: ['active', 'inactive', 'pending'] }
      }
    };

    it('should validate enum values', () => {
      const data = { status: 'active' };
      const result = validateSchema(data, enumSchema);

      expect(result.success).toBe(true);
    });

    it('should fail for invalid enum values', () => {
      const data = { status: 'invalid' };
      const result = validateSchema(data, enumSchema);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Field status must be one of: active, inactive, pending, got "invalid"');
    });
  });

  describe('array validation', () => {
    const arraySchema: ParsedSchema = {
      type: 'object',
      properties: {
        tags: { 
          name: 'tags', 
          type: 'array',
          items: { name: 'tag', type: 'string' }
        }
      }
    };

    it('should validate arrays', () => {
      const data = { tags: ['tag1', 'tag2', 'tag3'] };
      const result = validateSchema(data, arraySchema);

      expect(result.success).toBe(true);
    });

    it('should validate array items', () => {
      const data = { tags: ['tag1', 123, 'tag3'] };
      const result = validateSchema(data, arraySchema);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Field tags[1] must be a string, got number');
    });

    it('should fail for non-arrays', () => {
      const data = { tags: 'not an array' };
      const result = validateSchema(data, arraySchema);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Field tags must be an array, got string');
    });
  });

  describe('nested object validation', () => {
    const nestedSchema: ParsedSchema = {
      type: 'object',
      properties: {
        user: {
          name: 'user',
          type: 'object',
          properties: {
            name: { name: 'name', type: 'string', required: true },
            age: { name: 'age', type: 'number' }
          }
        }
      }
    };

    it('should validate nested objects', () => {
      const data = { user: { name: 'John', age: 25 } };
      const result = validateSchema(data, nestedSchema);

      expect(result.success).toBe(true);
    });

    it('should fail for missing required nested fields', () => {
      const data = { user: { age: 25 } };
      const result = validateSchema(data, nestedSchema);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Missing required property user.name');
    });

    it('should fail for wrong nested field types', () => {
      const data = { user: { name: 123, age: 'twenty-five' } };
      const result = validateSchema(data, nestedSchema);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Field user.name must be a string, got number');
      expect(result.errors).toContain('Field user.age must be a number, got string');
    });
  });

  describe('createValidator', () => {
    it('should create reusable validator function', () => {
      const validator = createValidator(simpleSchema);
      
      const validData = { name: 'John', age: 25 };
      const invalidData = { name: 'John' };

      expect(validator(validData).success).toBe(true);
      expect(validator(invalidData).success).toBe(false);
    });
  });

  describe('coerceData', () => {
    it('should coerce string numbers to numbers', () => {
      const data = { name: 'John', age: '25', active: true };
      const coerced = coerceData(data, simpleSchema);

      expect(coerced.age).toBe(25);
      expect(typeof coerced.age).toBe('number');
    });

    it('should coerce string booleans to booleans', () => {
      const testCases = [
        { input: 'true', expected: true },
        { input: 'false', expected: false },
        { input: 'yes', expected: true },
        { input: 'no', expected: false },
        { input: '1', expected: true },
        { input: '0', expected: false }
      ];

      for (const testCase of testCases) {
        const data = { name: 'John', age: 25, active: testCase.input };
        const coerced = coerceData(data, simpleSchema);
        expect(coerced.active).toBe(testCase.expected);
      }
    });

    it('should coerce values to strings', () => {
      const schema: ParsedSchema = {
        type: 'object',
        properties: {
          id: { name: 'id', type: 'string' }
        }
      };

      const data = { id: 123 };
      const coerced = coerceData(data, schema);

      expect(coerced.id).toBe('123');
      expect(typeof coerced.id).toBe('string');
    });

    it('should coerce comma-separated strings to arrays', () => {
      const schema: ParsedSchema = {
        type: 'object',
        properties: {
          tags: { name: 'tags', type: 'array' }
        }
      };

      const data = { tags: 'tag1, tag2, tag3' };
      const coerced = coerceData(data, schema);

      expect(coerced.tags).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should handle invalid coercions gracefully', () => {
      const data = { name: 'John', age: 'not-a-number', active: true };
      const coerced = coerceData(data, simpleSchema);

      expect(coerced.age).toBe('not-a-number'); // Should remain unchanged
    });

    it('should not modify original data', () => {
      const originalData = { name: 'John', age: '25', active: 'true' };
      const coerced = coerceData(originalData, simpleSchema);

      expect(originalData.age).toBe('25'); // Original unchanged
      expect(coerced.age).toBe(25); // Coerced copy changed
    });
  });
});