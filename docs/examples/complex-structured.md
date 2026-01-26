# Complex Structured Output

Extract sophisticated data structures with nested objects, arrays, and complex validation rules. This example demonstrates advanced schema design and validation for complex data extraction tasks.

## Overview

Complex structured output goes beyond simple field extraction to handle nested relationships, conditional logic, and sophisticated data validation. This is essential for extracting rich data from documents, building knowledge graphs, and creating detailed analytical frameworks.

## Advanced Schema Design

### Nested Object Structures

Extract hierarchical data with nested objects:

```bash
npx umwelten eval run \
  --prompt "Analyze this research paper and extract detailed structured information" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --file "./research-paper.pdf" \
  --schema "title, authors array: {name, affiliation, email?}, abstract, methodology: {approach, data_sources array, sample_size int?}, findings array: {finding, significance int: 1-5, evidence}, conclusions array" \
  --id "complex-research-extraction"
```

### Conditional Field Structures

Use complex Zod schemas for conditional validation:

```typescript
// schemas/document-analysis.ts
import { z } from 'zod';

const DocumentAnalysis = z.object({
  document_type: z.enum(['contract', 'report', 'article', 'manual']),
  title: z.string(),
  content: z.discriminatedUnion('document_type', [
    z.object({
      document_type: z.literal('contract'),
      parties: z.array(z.object({
        name: z.string(),
        role: z.enum(['buyer', 'seller', 'vendor', 'client']),
        contact_info: z.object({
          email: z.string().email().optional(),
          phone: z.string().optional()
        }).optional()
      })),
      terms: z.array(z.object({
        category: z.string(),
        description: z.string(),
        enforceable: z.boolean()
      })),
      value: z.object({
        amount: z.number().optional(),
        currency: z.string().optional()
      }).optional()
    }),
    z.object({
      document_type: z.literal('report'),
      sections: z.array(z.object({
        heading: z.string(),
        content_summary: z.string(),
        key_metrics: z.array(z.object({
          metric: z.string(),
          value: z.union([z.string(), z.number()]),
          unit: z.string().optional()
        })).optional()
      })),
      executive_summary: z.string(),
      recommendations: z.array(z.string()).optional()
    })
  ]),
  metadata: z.object({
    page_count: z.number(),
    creation_date: z.string().optional(),
    language: z.string(),
    confidence_score: z.number().min(1).max(10)
  })
});
```

```bash
npx umwelten eval batch \
  --prompt "Extract detailed structured data from this document based on its type" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "complex-document-analysis" \
  --directory "./mixed-documents" \
  --file-pattern "*.pdf" \
  --zod-schema "./schemas/document-analysis.ts" \
  --concurrent
```

## Multi-Level Data Extraction

### Hierarchical Content Analysis

```bash
npx umwelten eval run \
  --prompt "Extract comprehensive hierarchical structure from this document" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --file "./technical-manual.pdf" \
  --schema "document_info: {title, version, date}, structure: {chapters array: {title, page_start int, subsections array: {title, content_type, key_points array}}}, cross_references array: {from_section, to_section, reference_type}, appendices array: {title, content_type, page_count int}" \
  --id "hierarchical-extraction"
```

### Complex Relationship Mapping

```bash
npx umwelten eval batch \
  --prompt "Map complex relationships and dependencies in this content" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "relationship-mapping" \
  --directory "./organizational-docs" \
  --file-pattern "*.pdf" \
  --schema "entities array: {name, type, description}, relationships array: {source_entity, target_entity, relationship_type, strength int: 1-5, bidirectional bool}, network_metrics: {total_connections int, hub_entities array, isolated_entities array}" \
  --concurrent
```

## Advanced Validation Rules

### Custom Validation Logic

```typescript
// schemas/financial-analysis.ts
import { z } from 'zod';

const FinancialAnalysis = z.object({
  company: z.string(),
  reporting_period: z.object({
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    period_type: z.enum(['quarterly', 'annual', 'monthly'])
  }),
  financial_statements: z.object({
    revenue: z.object({
      total: z.number().positive(),
      breakdown: z.array(z.object({
        category: z.string(),
        amount: z.number().positive(),
        percentage: z.number().min(0).max(100)
      }))
    }).refine(data => 
      Math.abs(data.breakdown.reduce((sum, item) => sum + item.amount, 0) - data.total) < 0.01,
      "Breakdown amounts must sum to total"
    ),
    expenses: z.object({
      operating: z.number().positive(),
      non_operating: z.number().nonnegative(),
      breakdown: z.array(z.object({
        category: z.string(),
        amount: z.number().positive(),
        recurring: z.boolean()
      }))
    }),
    profitability: z.object({
      gross_profit: z.number(),
      net_profit: z.number(),
      margins: z.object({
        gross_margin: z.number().min(0).max(100),
        net_margin: z.number().min(-100).max(100)
      })
    })
  }),
  ratios: z.object({
    liquidity: z.array(z.object({
      name: z.string(),
      value: z.number(),
      benchmark: z.number().optional(),
      interpretation: z.enum(['excellent', 'good', 'acceptable', 'concerning', 'critical'])
    })),
    profitability: z.array(z.object({
      name: z.string(),
      value: z.number(),
      trend: z.enum(['improving', 'stable', 'declining'])
    }))
  }),
  analysis: z.object({
    strengths: z.array(z.string()).min(1),
    weaknesses: z.array(z.string()),
    opportunities: z.array(z.string()),
    threats: z.array(z.string()),
    overall_health: z.enum(['strong', 'healthy', 'stable', 'concerning', 'critical']),
    confidence: z.number().min(1).max(10)
  })
});
```

```bash
npx umwelten eval batch \
  --prompt "Perform comprehensive financial analysis with detailed validation" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "financial-analysis" \
  --directory "./financial-reports" \
  --file-pattern "*.pdf" \
  --zod-schema "./schemas/financial-analysis.ts" \
  --validate-output \
  --concurrent
```

## Real-World Complex Structures

### Legal Document Analysis

```typescript
// schemas/legal-contract.ts
const LegalContract = z.object({
  contract_info: z.object({
    title: z.string(),
    contract_type: z.enum(['service', 'employment', 'license', 'partnership', 'nda']),
    jurisdiction: z.string(),
    governing_law: z.string(),
    effective_date: z.string().optional(),
    expiration_date: z.string().optional(),
    auto_renewal: z.boolean().optional()
  }),
  parties: z.array(z.object({
    name: z.string(),
    entity_type: z.enum(['individual', 'corporation', 'llc', 'partnership', 'government']),
    role: z.enum(['contractor', 'client', 'employer', 'employee', 'licensor', 'licensee']),
    address: z.object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      country: z.string(),
      postal_code: z.string().optional()
    }).optional(),
    representatives: z.array(z.object({
      name: z.string(),
      title: z.string(),
      contact: z.string().optional()
    })).optional()
  })).min(2),
  obligations: z.array(z.object({
    party: z.string(),
    category: z.enum(['payment', 'performance', 'compliance', 'confidentiality', 'termination']),
    description: z.string(),
    deadline: z.string().optional(),
    penalty: z.object({
      type: z.enum(['monetary', 'termination', 'specific_performance', 'other']),
      amount: z.number().optional(),
      description: z.string().optional()
    }).optional(),
    enforceability: z.enum(['high', 'medium', 'low', 'unclear'])
  })),
  financial_terms: z.object({
    total_value: z.object({
      amount: z.number().optional(),
      currency: z.string().optional(),
      basis: z.enum(['fixed', 'hourly', 'milestone', 'percentage', 'other']).optional()
    }).optional(),
    payment_schedule: z.array(z.object({
      description: z.string(),
      amount: z.number().optional(),
      due_date: z.string().optional(),
      conditions: z.array(z.string()).optional()
    })).optional()
  }).optional(),
  risk_factors: z.array(z.object({
    category: z.enum(['financial', 'legal', 'operational', 'reputational', 'technical']),
    description: z.string(),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    mitigation: z.string().optional()
  })),
  analysis_confidence: z.number().min(1).max(10)
});
```

```bash
npx umwelten eval batch \
  --prompt "Extract comprehensive legal structure and analyze contract terms" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "legal-contract-analysis" \
  --directory "./contracts" \
  --file-pattern "*.pdf" \
  --zod-schema "./schemas/legal-contract.ts" \
  --timeout 120000 \
  --concurrent
```

### Scientific Paper Analysis

```bash
npx umwelten eval batch \
  --prompt "Extract detailed scientific methodology and findings with statistical validation" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "scientific-analysis" \
  --directory "./research-papers" \
  --file-pattern "*.pdf" \
  --schema "paper_info: {title, authors array: {name, affiliation, corresponding bool}, journal, doi?, publication_date}, methodology: {study_type, participants: {total int, demographics: {age_range?, gender_distribution?, inclusion_criteria array}}, methods array: {method_name, description, validation_status}, data_collection: {duration, instruments array, sample_size_justification}}, results: {primary_outcomes array: {outcome, measurement, statistical_test, p_value?, confidence_interval?, effect_size?}, secondary_outcomes array, statistical_power?, limitations array}, discussion: {key_findings array, implications array, future_research array}, quality_assessment: {methodology_rigor int: 1-10, statistical_validity int: 1-10, reproducibility int: 1-10}" \
  --concurrent
```

## Dynamic Schema Generation

### Context-Aware Structure

```bash
# First pass: Determine document structure
npx umwelten eval run \
  --prompt "Analyze this document and suggest an optimal data extraction schema based on its content and structure" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --file "./unknown-document.pdf" \
  --schema "document_type, suggested_schema: {fields array: {name, type, required bool, description}, nested_structures array: {name, fields array}}, extraction_complexity int: 1-10" \
  --id "schema-analysis"

# Second pass: Apply suggested schema
npx umwelten eval run \
  --prompt "Extract data using the previously suggested schema structure" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --file "./unknown-document.pdf" \
  --schema "title, content: {[dynamic fields based on first analysis]}, metadata: {confidence int: 1-10, completeness int: 1-10}" \
  --id "dynamic-extraction"
```

## Complex Aggregation and Analysis

### Cross-Document Relationship Analysis

```bash
npx umwelten eval batch \
  --prompt "Extract entities and relationships that can be connected across documents" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "cross-doc-analysis" \
  --directory "./document-collection" \
  --file-pattern "*.pdf" \
  --schema "document_id, entities array: {name, type, attributes: {key_value_pairs object}, confidence int: 1-10}, relationships array: {entity1, entity2, relationship_type, strength int: 1-5, context}, temporal_markers array: {event, date, precision}, references array: {target_document?, target_entity?, reference_type}" \
  --concurrent
```

### Multi-Dimensional Analysis

```bash
npx umwelten eval batch \
  --prompt "Perform multi-dimensional analysis considering temporal, spatial, and categorical dimensions" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "multidim-analysis" \
  --directory "./complex-data" \
  --file-pattern "*.{pdf,jpg}" \
  --schema "temporal: {events array: {event, timestamp, duration?, recurrence?}, trends array: {dimension, direction, confidence int: 1-10}}, spatial: {locations array: {name, coordinates?, region, relevance int: 1-5}, geographic_scope}, categorical: {categories array: {name, subcategories array, examples array}, taxonomies array: {name, hierarchy array}}, correlations array: {dimension1, dimension2, correlation_strength int: 1-10, statistical_significance?}" \
  --concurrent
```

## Validation and Quality Control

### Complex Validation Rules

```bash
npx umwelten eval batch \
  --prompt "Extract data with comprehensive validation and cross-field checking" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "validated-extraction" \
  --directory "./data-sources" \
  --file-pattern "*.pdf" \
  --schema "data: {primary_fields: {field1, field2, field3}, calculated_fields: {derived1, derived2}, validation_checks: {consistency_score int: 1-10, completeness_score int: 1-10, anomalies array}}, quality_metrics: {source_reliability int: 1-5, data_freshness, extraction_confidence int: 1-10}, warnings array, errors array" \
  --validate-output \
  --concurrent
```

### Iterative Refinement

```bash
# First extraction with basic schema
npx umwelten eval run \
  --prompt "Perform initial data extraction" \
  --models "google:gemini-2.0-flash" \
  --file "./complex-document.pdf" \
  --schema "basic_info: {title, type, summary}, extracted_data: {key_points array, entities array}, confidence int: 1-10" \
  --id "initial-extraction"

# Refinement pass with enhanced schema
npx umwelten eval run \
  --prompt "Refine the previous extraction with more detailed analysis" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --file "./complex-document.pdf" \
  --schema "enhanced_info: {detailed_title, document_hierarchy, executive_summary}, refined_data: {categorized_points: {category, points array, importance int: 1-5}, entity_relationships array: {entity1, entity2, relationship, context}, semantic_themes array}, validation: {consistency_with_initial bool, improvements array, confidence int: 1-10}" \
  --id "refined-extraction"
```

## Performance Optimization for Complex Schemas

### Processing Strategy

```bash
# Use premium models for complex extraction
npx umwelten eval batch \
  --prompt "Extract complex nested data structures with high accuracy" \
  --models "google:gemini-2.5-pro-exp-03-25,openrouter:openai/gpt-4o" \
  --id "premium-complex-extraction" \
  --directory "./complex-documents" \
  --file-pattern "*.pdf" \
  --zod-schema "./schemas/complex-schema.ts" \
  --timeout 180000 \
  --concurrent \
  --max-concurrency 1
```

### Memory and Resource Management

```bash
# Process large complex documents with resource management
npx umwelten eval batch \
  --prompt "Extract complex data while managing memory efficiently" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "resource-managed-extraction" \
  --directory "./large-documents" \
  --file-pattern "*.pdf" \
  --file-limit 10 \
  --timeout 240000 \
  --concurrent \
  --max-concurrency 1
```

## Output Analysis and Visualization

### Complex Data Analysis

```bash
# Generate comprehensive analysis reports
npx umwelten eval report --id complex-document-analysis --format json > complex-results.json

# Analyze nested structure completeness
jq '.results[] | {
  file: .file,
  complexity: .response.metadata.confidence_score,
  nested_count: (.response.content | if type == "object" then keys else [] end | length),
  validation_score: .response.validation_checks.consistency_score
}' complex-results.json
```

### Cross-Document Pattern Analysis

```bash
# Find patterns across complex extractions
npx umwelten eval report --id cross-doc-analysis --format json | jq '
  [.results[].response.entities[]] |
  group_by(.type) |
  map({
    entity_type: .[0].type,
    count: length,
    avg_confidence: (map(.confidence) | add / length)
  }) |
  sort_by(.count) |
  reverse
'
```

## Best Practices

### Schema Design
- **Start Simple**: Begin with basic schema and add complexity iteratively
- **Validate Early**: Test schema with sample documents before batch processing
- **Document Structure**: Clearly document complex schema relationships
- **Version Control**: Keep schema versions tracked and documented

### Processing Strategy
- **Model Selection**: Use premium models for complex structured extraction
- **Timeout Planning**: Allow generous timeouts for complex processing
- **Incremental Approach**: Break complex schemas into smaller, testable components
- **Quality Gates**: Implement validation at multiple levels

### Quality Assurance
- **Cross-Validation**: Use multiple models to validate complex extractions
- **Human Review**: Have domain experts review complex structured outputs
- **Statistical Validation**: Check data consistency and logical relationships
- **Iterative Improvement**: Refine schemas based on output quality

## Troubleshooting

### Common Issues

1. **Schema Complexity**: Overly complex schemas may reduce extraction quality
2. **Validation Failures**: Strict validation may reject partially correct data
3. **Performance Issues**: Complex extraction significantly increases processing time
4. **Memory Usage**: Large nested structures can consume significant memory

### Debug Strategies

```bash
# Test schema components individually
npx umwelten run --models "google:gemini-2.5-pro-exp-03-25" --schema "simple_version: {title, summary}" --file "./test.pdf"

# Validate schema syntax
node -e "const schema = require('./schemas/complex-schema.ts'); console.log('Schema valid');"

# Check extraction time and resource usage
time npx umwelten eval run --models "google:gemini-2.5-pro-exp-03-25" --zod-schema "./schemas/complex.ts" --file "./test.pdf"
```

## Next Steps

- Explore [model evaluation](/guide/model-evaluation) for optimizing complex extraction quality
- Try [batch processing](/guide/batch-processing) for scaling complex structured extraction
- See [cost analysis](/guide/cost-analysis) for managing costs with premium models
- Learn about [structured output validation](/guide/structured-output) for schema optimization