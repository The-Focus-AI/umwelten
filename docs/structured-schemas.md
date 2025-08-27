# Structured Output Schemas

Umwelten provides comprehensive support for structured output validation through multiple schema formats. This enables consistent data extraction and validation across different AI models.

## Quick Start

```bash
# Simple DSL schema
umwelten eval run \
  --prompt "Extract: John Smith, age 25, john@email.com" \
  --models "google:gemini-2.0-flash" \
  --id "simple-extraction" \
  --schema "name, age int, email"

# Built-in template
umwelten eval run \
  --prompt "Extract person info from resume" \
  --models "openrouter:openai/gpt-4o-mini" \
  --id "resume-parsing" \
  --schema-template person
```

## Schema Formats

### 1. DSL (Domain Specific Language)

The simplest way to define schemas using a comma-separated format.

#### Basic Syntax

```bash
# Field names only (defaults to string type)
"name, email, location"

# Typed fields  
"name, age int, active bool, tags array, metadata object"

# With descriptions
"name: full name, age int: person's age, email: email address"

# Complex example
"startLocation, endLocation, startDate, totalDays int: number of days, withKids bool: traveling with children, attractions array: list of attractions"
```

#### Supported Types

| DSL Type | Description | Aliases |
|----------|-------------|---------|
| `string` | Text values | `str`, `text` (default) |
| `int` | Numbers | `integer`, `number`, `num` |
| `bool` | Boolean values | `boolean` |
| `array` | Arrays/lists | `list` |
| `object` | Nested objects | `obj` |

#### DSL Examples

```bash
# Person extraction
--schema "name, age int: age in years, email: email address, phone: phone number, skills array: list of skills"

# Event information
--schema "eventName: name of event, date, time, location, attendees int: number of attendees, isPaid bool: is it a paid event"

# Product data
--schema "title, price num: price in dollars, category, inStock bool, tags array, description: product description"

# Financial metrics
--schema "revenue num: total revenue, profit num, expenses num, quarter int, year int, growth num: growth percentage"
```

### 2. Built-in Templates

Pre-defined schemas for common use cases.

```bash
# Available templates
umwelten eval templates list

# Use a template
--schema-template person
--schema-template contact  
--schema-template event
```

#### Person Template
```json
{
  "name": "full name of the person",
  "age": "age in years", 
  "email": "email address",
  "location": "current location or city"
}
```

#### Contact Template
```json
{
  "name": "contact name",
  "email": "email address", 
  "phone": "phone number",
  "company": "company name"
}
```

#### Event Template
```json
{
  "name": "event name",
  "date": "event date in YYYY-MM-DD format",
  "time": "event time in HH:MM format", 
  "location": "event location",
  "description": "event description"
}
```

### 3. JSON Schema Files

Standard JSON Schema format for complex validations.

```bash
--schema-file ./schemas/user.json
```

**Example JSON Schema (`schemas/user.json`):**
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "User's full name"
    },
    "age": {
      "type": "number",
      "minimum": 0,
      "maximum": 150,
      "description": "Age in years"
    },
    "email": {
      "type": "string",
      "format": "email",
      "description": "Valid email address"
    },
    "preferences": {
      "type": "object", 
      "properties": {
        "theme": {
          "type": "string",
          "enum": ["light", "dark", "auto"]
        },
        "notifications": {
          "type": "boolean"
        }
      }
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "User tags"
    }
  },
  "required": ["name", "email"],
  "additionalProperties": false
}
```

### 4. Zod Schema Files

TypeScript Zod schemas for type-safe validation with rich features.

```bash
--zod-schema ./schemas/order-schema.ts
```

**Example Zod Schema (`schemas/order-schema.ts`):**
```typescript
import { z } from 'zod';

export const schema = z.object({
  orderId: z.string().describe('Unique order identifier'),
  customerName: z.string().describe('Customer full name'),
  email: z.string().email().describe('Customer email'),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().int().positive(),
      price: z.number().positive().describe('Price per item')
    })
  ).describe('Order items'),
  total: z.number().positive().describe('Total order amount'),
  status: z.enum(['pending', 'processing', 'shipped', 'delivered']),
  shippingAddress: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string(),
    zipCode: z.string(),
    country: z.string().default('US')
  }),
  isGift: z.boolean().optional(),
  notes: z.string().optional()
});

export default schema;
```

**Advanced Zod Features:**
```typescript
import { z } from 'zod';

export const Schema = z.object({
  // String validations
  name: z.string().min(1).max(100).describe('Full name'),
  email: z.string().email(),
  
  // Number validations  
  age: z.number().int().min(0).max(150),
  salary: z.number().positive().optional(),
  
  // Enums and literals
  role: z.enum(['admin', 'user', 'guest']),
  plan: z.literal('premium').or(z.literal('basic')),
  
  // Arrays with validation
  skills: z.array(z.string()).min(1).max(10),
  scores: z.array(z.number().min(0).max(100)),
  
  // Optional and default values
  isActive: z.boolean().default(true),
  lastLogin: z.string().optional(),
  
  // Nested objects
  address: z.object({
    street: z.string(),
    city: z.string(),
    coordinates: z.object({
      lat: z.number(),
      lng: z.number()
    }).optional()
  }),
  
  // Dates and transformations
  createdAt: z.string().datetime(),
  updatedAt: z.coerce.date()
});
```

## Validation Options

Control how schema validation works:

```bash
# Enable validation (default: true when schema is provided)
--validate-output

# Disable validation 
--no-validate-output

# Coerce string numbers to numbers, string booleans to booleans, etc.
--coerce-types

# Fail evaluation if validation errors occur
--strict-validation

# Allow extra fields not defined in schema (default: warnings only)
--allow-extra-fields
```

## Schema Validation Examples

### Basic Person Extraction

```bash
umwelten eval run \
  --prompt "Extract person data: Sarah Johnson is 28 years old, works at Google, email sarah.johnson@gmail.com" \
  --models "google:gemini-2.0-flash" \
  --id "person-basic" \
  --schema "name, age int, company, email"
```

**Expected Output:**
```json
{
  "name": "Sarah Johnson",
  "age": 28, 
  "company": "Google",
  "email": "sarah.johnson@gmail.com"
}
```

### Complex Data Extraction with Nested Objects

```bash
umwelten eval run \
  --prompt "Analyze this business card image and extract all contact information" \
  --models "google:gemini-2.0-flash" \
  --id "business-card" \
  --attach "./business_card.jpg" \
  --zod-schema "./schemas/business-contact.ts"
```

**Zod Schema (`business-contact.ts`):**
```typescript
import { z } from 'zod';

export const schema = z.object({
  name: z.string().describe('Full name on business card'),
  title: z.string().describe('Job title'),
  company: z.string().describe('Company name'),
  contact: z.object({
    email: z.string().email().optional(),
    phone: z.string().optional(),
    mobile: z.string().optional(),
    website: z.string().url().optional()
  }),
  address: z.object({
    street: z.string(),
    city: z.string(), 
    state: z.string(),
    zipCode: z.string(),
    country: z.string()
  }).optional(),
  socialMedia: z.object({
    linkedin: z.string().url().optional(),
    twitter: z.string().optional()
  }).optional()
});
```

### Financial Data Analysis

```bash
umwelten eval run \
  --prompt "Extract key financial metrics from this quarterly report" \
  --models "openrouter:openai/gpt-4o" \
  --id "financial-analysis" \
  --attach "./q3-report.pdf" \
  --schema "quarter int, year int, revenue num: total revenue in millions, netIncome num: net income in millions, eps num: earnings per share, growth num: revenue growth percentage, segments array: business segments"
```

### Survey Response Analysis

```bash
umwelten eval run \
  --prompt "Analyze survey responses and extract sentiment and key themes" \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o-mini" \
  --id "survey-analysis" \
  --schema "overallSentiment: overall sentiment (positive/negative/neutral), satisfaction int: satisfaction score 1-10, keyThemes array: main themes mentioned, improvementAreas array: suggested improvements, responseCount int: number of responses analyzed"
```

## Validation Results

Schema validation provides detailed feedback:

### Successful Validation
```json
{
  "success": true,
  "data": {
    "name": "John Smith",
    "age": 25,
    "email": "john@example.com"
  }
}
```

### Validation Errors
```json
{
  "success": false,
  "errors": [
    "Missing required field: email",
    "Field age must be a number, got string",
    "Field status must be one of: active, inactive, pending, got \"unknown\""
  ],
  "warnings": [
    "Unexpected field: middleName"
  ]
}
```

### Type Coercion Results
```json
// Input: {"name": "John", "age": "25", "active": "true"}
// After coercion:
{
  "success": true,
  "data": {
    "name": "John",
    "age": 25,        // String "25" → Number 25
    "active": true    // String "true" → Boolean true
  }
}
```

## Evaluation Reports with Schema Validation

Schema evaluations generate enhanced reports with validation metrics:

```bash
umwelten eval report --id person-extraction --format markdown
```

**Enhanced Report Output:**
```markdown
# Evaluation Report: person-extraction

**Generated:** 2025-08-27T18:30:00.000Z  
**Schema Used:** DSL - "name, age int, email"
**Validation Enabled:** Yes

## Validation Summary
- **Total Models:** 2
- **Validation Success Rate:** 100%
- **Models Passed:** 2/2
- **Common Validation Issues:** None

| Model | Response Length | Validation | Tokens | Time | Cost |
|-------|----------------|------------|--------|------|------|
| gemini-2.0-flash | 156 | ✅ Valid | 45/32/77 | 1.2s | $0.0001 |
| gpt-4o-mini | 142 | ✅ Valid | 42/28/70 | 0.9s | $0.0002 |

## Individual Responses

### gemini-2.0-flash (✅ Valid)
**Extracted Data:**
```json
{
  "name": "John Smith",
  "age": 25,
  "email": "john@example.com"
}
```
```

## Advanced Use Cases

### Multi-Step Data Processing

```bash
# Step 1: Extract entities
umwelten eval run \
  --prompt "Extract all people mentioned in this document" \
  --id "entity-extraction-step1" \
  --schema "people array: list of people mentioned" \
  --attach "./document.pdf"

# Step 2: Detailed analysis per person  
umwelten eval run \
  --prompt "For each person extracted, find additional details" \
  --id "entity-analysis-step2" \
  --schema-template person \
  --coerce-types
```

### Schema Evolution and Testing

```bash
# Test different schema versions
umwelten eval run \
  --prompt "Extract product information" \
  --models "google:gemini-2.0-flash" \
  --id "product-v1" \
  --schema "name, price num"

umwelten eval run \
  --prompt "Extract product information" \
  --models "google:gemini-2.0-flash" \
  --id "product-v2" \
  --schema "name, price num, category, inStock bool, rating num"

# Compare schema effectiveness
umwelten eval report --id product-v1 --format json > v1-results.json
umwelten eval report --id product-v2 --format json > v2-results.json
```

### Cross-Model Schema Validation

```bash
# Test schema consistency across different models
umwelten eval run \
  --prompt "Extract structured data from customer feedback" \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o-mini,openrouter:anthropic/claude-3.5-sonnet" \
  --id "feedback-analysis" \
  --schema "customerName, sentiment: positive/negative/neutral, rating int: 1-5 rating, issues array: list of issues mentioned, suggestions array: improvement suggestions" \
  --concurrent
```

## Error Handling and Debugging

### Common Validation Errors

1. **Missing Required Fields**
   ```
   Error: Missing required field: email
   ```
   Solution: Ensure the model extracts all required fields or make fields optional.

2. **Type Mismatches**
   ```
   Error: Field age must be a number, got string
   ```
   Solution: Use `--coerce-types` or improve prompt instructions.

3. **Invalid Enum Values**
   ```
   Error: Field status must be one of: active, inactive, pending, got "unknown"
   ```
   Solution: Update schema enum values or improve model instructions.

### Best Practices

1. **Start Simple**: Begin with basic DSL schemas and evolve to complex Zod schemas
2. **Use Type Coercion**: Enable `--coerce-types` for flexible type handling
3. **Provide Clear Descriptions**: Add field descriptions to guide model output
4. **Test Incrementally**: Start with one model, then scale to multiple models
5. **Handle Edge Cases**: Use optional fields and default values appropriately
6. **Validate Early**: Test schemas with sample data before running evaluations

### Troubleshooting

```bash
# Debug schema loading
umwelten eval run --schema "invalid syntax" --dry-run

# Test with minimal models first
umwelten eval run \
  --prompt "Simple test" \
  --models "google:gemini-2.0-flash" \
  --schema "result" \
  --id "schema-test"

# Check validation details
umwelten eval report --id schema-test --format json | jq '.validationResults'
```

## API Integration

### Programmatic Schema Usage

```typescript
import { SchemaManager, parseDSLSchema } from 'umwelten/schema';

// Create schema manager
const manager = new SchemaManager();

// Load different schema types
const dslSchema = await manager.loadSchema({
  type: 'dsl',
  content: 'name, age int, active bool'
});

const templateSchema = await manager.loadSchema({
  type: 'template', 
  name: 'person'
});

const zodSchema = await manager.loadSchema({
  type: 'zod-file',
  path: './schemas/user.ts'
});

// Validate data
const result = await manager.validateData(
  { name: 'John', age: '25', active: true },
  { type: 'dsl', content: 'name, age int, active bool' },
  { coerce: true }
);

console log(result.success); // true
console.log(result.data.age); // 25 (coerced from string)
```

This comprehensive schema system enables consistent, validated data extraction across different AI models, making umwelten ideal for production data processing workflows.