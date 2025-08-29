# Schema Validation

Comprehensive guide to structured output validation using Zod schemas, DSL formats, and JSON Schema. Learn how to extract reliable, type-safe data from AI model responses.

## Overview

Umwelten provides multiple approaches to schema validation:

1. **DSL (Domain Specific Language)**: Simple string-based field definitions
2. **Zod Schemas**: TypeScript-first validation with rich type inference
3. **JSON Schema**: Standard JSON Schema format for interoperability
4. **Schema Templates**: Pre-built schemas for common use cases

## DSL Format

The simplest way to define structured output requirements.

### Basic Syntax

```typescript
// Field types supported in DSL
const basicSchema = "name, age int, active bool, tags array";

// With descriptions
const descriptiveSchema = "title, author, published_date, page_count int, genres array";

// Optional fields
const optionalSchema = "name, email?, phone?, address?";
```

### DSL Type System

| Type | Example | Description |
|------|---------|-------------|
| `string` | `name` | Text field (default) |
| `int` | `age int` | Integer number |
| `number` | `price number` | Decimal number |
| `bool` | `active bool` | Boolean true/false |
| `array` | `tags array` | Array of strings |
| `?` | `email?` | Optional field |

### Usage Examples

```typescript
import { BaseModelRunner } from '../src/cognition/runner.js';
import { Interaction } from '../src/interaction/interaction.js';

// Simple person extraction
const model = { name: 'gemini-2.0-flash', provider: 'google' };
const conversation = new Interaction(model, 'Extract person information');

conversation.addMessage({
  role: 'user',
  content: 'John Smith, 35 years old, software engineer, lives in San Francisco. He enjoys hiking, coding, and photography.'
});

const runner = new BaseModelRunner();

// Using CLI approach (for reference)
// --schema "name, age int, occupation, location, hobbies array"

// Using TypeScript API
const response = await runner.streamObject(conversation, createDSLSchema("name, age int, occupation, location, hobbies array"));
```

### Complex DSL Examples

```typescript
// Document metadata extraction
const documentSchema = "title, author, publication_date, page_count int, summary, keywords array, category";

// Product information
const productSchema = "name, price number, in_stock bool, description, features array, rating number, reviews_count int";

// Event details
const eventSchema = "event_name, date, location, attendees int, organizer, topics array, registration_required bool";
```

## Zod Schemas

TypeScript-first validation with rich type inference and runtime safety.

### Basic Zod Usage

```typescript
import { z } from 'zod';
import { BaseModelRunner } from '../src/cognition/runner.js';
import { Interaction } from '../src/interaction/interaction.js';

// Define schema
const PersonSchema = z.object({
  name: z.string().describe('Full name of the person'),
  age: z.number().int().min(0).max(120).describe('Age in years'),
  occupation: z.string().describe('Current job or profession'),
  location: z.string().optional().describe('City or region where they live'),
  hobbies: z.array(z.string()).describe('List of hobbies and interests'),
  active: z.boolean().default(true).describe('Whether the person is currently active')
});

// Extract type for use in TypeScript
type Person = z.infer<typeof PersonSchema>;

// Use schema with model
const conversation = new Interaction(model, 'Extract structured person data');
conversation.addMessage({
  role: 'user',
  content: 'Jane Doe is a 28-year-old graphic designer from Portland who loves rock climbing and painting.'
});

const runner = new BaseModelRunner();
const response = await runner.streamObject(conversation, PersonSchema);

// response.structuredOutput is fully typed as Person
const person: Person = response.structuredOutput;
console.log(person.name);     // string
console.log(person.age);      // number
console.log(person.hobbies);  // string[]
```

### Advanced Zod Patterns

#### Nested Objects

```typescript
const CompanySchema = z.object({
  name: z.string(),
  founded: z.number().int(),
  headquarters: z.object({
    city: z.string(),
    country: z.string(),
    address: z.string().optional()
  }),
  employees: z.object({
    total: z.number().int(),
    breakdown: z.object({
      engineering: z.number().int(),
      sales: z.number().int(),
      marketing: z.number().int(),
      other: z.number().int()
    }).optional()
  }),
  products: z.array(z.object({
    name: z.string(),
    category: z.string(),
    launch_date: z.string(),
    active: z.boolean()
  }))
});

type Company = z.infer<typeof CompanySchema>;
```

#### Discriminated Unions

```typescript
const DocumentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('article'),
    title: z.string(),
    author: z.string(),
    publication_date: z.string(),
    word_count: z.number().int(),
    tags: z.array(z.string())
  }),
  z.object({
    type: z.literal('report'),
    title: z.string(),
    organization: z.string(),
    report_date: z.string(),
    page_count: z.number().int(),
    executive_summary: z.string(),
    findings: z.array(z.string())
  }),
  z.object({
    type: z.literal('manual'),
    product_name: z.string(),
    version: z.string(),
    last_updated: z.string(),
    sections: z.array(z.object({
      title: z.string(),
      page_number: z.number().int()
    }))
  })
]);

// Schema automatically validates based on 'type' field
type Document = z.infer<typeof DocumentSchema>;
```

#### Validation with Refinements

```typescript
const FinancialDataSchema = z.object({
  company: z.string(),
  revenue: z.number().positive(),
  expenses: z.number().positive(),
  profit: z.number(),
  profit_margin: z.number().min(-100).max(100),
  quarter: z.enum(['Q1', 'Q2', 'Q3', 'Q4']),
  year: z.number().int().min(2000).max(2030)
}).refine(
  (data) => data.profit === data.revenue - data.expenses,
  {
    message: "Profit must equal revenue minus expenses",
    path: ["profit"]
  }
).refine(
  (data) => Math.abs(data.profit_margin - (data.profit / data.revenue * 100)) < 0.01,
  {
    message: "Profit margin must be calculated correctly",
    path: ["profit_margin"]
  }
);
```

#### Conditional Validation

```typescript
const EventSchema = z.object({
  name: z.string(),
  type: z.enum(['online', 'in-person', 'hybrid']),
  date: z.string(),
  attendees: z.number().int(),
  // Conditional fields based on event type
  venue: z.string().optional(),
  virtual_platform: z.string().optional(),
  registration_required: z.boolean(),
  // Registration details only if required
  registration_fee: z.number().optional(),
  registration_deadline: z.string().optional()
}).superRefine((data, ctx) => {
  // Venue required for in-person or hybrid events
  if ((data.type === 'in-person' || data.type === 'hybrid') && !data.venue) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Venue is required for in-person and hybrid events",
      path: ['venue']
    });
  }
  
  // Virtual platform required for online or hybrid events
  if ((data.type === 'online' || data.type === 'hybrid') && !data.virtual_platform) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Virtual platform is required for online and hybrid events",
      path: ['virtual_platform']
    });
  }
  
  // Registration details required if registration is required
  if (data.registration_required) {
    if (data.registration_fee === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Registration fee is required when registration is required",
        path: ['registration_fee']
      });
    }
    if (!data.registration_deadline) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Registration deadline is required when registration is required",
        path: ['registration_deadline']
      });
    }
  }
});
```

### Real-World Zod Examples

#### Image Analysis Schema

From `scripts/image-feature-extract.ts`:

```typescript
const ImageFeatureSchema = z.object({
  able_to_parse: z.object({
    value: z.boolean().describe('Can the model parse and analyze the image?'),
    confidence: z.number().min(0).max(1).describe('Confidence score (0-1)')
  }),
  image_description: z.object({
    value: z.string().describe('Detailed description of the image'),
    confidence: z.number().min(0).max(1)
  }),
  color_palette: z.object({
    value: z.enum(['warm', 'cool', 'monochrome', 'earthy', 'pastel', 'vibrant', 'neutral']),
    confidence: z.number().min(0).max(1)
  }),
  scene_type: z.object({
    value: z.enum(['indoor', 'outdoor', 'unknown']),
    confidence: z.number().min(0).max(1)
  }),
  people_count: z.object({
    value: z.number().int().min(0),
    confidence: z.number().min(0).max(1)
  })
});

type ImageFeature = z.infer<typeof ImageFeatureSchema>;
```

#### Pricing Data Schema

From `scripts/google-pricing.ts`:

```typescript
const PricingSchema = z.object({
  pricing: z.array(z.object({
    model: z.string().describe('The model name'),
    modelId: z.string().describe('The model identifier'),
    inputCost: z.number().describe('Cost per 1M input tokens'),
    outputCost: z.number().describe('Cost per 1M output tokens'),
    description: z.string().describe('Model description'),
    contextLength: z.number().describe('Context window size'),
    caching: z.boolean().describe('Supports caching')
  }))
});

type PricingInfo = z.infer<typeof PricingSchema>;
```

## File-Based Schemas

### Zod Schema Files

Create reusable schema files:

```typescript
// schemas/document-analysis.ts
import { z } from 'zod';

export const DocumentAnalysisSchema = z.object({
  title: z.string(),
  document_type: z.enum(['article', 'report', 'manual', 'blog', 'academic']),
  summary: z.string().max(1000),
  key_points: z.array(z.string()),
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  complexity_level: z.number().int().min(1).max(10),
  target_audience: z.enum(['general', 'technical', 'academic', 'business']),
  language: z.string().default('en'),
  metadata: z.object({
    word_count: z.number().int(),
    estimated_reading_time: z.number().int(),
    confidence: z.number().min(0).max(1)
  })
});

export type DocumentAnalysis = z.infer<typeof DocumentAnalysisSchema>;
```

Usage with file-based schemas:

```typescript
// Import schema from file
import { DocumentAnalysisSchema } from './schemas/document-analysis.js';

const conversation = new Interaction(model, 'Analyze this document');
await conversation.addAttachmentFromPath('./document.pdf');
conversation.addMessage({
  role: 'user',
  content: 'Provide comprehensive document analysis'
});

const response = await runner.streamObject(conversation, DocumentAnalysisSchema);
const analysis: DocumentAnalysis = response.structuredOutput;
```

### JSON Schema Files

For interoperability with non-TypeScript systems:

```json
// schemas/person.json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Full name of the person"
    },
    "age": {
      "type": "integer",
      "minimum": 0,
      "maximum": 120,
      "description": "Age in years"
    },
    "occupation": {
      "type": "string",
      "description": "Current job or profession"
    },
    "skills": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "List of professional skills"
    },
    "active": {
      "type": "boolean",
      "default": true,
      "description": "Whether the person is currently active"
    }
  },
  "required": ["name", "age", "occupation"],
  "additionalProperties": false
}
```

## Schema Templates

Pre-built schemas for common use cases:

### Built-in Templates

```typescript
// Available templates (conceptual - check actual implementation)
const templates = {
  'person-basic': 'name, age int, occupation',
  'document-summary': 'title, summary, key_points array, sentiment',
  'product-review': 'product_name, rating int, review_text, pros array, cons array',
  'event-details': 'name, date, location, attendees int, description',
  'contact-info': 'name, email, phone?, company?, role?'
};

// Usage with CLI
// --schema-template "person-basic"

// Usage programmatically (check actual API)
const templateSchema = getSchemaTemplate('person-basic');
```

### Custom Template Creation

Create your own reusable templates:

```typescript
// templates/business-analysis.ts
export const BusinessAnalysisTemplate = z.object({
  company_name: z.string(),
  industry: z.string(),
  market_position: z.enum(['leader', 'challenger', 'follower', 'niche']),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  opportunities: z.array(z.string()),
  threats: z.array(z.string()),
  financial_health: z.enum(['excellent', 'good', 'fair', 'poor']),
  growth_potential: z.number().min(1).max(10),
  investment_recommendation: z.enum(['strong_buy', 'buy', 'hold', 'sell', 'strong_sell']),
  confidence: z.number().min(0).max(1)
});
```

## Validation and Error Handling

### Type Coercion

Handle loose input data with type coercion:

```typescript
const FlexibleSchema = z.object({
  // Coerce strings to numbers
  age: z.coerce.number().int(),
  price: z.coerce.number(),
  
  // Coerce strings to booleans
  active: z.coerce.boolean(),
  
  // Transform and validate
  email: z.string().email().toLowerCase(),
  
  // Default values for missing fields
  created_at: z.string().default(() => new Date().toISOString())
});

// Handles inputs like { age: "25", active: "true", price: "99.99" }
```

### Validation Error Handling

```typescript
import { z } from 'zod';

try {
  const response = await runner.streamObject(conversation, StrictSchema);
  console.log('Validation successful:', response.structuredOutput);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Schema validation failed:');
    error.issues.forEach(issue => {
      console.error(`- ${issue.path.join('.')}: ${issue.message}`);
    });
    
    // Handle specific validation errors
    const missingFields = error.issues
      .filter(issue => issue.code === 'invalid_type')
      .map(issue => issue.path.join('.'));
    
    if (missingFields.length > 0) {
      console.error('Missing required fields:', missingFields);
    }
  } else {
    console.error('Other error:', error.message);
  }
}
```

### Partial Validation

When you want to accept partial results:

```typescript
const CompleteSchema = z.object({
  title: z.string(),
  author: z.string(),
  publication_date: z.string(),
  summary: z.string(),
  key_points: z.array(z.string())
});

// Create partial version for graceful degradation
const PartialSchema = CompleteSchema.partial();

// Or make specific fields optional
const FlexibleSchema = CompleteSchema.extend({
  publication_date: z.string().optional(),
  key_points: z.array(z.string()).optional()
});
```

## Performance Considerations

### Schema Complexity

```typescript
// Simple schema - faster validation, lower model complexity
const SimpleSchema = z.object({
  name: z.string(),
  category: z.string(),
  score: z.number()
});

// Complex schema - slower validation, higher model complexity
const ComplexSchema = z.object({
  analysis: z.object({
    metadata: z.object({
      processed_at: z.string(),
      version: z.string(),
      confidence: z.number()
    }),
    results: z.array(z.object({
      category: z.string(),
      subcategory: z.string().optional(),
      score: z.number().min(0).max(1),
      evidence: z.array(z.string()),
      reasoning: z.string(),
      related_items: z.array(z.string()).optional()
    })),
    summary: z.object({
      total_items: z.number().int(),
      average_score: z.number(),
      distribution: z.record(z.number())
    })
  })
});
```

### Optimization Strategies

```typescript
// Use enums instead of free text when possible
const CategorySchema = z.object({
  // Good: Limited options, easier for model
  priority: z.enum(['low', 'medium', 'high']),
  
  // Less optimal: Free text
  description: z.string()
});

// Provide clear descriptions
const WellDocumentedSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral'])
    .describe('Overall emotional tone of the content'),
  
  confidence: z.number().min(0).max(1)
    .describe('Confidence score from 0 (uncertain) to 1 (very confident)'),
    
  key_themes: z.array(z.string())
    .describe('3-5 main themes or topics discussed in the content')
});
```

## Testing Schemas

### Schema Validation Testing

```typescript
import { describe, it, expect } from 'vitest';
import { PersonSchema } from './schemas/person.js';

describe('PersonSchema', () => {
  it('validates correct person data', () => {
    const validPerson = {
      name: 'John Doe',
      age: 30,
      occupation: 'Engineer',
      skills: ['JavaScript', 'TypeScript']
    };
    
    expect(() => PersonSchema.parse(validPerson)).not.toThrow();
  });
  
  it('rejects invalid age', () => {
    const invalidPerson = {
      name: 'John Doe',
      age: -5,
      occupation: 'Engineer'
    };
    
    expect(() => PersonSchema.parse(invalidPerson)).toThrow();
  });
  
  it('handles optional fields', () => {
    const minimalPerson = {
      name: 'Jane Doe',
      age: 25,
      occupation: 'Designer'
    };
    
    const result = PersonSchema.parse(minimalPerson);
    expect(result.name).toBe('Jane Doe');
  });
});
```

### Model Response Testing

```typescript
// Test actual model responses against schema
async function testSchemaWithModel(schema: z.ZodSchema, testPrompts: string[]) {
  const model = { name: 'gemini-2.0-flash', provider: 'google' };
  const runner = new BaseModelRunner();
  
  for (const prompt of testPrompts) {
    const conversation = new Interaction(model, 'Extract structured data');
    conversation.addMessage({ role: 'user', content: prompt });
    
    try {
      const response = await runner.streamObject(conversation, schema);
      console.log(`✓ Schema validation passed for: ${prompt.substring(0, 50)}...`);
      
      // Validate the structure
      const parsed = schema.parse(response.structuredOutput);
      console.log('Extracted data:', parsed);
      
    } catch (error) {
      console.error(`✗ Schema validation failed for: ${prompt.substring(0, 50)}...`);
      console.error(error.message);
    }
  }
}

// Test with various prompts
const testPrompts = [
  'John Smith is a 35-year-old software engineer',
  'Maria Garcia, age 28, works as a graphic designer',
  'Dr. Chen, a 45-year-old professor of computer science'
];

await testSchemaWithModel(PersonSchema, testPrompts);
```

## Best Practices

### Schema Design

1. **Start Simple**: Begin with basic fields, add complexity incrementally
2. **Clear Descriptions**: Provide helpful descriptions for each field
3. **Appropriate Types**: Use enums for limited options, numbers for quantities
4. **Validation Logic**: Add appropriate constraints (min/max, format validation)
5. **Optional Fields**: Make fields optional when they might not be available

### Development Workflow

```typescript
// 1. Start with DSL for rapid prototyping
const quickSchema = "name, age int, category";

// 2. Convert to basic Zod schema
const basicSchema = z.object({
  name: z.string(),
  age: z.number().int(),
  category: z.string()
});

// 3. Add validation and refinement
const refinedSchema = z.object({
  name: z.string().min(1).max(100),
  age: z.number().int().min(0).max(120),
  category: z.enum(['student', 'professional', 'retired'])
});

// 4. Add complex validation logic
const finalSchema = refinedSchema.extend({
  verified: z.boolean().default(false),
  verification_date: z.string().optional()
}).refine(
  (data) => !data.verified || data.verification_date,
  {
    message: "Verification date required when verified is true",
    path: ["verification_date"]
  }
);
```

### Error Recovery

```typescript
// Graceful degradation with union types
const FlexibleExtractionSchema = z.union([
  // Preferred: Complete structured data
  z.object({
    success: z.literal(true),
    data: CompleteSchema
  }),
  
  // Fallback: Partial data with error info
  z.object({
    success: z.literal(false),
    partial_data: CompleteSchema.partial(),
    error_reason: z.string(),
    missing_fields: z.array(z.string())
  })
]);
```

## Next Steps

- See [Evaluation Framework](/api/evaluation-framework) for using schemas in evaluations
- Check [Core Classes](/api/core-classes) for detailed API usage
- Explore [Model Integration](/api/model-integration) for provider-specific schema considerations