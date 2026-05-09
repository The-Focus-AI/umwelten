import { z } from 'zod';

// Core schema types
export interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  required?: boolean;
  enum?: string[];
  items?: SchemaField; // For arrays
  properties?: Record<string, SchemaField>; // For objects
}

export interface ParsedSchema {
  type: 'object';
  properties: Record<string, SchemaField>;
  required?: string[];
  description?: string;
}

export interface SchemaValidationResult {
  success: boolean;
  data?: any;
  errors?: string[];
  warnings?: string[];
}

// Schema source types
export type SchemaSource = 
  | { type: 'dsl'; content: string }
  | { type: 'json-file'; path: string }
  | { type: 'json-inline'; content: string }
  | { type: 'zod-file'; path: string }
  | { type: 'template'; name: string };

// Configuration for schema processing
export interface SchemaConfig {
  strictValidation?: boolean;
  confidenceScores?: boolean;
  partialValidation?: boolean;
  outputFormat?: 'json' | 'typescript' | 'yaml';
}

// Built-in schema templates
export const SCHEMA_TEMPLATES = {
  person: {
    type: 'object' as const,
    properties: {
      name: { name: 'name', type: 'string' as const, description: 'Full name of the person' },
      age: { name: 'age', type: 'number' as const, description: 'Age in years' },
      email: { name: 'email', type: 'string' as const, description: 'Email address' },
      location: { name: 'location', type: 'string' as const, description: 'Current location or city' }
    },
    required: ['name'],
    description: 'Basic person information extraction'
  },
  contact: {
    type: 'object' as const,
    properties: {
      name: { name: 'name', type: 'string' as const, description: 'Contact name' },
      email: { name: 'email', type: 'string' as const, description: 'Email address' },
      phone: { name: 'phone', type: 'string' as const, description: 'Phone number' },
      company: { name: 'company', type: 'string' as const, description: 'Company name' }
    },
    required: ['name'],
    description: 'Contact information extraction'
  },
  event: {
    type: 'object' as const,
    properties: {
      name: { name: 'name', type: 'string' as const, description: 'Event name' },
      date: { name: 'date', type: 'string' as const, description: 'Event date in YYYY-MM-DD format' },
      time: { name: 'time', type: 'string' as const, description: 'Event time in HH:MM format' },
      location: { name: 'location', type: 'string' as const, description: 'Event location' },
      description: { name: 'description', type: 'string' as const, description: 'Event description' }
    },
    required: ['name', 'date'],
    description: 'Event information extraction'
  }
} as const;