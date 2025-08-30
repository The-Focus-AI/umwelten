# Structured Output

Learn how to define and validate structured output formats for consistent model responses using DSL, JSON Schema, Zod files, or built-in templates.

## Overview

Structured output validation ensures consistent data extraction across different models. Umwelten supports multiple schema formats and provides automatic validation, type coercion, and detailed error reporting.

## Schema Types

### 1. Simple DSL Schema

Quick and easy schema definition:

```bash
umwelten eval run \
  --prompt "Extract person information from this text: Henry is 38 years old and lives in Phoenix" \
  --models "ollama:gemma3:12b" \
  --id "person-extraction" \
  --schema "name, age int, location"
```

### 2. Built-in Templates

Pre-defined schemas for common use cases:

```bash
umwelten eval run \
  --prompt "Extract contact information from this text: Irene works at DataCorp, her email is irene@datacorp.com and phone is 555-9876" \
  --models "ollama:gemma3:12b" \
  --id "contact-extraction" \
  --schema-template contact
```

### 3. JSON Schema Files

Standard JSON Schema format:

```bash
umwelten eval run \
  --prompt "Analyze the financial data and extract key metrics" \
  --models "google:gemini-2.0-flash" \
  --id "financial-analysis" \
  --schema-file "./schemas/financial_metrics.json"
```

### 4. TypeScript Zod Schemas

Complex validation with TypeScript support:

```bash
umwelten eval run \
  --prompt "Process the order data and validate structure" \
  --models "openrouter:openai/gpt-4o" \
  --id "order-processing" \
  --zod-schema "./schemas/order-schema.ts"
```

## DSL Schema Syntax

### Basic Fields
```bash
# String fields (default type)
"name, email, location"

# Typed fields
"name, age int, active bool, tags array"

# With descriptions
"name: full name, age int: person's age, email: email address"

# Complex example
"startLocation, endLocation, startDate, totalDays int: number of days, withKids bool: traveling with children"
```

### Supported Types
- `string` (default)
- `int` / `integer`
- `number` / `float`
- `bool` / `boolean`
- `array`
- `date`

## Built-in Templates

### Available Templates
- `person`: Basic person information (name, age, email, location)
- `contact`: Contact details (name, email, phone, company)
- `event`: Event information (name, date, time, location, description)

### Using Templates
```bash
# Person extraction
umwelten eval run \
  --prompt "Extract person details from this bio" \
  --models "google:gemini-2.0-flash" \
  --schema-template person

# Event extraction
umwelten eval run \
  --prompt "Extract event details from this announcement" \
  --models "google:gemini-2.0-flash" \
  --schema-template event
```

## Zod Schema Example

Create a TypeScript file with Zod schema:

```typescript
// schemas/image-features.ts
import { z } from 'zod';

export const ImageFeatureSchema = z.object({
  able_to_parse: z.object({
    value: z.boolean(),
    confidence: z.number().min(0).max(1),
  }),
  image_description: z.object({
    value: z.string(),
    confidence: z.number().min(0).max(1),
  }),
  color_palette: z.object({
    value: z.enum(["warm", "cool", "monochrome", "vibrant", "neutral"]),
    confidence: z.number().min(0).max(1),
  }),
});
```

Use with Umwelten:

```bash
umwelten eval run \
  --prompt "Analyze this image and extract structured features" \
  --models "google:gemini-2.0-flash" \
  --id "image-structured" \
  --attach "./image.jpg" \
  --zod-schema "./schemas/image-features.ts" \
  --validate-output
```

## Validation Options

### Schema Options
- `--schema <dsl>`: Simple DSL format
- `--schema-template <name>`: Built-in templates
- `--schema-file <path>`: JSON Schema file
- `--zod-schema <path>`: TypeScript Zod schema file

### Validation Options
- `--validate-output`: Enable output validation (default: true with schemas)
- `--coerce-types`: Attempt to coerce data types (string numbers → numbers)
- `--strict-validation`: Fail evaluation on validation errors

## Example Outputs

### DSL Schema Output
```json
{
  "name": "Henry",
  "age": 38,
  "location": "Phoenix"
}
```

### Template Schema Output
```json
{
  "name": "Irene",
  "email": "irene@datacorp.com", 
  "phone": "555-9876",
  "company": "DataCorp"
}
```

### Complex Zod Schema Output
```json
{
  "able_to_parse": {
    "value": true,
    "confidence": 0.95
  },
  "image_description": {
    "value": "A vibrant outdoor scene with people in a park",
    "confidence": 0.92
  },
  "color_palette": {
    "value": "vibrant",
    "confidence": 0.87
  }
}
```

## Validation Features

### Automatic Validation
- **Type Checking**: Ensures correct data types
- **Range Validation**: Numbers within specified ranges
- **Enum Validation**: Values from predefined lists
- **Required Fields**: Ensures all required fields are present
- **Format Validation**: Dates, emails, URLs, etc.

### Error Handling
- **Detailed Error Messages**: Specific validation failures
- **Type Coercion**: Automatic conversion when possible
- **Graceful Degradation**: Fallback to prompt-based validation
- **Retry Logic**: Automatic retries for validation failures

## Best Practices

### Schema Design
- Start with simple DSL schemas for basic extraction
- Use built-in templates for common data structures  
- Progress to Zod schemas for complex validation needs
- Include confidence scores for quality assessment

### Prompt Engineering
- Be explicit about the expected output format
- Include examples of valid responses when helpful
- Mention specific field requirements and constraints
- Request structured JSON format explicitly

### Model Selection
- **Google Gemini**: Excellent structured output support
- **OpenRouter GPT-4**: Best for complex schema adherence
- **Ollama Models**: Good for simple structured output
- **Multiple Models**: Use for validation and comparison

### Error Prevention
- Test schemas with simple examples first
- Use `--coerce-types` for lenient type conversion
- Set appropriate `--timeout` for complex extractions
- Enable `--validate-output` for immediate feedback

## Troubleshooting

### Common Issues

1. **JSON Parsing Errors**
   ```bash
   # Solution: Enable type coercion
   --coerce-types
   ```

2. **Schema Validation Failures**
   ```bash
   # Solution: Use lenient validation
   --strict-validation false
   ```

3. **Timeout with Complex Schemas**
   ```bash
   # Solution: Increase timeout
   --timeout 45000
   ```

4. **Missing Required Fields**
   ```bash
   # Solution: Be more explicit in prompt
   --prompt "Extract ALL required fields: name, age, location. If unknown, use null."
   ```

## Advanced Patterns

### Multi-step Validation
```bash
# First: Extract with simple schema
umwelten eval run \
  --schema "title, summary, category" \
  --id "initial-extract"

# Second: Validate with complex schema
umwelten eval run \
  --zod-schema "./complex-schema.ts" \
  --id "detailed-validation"
```

### Confidence-based Filtering
```bash
# Extract with confidence scores
umwelten eval run \
  --prompt "Only include fields you're confident about (>0.8)" \
  --zod-schema "./confidence-schema.ts" \
  --strict-validation
```

### Batch Structured Processing
```bash
# Process multiple documents with same schema
umwelten eval batch \
  --prompt "Extract structured data from this document" \
  --models "google:gemini-2.0-flash" \
  --directory "./documents" \
  --schema "title, date, category, summary" \
  --concurrent
```

## Streaming Patterns

Umwelten supports real-time streaming for structured output, providing immediate feedback as models generate responses.

### Real-Time Object Streaming

For interactive applications that need immediate partial results:

```typescript
import { BaseModelRunner } from '../src/cognition/runner.js';
import { Interaction } from '../src/interaction/interaction.js';
import { z } from 'zod';

const schema = z.object({
  name: z.string(),
  age: z.number(),
  location: z.string(),
});

const runner = new BaseModelRunner();
const interaction = new Interaction(modelDetails, systemPrompt);
interaction.setOutputFormat(schema);

// Real-time streaming with partial object updates
const result = await runner.streamObject(interaction, schema);
console.log('Streamed result:', result.content);
```

### Usage Patterns

#### 1. For Immediate Results
```typescript
// Use generateObject for immediate structured results
const result = await runner.generateObject(interaction, schema);
const data = JSON.parse(result.content);
// data is immediately available
```

#### 2. For Real-Time Streaming
```typescript
// Use streamObject for real-time partial updates
const result = await runner.streamObject(interaction, schema);
const data = JSON.parse(result.content);
// data is built from partial object stream
```

#### 3. For Flexible JSON
```typescript
// Use generateText + JSON parsing for dynamic schemas
const result = await runner.generateText(interaction);
const jsonMatch = result.content.match(/\{.*\}/s);
const data = JSON.parse(jsonMatch[0]);
```

#### 4. For Text Streaming
```typescript
// Use streamText for real-time text chunks
const result = await runner.streamText(interaction);
// Process text chunks as they arrive
```

### Streaming Best Practices

- **Use `streamObject` for interactive applications** that need real-time feedback
- **Use `generateObject` for immediate results** when you need the complete object
- **Use `streamText` for text-based streaming** when you need raw text chunks
- **Use `generateText` + JSON parsing** for flexible schema handling

### Performance Considerations

- **Google Gemini**: ~600ms for streamObject
- **Ollama (gemma3:12b)**: ~500ms for streamObject
- **Both providers**: Real-time streaming works without hanging
- **No timeout issues** with proper implementation

## Examples

For comprehensive structured output examples, see:
- [Structured Image Features](/examples/image-features) - Complex Zod schemas with confidence scores
- [PDF Analysis](/examples/pdf-analysis) - Document data extraction
- [Text Generation](/examples/text-generation) - Simple structured responses

## Next Steps

- Try [batch processing](/guide/batch-processing) with structured output
- Explore [image analysis](/examples/image-features) for vision + structure
- Learn [cost optimization](/guide/cost-analysis) for efficient structured processing
- Read the [Cognition Module API](/api/cognition) for advanced streaming patterns