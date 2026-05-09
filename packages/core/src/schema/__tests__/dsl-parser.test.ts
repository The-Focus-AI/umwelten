import { describe, it, expect } from 'vitest';
import { parseDSLSchema, toJSONSchema } from '../dsl-parser.js';

describe('DSL Parser', () => {
  describe('parseDSLSchema', () => {
    it('should parse simple field list', () => {
      const result = parseDSLSchema('name, age, email');
      
      expect(result.type).toBe('object');
      expect(Object.keys(result.properties)).toEqual(['name', 'age', 'email']);
      
      // All fields should default to string type
      expect(result.properties.name.type).toBe('string');
      expect(result.properties.age.type).toBe('string');
      expect(result.properties.email.type).toBe('string');
      
      // All fields should be required by default
      expect(result.required).toEqual(['name', 'age', 'email']);
    });

    it('should parse typed fields', () => {
      const result = parseDSLSchema('name, age int, active bool, tags array');
      
      expect(result.properties.name.type).toBe('string');
      expect(result.properties.age.type).toBe('number');
      expect(result.properties.active.type).toBe('boolean');
      expect(result.properties.tags.type).toBe('array');
    });

    it('should parse fields with descriptions', () => {
      const result = parseDSLSchema('name: full name, age int: age in years');
      
      expect(result.properties.name.description).toBe('full name');
      expect(result.properties.age.description).toBe('age in years');
      expect(result.properties.age.type).toBe('number');
    });

    it('should handle various type aliases', () => {
      const result = parseDSLSchema('count integer, price num, enabled boolean, items list');
      
      expect(result.properties.count.type).toBe('number');
      expect(result.properties.price.type).toBe('number');
      expect(result.properties.enabled.type).toBe('boolean');
      expect(result.properties.items.type).toBe('array');
    });

    it('should handle whitespace gracefully', () => {
      const result = parseDSLSchema('  name  ,   age   int  ,  email  : person email  ');
      
      expect(Object.keys(result.properties)).toEqual(['name', 'age', 'email']);
      expect(result.properties.age.type).toBe('number');
      expect(result.properties.email.description).toBe('person email');
    });

    it('should generate helpful description', () => {
      const result = parseDSLSchema('name, age int, email');
      
      expect(result.description).toContain('3 fields');
      expect(result.description).toContain('name, age, email');
    });

    it('should throw error for empty schema', () => {
      expect(() => parseDSLSchema('')).toThrow('Schema DSL cannot be empty');
      expect(() => parseDSLSchema('   ')).toThrow('Schema DSL cannot be empty');
    });

    it('should throw error for invalid field names', () => {
      expect(() => parseDSLSchema('123invalid')).toThrow('Invalid field name');
      expect(() => parseDSLSchema('invalid-name')).toThrow('Invalid field name');
      expect(() => parseDSLSchema('invalid.name')).toThrow('Invalid field name');
    });

    it('should throw error for unknown types', () => {
      expect(() => parseDSLSchema('name unknowntype')).toThrow('Unknown type: "unknowntype"');
    });

    it('should allow valid field names', () => {
      const result = parseDSLSchema('valid_name, _alsoValid, camelCase, PascalCase');
      
      expect(Object.keys(result.properties)).toEqual(['valid_name', '_alsoValid', 'camelCase', 'PascalCase']);
    });
  });

  describe('toJSONSchema', () => {
    it('should convert simple schema to JSON Schema', () => {
      const parsed = parseDSLSchema('name, age int, active bool');
      const jsonSchema = toJSONSchema(parsed);

      expect(jsonSchema).toEqual({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          active: { type: 'boolean' }
        },
        required: ['name', 'age', 'active'],
        additionalProperties: false,
        description: expect.stringContaining('3 fields')
      });
    });

    it('should convert schema with descriptions', () => {
      const parsed = parseDSLSchema('name: full name, age int: person age');
      const jsonSchema = toJSONSchema(parsed);

      expect(jsonSchema.properties.name.description).toBe('full name');
      expect(jsonSchema.properties.age.description).toBe('person age');
    });

    it('should handle array types', () => {
      const parsed = parseDSLSchema('tags array');
      const jsonSchema = toJSONSchema(parsed);

      expect(jsonSchema.properties.tags).toEqual({
        type: 'array',
        items: { type: 'string' }
      });
    });

    it('should handle optional required array', () => {
      const parsed = {
        type: 'object' as const,
        properties: {
          name: { name: 'name', type: 'string' as const }
        }
        // no required array
      };
      
      const jsonSchema = toJSONSchema(parsed);
      
      expect(jsonSchema.required).toBeUndefined();
    });
  });

  describe('complex examples', () => {
    it('should parse roadtrip-style schema', () => {
      const dsl = 'startLocation, endLocation, startDate, totalDays int: number of days, withKids bool: traveling with children';
      const result = parseDSLSchema(dsl);

      expect(result.properties.startLocation.type).toBe('string');
      expect(result.properties.endLocation.type).toBe('string');
      expect(result.properties.startDate.type).toBe('string');
      expect(result.properties.totalDays.type).toBe('number');
      expect(result.properties.totalDays.description).toBe('number of days');
      expect(result.properties.withKids.type).toBe('boolean');
      expect(result.properties.withKids.description).toBe('traveling with children');
    });

    it('should parse person extraction schema', () => {
      const dsl = 'name: full name, email: email address, phone: phone number, experience int: years of experience, skills array: list of skills';
      const result = parseDSLSchema(dsl);

      expect(Object.keys(result.properties)).toEqual(['name', 'email', 'phone', 'experience', 'skills']);
      expect(result.properties.experience.type).toBe('number');
      expect(result.properties.skills.type).toBe('array');
      
      const jsonSchema = toJSONSchema(result);
      expect(jsonSchema.properties.skills.items).toEqual({ type: 'string' });
    });
  });
});