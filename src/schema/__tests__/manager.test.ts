import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaManager } from '../manager.js';
import { SchemaSource } from '../types.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

describe('Schema Manager', () => {
  let manager: SchemaManager;

  beforeEach(() => {
    manager = new SchemaManager();
    manager.clearCache();
  });

  describe('loadSchema', () => {
    it('should load DSL schema', async () => {
      const source: SchemaSource = {
        type: 'dsl',
        content: 'name, age int, active bool'
      };

      const schema = await manager.loadSchema(source);

      expect(schema.type).toBe('object');
      expect(Object.keys(schema.properties)).toEqual(['name', 'age', 'active']);
      expect(schema.properties.age.type).toBe('number');
      expect(schema.properties.active.type).toBe('boolean');
    });

    it('should load JSON inline schema', async () => {
      const jsonSchema = {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Person name' },
          age: { type: 'number' }
        },
        required: ['name'],
        description: 'Person schema'
      };

      const source: SchemaSource = {
        type: 'json-inline',
        content: JSON.stringify(jsonSchema)
      };

      const schema = await manager.loadSchema(source);

      expect(schema.type).toBe('object');
      expect(schema.properties.name.type).toBe('string');
      expect(schema.properties.name.description).toBe('Person name');
      expect(schema.properties.name.required).toBe(true);
      expect(schema.properties.age.required).toBe(false);
    });

    it('should load Zod schema file', async () => {
      const source: SchemaSource = {
        type: 'zod-file',
        path: path.join(fixturesDir, 'simple-zod-schema.ts')
      };

      const schema = await manager.loadSchema(source);

      expect(schema.type).toBe('object');
      expect(Object.keys(schema.properties)).toContain('name');
      expect(Object.keys(schema.properties)).toContain('age');
    });

    it('should load template schema', async () => {
      const source: SchemaSource = {
        type: 'template',
        name: 'person'
      };

      const schema = await manager.loadSchema(source);

      expect(schema.type).toBe('object');
      expect(schema.properties.name).toBeDefined();
      expect(schema.properties.age).toBeDefined();
      expect(schema.properties.email).toBeDefined();
    });

    it('should throw error for unknown template', async () => {
      const source: SchemaSource = {
        type: 'template',
        name: 'unknown-template'
      };

      await expect(manager.loadSchema(source)).rejects.toThrow('Unknown schema template: unknown-template');
    });

    it('should cache loaded schemas', async () => {
      const source: SchemaSource = {
        type: 'dsl',
        content: 'name, age int'
      };

      const schema1 = await manager.loadSchema(source);
      const schema2 = await manager.loadSchema(source);

      expect(schema1).toBe(schema2); // Should be the same object reference due to caching
    });
  });

  describe('validateData', () => {
    it('should validate data against DSL schema', async () => {
      const source: SchemaSource = {
        type: 'dsl',
        content: 'name, age int, active bool'
      };

      const validData = { name: 'John', age: 25, active: true };
      const result = await manager.validateData(validData, source);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(validData);
    });

    it('should validate data against template schema', async () => {
      const source: SchemaSource = {
        type: 'template',
        name: 'person'
      };

      const validData = { name: 'John', age: 25, email: 'john@example.com', location: 'NYC' };
      const result = await manager.validateData(validData, source);

      expect(result.success).toBe(true);
    });

    it('should fail validation for invalid data', async () => {
      const source: SchemaSource = {
        type: 'dsl',
        content: 'name, age int'
      };

      const invalidData = { name: 'John', age: 'not-a-number' };
      const result = await manager.validateData(invalidData, source);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Field age must be a number, got string');
    });

    it('should coerce data types when requested', async () => {
      const source: SchemaSource = {
        type: 'dsl',
        content: 'name, age int, active bool'
      };

      const data = { name: 'John', age: '25', active: 'true' };
      const result = await manager.validateData(data, source, { coerce: true });

      expect(result.success).toBe(true);
      expect(result.data?.age).toBe(25);
      expect(result.data?.active).toBe(true);
    });

    it('should handle warnings in non-strict mode', async () => {
      const source: SchemaSource = {
        type: 'dsl',
        content: 'name, age int'
      };

      const dataWithExtraFields = { name: 'John', age: 25, extra: 'field' };
      const result = await manager.validateData(dataWithExtraFields, source, { strict: false });

      expect(result.success).toBe(true); // Should succeed despite warnings
      expect(result.warnings).toContain('Unexpected field: extra');
    });
  });

  describe('getJSONSchema', () => {
    it('should convert DSL schema to JSON Schema', async () => {
      const source: SchemaSource = {
        type: 'dsl',
        content: 'name: person name, age int: person age'
      };

      const jsonSchema = await manager.getJSONSchema(source);

      expect(jsonSchema).toHaveProperty('type', 'object');
      expect(jsonSchema).toHaveProperty('properties');
      expect((jsonSchema as any).properties.name).toHaveProperty('type', 'string');
      expect((jsonSchema as any).properties.name).toHaveProperty('description', 'person name');
      expect((jsonSchema as any).properties.age).toHaveProperty('type', 'number');
    });
  });

  describe('getAvailableTemplates', () => {
    it('should return list of available templates', () => {
      const templates = manager.getAvailableTemplates();

      expect(templates).toContain('person');
      expect(templates).toContain('contact');
      expect(templates).toContain('event');
    });
  });

  describe('cache management', () => {
    it('should clear cache', async () => {
      const source: SchemaSource = {
        type: 'dsl',
        content: 'name, age int'
      };

      await manager.loadSchema(source);
      manager.clearCache();

      // Loading again should work (no cached version)
      const schema = await manager.loadSchema(source);
      expect(schema).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle invalid JSON schema', async () => {
      const source: SchemaSource = {
        type: 'json-inline',
        content: 'invalid json'
      };

      await expect(manager.loadSchema(source)).rejects.toThrow('Failed to parse JSON schema');
    });

    it('should handle non-existent Zod file', async () => {
      const source: SchemaSource = {
        type: 'zod-file',
        path: '/non/existent/path.ts'
      };

      await expect(manager.loadSchema(source)).rejects.toThrow('Zod schema file not found');
    });

    it('should handle unknown schema source type', async () => {
      const source = {
        type: 'unknown-type',
        content: 'test'
      } as any;

      await expect(manager.loadSchema(source)).rejects.toThrow('Unknown schema source type');
    });
  });
});