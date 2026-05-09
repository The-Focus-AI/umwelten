import { describe, it, expect } from 'vitest';
import { loadZodSchema, convertZodToSchema, validateZodSchemaFile } from '../zod-loader.js';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

describe('Zod Schema Loader', () => {
  describe('loadZodSchema', () => {
    it('should load simple Zod schema file', async () => {
      const schemaPath = path.join(fixturesDir, 'simple-zod-schema.ts');
      const schema = await loadZodSchema(schemaPath);

      expect(schema.type).toBe('object');
      expect(Object.keys(schema.properties)).toEqual(['name', 'age', 'email', 'active']);
      expect(schema.properties.name.type).toBe('string');
      expect(schema.properties.name.description).toBe('Person\'s full name');
      expect(schema.properties.age.type).toBe('number');
      expect(schema.properties.email.required).toBe(false);
      expect(schema.required).toEqual(['name', 'age', 'active']);
    });

    it('should load complex Zod schema file', async () => {
      const schemaPath = path.join(fixturesDir, 'complex-zod-schema.ts');
      const schema = await loadZodSchema(schemaPath);

      expect(schema.type).toBe('object');
      expect(schema.properties.status.enum).toEqual(['active', 'inactive', 'pending']);
      expect(schema.properties.tags.type).toBe('array');
      expect(schema.properties.tags.items?.type).toBe('string');
      expect(schema.properties.metadata.type).toBe('object');
      expect(schema.properties.metadata.properties?.createdAt.type).toBe('string');
      expect(schema.required).toContain('id');
      expect(schema.required).toContain('status');
    });

    it('should throw error for non-existent file', async () => {
      const nonExistentPath = path.join(fixturesDir, 'does-not-exist.ts');
      
      await expect(loadZodSchema(nonExistentPath)).rejects.toThrow('Zod schema file not found');
    });

    it('should throw error for invalid schema file', async () => {
      const invalidPath = path.join(fixturesDir, 'invalid-zod-schema.ts');
      
      await expect(loadZodSchema(invalidPath)).rejects.toThrow('No Zod schema found');
    });
  });

  describe('convertZodToSchema', () => {
    it('should convert simple Zod object schema', () => {
      const zodSchema = z.object({
        name: z.string(),
        age: z.number(),
        active: z.boolean().optional()
      });

      const schema = convertZodToSchema(zodSchema);

      expect(schema.type).toBe('object');
      expect(schema.properties.name.type).toBe('string');
      expect(schema.properties.age.type).toBe('number');
      expect(schema.properties.active.type).toBe('boolean');
      expect(schema.properties.active.required).toBe(false);
      expect(schema.required).toEqual(['name', 'age']);
    });

    it('should handle Zod descriptions', () => {
      const zodSchema = z.object({
        name: z.string().describe('Full name'),
        age: z.number().describe('Age in years')
      });

      const schema = convertZodToSchema(zodSchema);

      expect(schema.properties.name.description).toBe('Full name');
      expect(schema.properties.age.description).toBe('Age in years');
    });

    it('should handle Zod enums', () => {
      const zodSchema = z.object({
        status: z.enum(['active', 'inactive', 'pending']),
        priority: z.literal('high')
      });

      const schema = convertZodToSchema(zodSchema);

      expect(schema.properties.status.type).toBe('string');
      expect(schema.properties.status.enum).toEqual(['active', 'inactive', 'pending']);
      expect(schema.properties.priority.type).toBe('string');
      expect(schema.properties.priority.enum).toEqual(['high']);
    });

    it('should handle Zod arrays', () => {
      const zodSchema = z.object({
        tags: z.array(z.string()),
        numbers: z.array(z.number())
      });

      const schema = convertZodToSchema(zodSchema);

      expect(schema.properties.tags.type).toBe('array');
      expect(schema.properties.tags.items?.type).toBe('string');
      expect(schema.properties.numbers.type).toBe('array');
      expect(schema.properties.numbers.items?.type).toBe('number');
    });

    it('should handle nested Zod objects', () => {
      const zodSchema = z.object({
        user: z.object({
          name: z.string(),
          age: z.number().optional()
        })
      });

      const schema = convertZodToSchema(zodSchema);

      expect(schema.properties.user.type).toBe('object');
      expect(schema.properties.user.properties?.name.type).toBe('string');
      expect(schema.properties.user.properties?.age.type).toBe('number');
      expect(schema.properties.user.properties?.age.required).toBe(false);
    });

    it('should handle Zod default values', () => {
      const zodSchema = z.object({
        name: z.string(),
        count: z.number().default(0),
        active: z.boolean().default(true)
      });

      const schema = convertZodToSchema(zodSchema);

      expect(schema.properties.count.required).toBe(false);
      expect(schema.properties.active.required).toBe(false);
      expect(schema.required).toEqual(['name']);
    });

    it('should handle Zod nullable fields', () => {
      const zodSchema = z.object({
        name: z.string(),
        description: z.string().nullable(),
        age: z.number().optional().nullable()
      });

      const schema = convertZodToSchema(zodSchema);

      expect(schema.properties.name.required).toBe(true);
      expect(schema.properties.description.required).toBe(true);
      expect(schema.properties.age.required).toBe(false);
    });

    it('should throw error for non-object root schema', () => {
      const zodSchema = z.string();

      expect(() => convertZodToSchema(zodSchema)).toThrow('Only ZodObject schemas are supported');
    });
  });

  describe('validateZodSchemaFile', () => {
    it('should validate correct Zod schema file', async () => {
      const schemaPath = path.join(fixturesDir, 'simple-zod-schema.ts');
      const result = await validateZodSchemaFile(schemaPath);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should invalidate non-existent file', async () => {
      const nonExistentPath = path.join(fixturesDir, 'does-not-exist.ts');
      const result = await validateZodSchemaFile(nonExistentPath);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should invalidate invalid schema file', async () => {
      const invalidPath = path.join(fixturesDir, 'invalid-zod-schema.ts');
      const result = await validateZodSchemaFile(invalidPath);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});