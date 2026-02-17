# Cost Analysis

Understand and optimize costs when using Umwelten with different AI model providers. Learn how to make informed decisions about model selection, usage patterns, and budget management.

## Overview

Umwelten provides transparent cost tracking and analysis across all supported providers. This helps you:
- Compare costs between different models and providers
- Optimize spending based on quality requirements
- Track expenses for budgeting and analysis
- Make informed decisions about model selection

## Cost Structure by Provider

### Google (Gemini Models)
- **Billing**: Pay per token (input and output tokens priced separately)
- **Pricing Tiers**: Flash models cheaper than Pro models
- **Cost Range**: $0.075-$7.00 per 1M tokens (input), $0.30-$21.00 per 1M tokens (output)

#### Google Model Costs
| Model | Input Cost/1M | Output Cost/1M | Best For |
|-------|---------------|----------------|----------|
| Gemini 2.0 Flash | $0.075 | $0.300 | General use, cost-effective |
| Gemini 1.5 Flash 8B | $0.0375 | $0.15 | Fast, simple tasks |
| Gemini 2.5 Pro | $3.50 | $10.50 | Complex reasoning |

### OpenRouter (Hosted Models)
- **Billing**: Pay per token with provider markup
- **Pricing Varies**: Different costs for different model providers
- **Premium Models**: GPT-4o, Claude models typically more expensive

#### OpenRouter Model Costs
| Model | Input Cost/1M | Output Cost/1M | Best For |
|-------|---------------|----------------|----------|
| GPT-4o-mini | $0.150 | $0.600 | Balanced quality/cost |
| GPT-4o | $2.50 | $10.00 | Highest quality |
| Claude 3.7 Sonnet | $3.00 | $15.00 | Analysis and reasoning |

### Ollama (Local Models)
- **Billing**: Free (no per-token costs)
- **Infrastructure Costs**: Local hardware, electricity, maintenance
- **Setup Required**: Model downloads and local server management

### LM Studio (Local Models)
- **Billing**: Free (no per-token costs)
- **Infrastructure Costs**: Local hardware requirements
- **Flexibility**: Use any compatible local model

## Cost Tracking Commands

### View Model Costs

```bash
# List all models with costs
dotenvx run -- pnpm run cli -- models list

# View detailed cost breakdown
dotenvx run -- pnpm run cli -- models costs

# Sort by cost
dotenvx run -- pnpm run cli -- models costs --sort-by total

# Filter by provider
dotenvx run -- pnpm run cli -- models list --provider google
```

### Evaluation Cost Reports

```bash
# Generate cost report for evaluation
dotenvx run -- pnpm run cli -- eval report --id my-evaluation --format json | jq '.cost'

# Export cost data for analysis
dotenvx run -- pnpm run cli -- eval report --id cost-analysis --format csv --output costs.csv

# View all evaluation costs
dotenvx run -- pnpm run cli -- eval list --details
```

## Cost Optimization Strategies

### 1. Model Tier Selection

Choose the right model tier for your use case:

```bash
# Budget tier (Free)
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Simple question" \
  --models "ollama:gemma3:12b" \
  --id "budget-test"

# Standard tier (Cost-effective)
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Standard analysis" \
  --models "google:gemini-3-flash-preview" \
  --id "standard-test"

# Premium tier (High quality)
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Complex reasoning task" \
  --models "openrouter:openai/gpt-4o" \
  --id "premium-test"
```

### 2. Prompt Optimization

Optimize prompts to reduce token usage:

```bash
# Inefficient: Verbose prompt
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Please provide a very detailed, comprehensive, extensive analysis with multiple examples and thorough explanations..." \
  --models "google:gemini-3-flash-preview" \
  --id "verbose-prompt"

# Efficient: Concise prompt
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Analyze X focusing on key points A, B, C. Include 2 examples. 300 words max." \
  --models "google:gemini-3-flash-preview" \
  --id "concise-prompt"
```

### 3. Response Length Control

Specify desired output length to control costs:

```bash
# Short response (lower cost)
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Summarize quantum computing in 50 words" \
  --models "google:gemini-3-flash-preview" \
  --id "short-response"

# Controlled length response
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Explain machine learning (200-300 words)" \
  --models "google:gemini-3-flash-preview" \
  --id "controlled-response"
```

### 4. Model Cascading

Use cheaper models for initial processing, expensive models for refinement:

```bash
# First pass: Quick screening with cheap model
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Is this document relevant to AI research? (yes/no with brief reason)" \
  --models "google:gemini-3-flash-preview" \
  --id "screening-pass"

# Second pass: Detailed analysis only for relevant documents
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Provide detailed analysis of this AI research document" \
  --models "openrouter:openai/gpt-4o" \
  --id "detailed-analysis"
```

## Cost Comparison Examples

### Simple Task Comparison

```bash
# Compare costs for basic text generation
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Write a 200-word product description for a smart watch" \
  --models "google:gemini-3-flash-preview,openrouter:openai/gpt-4o-mini,openrouter:openai/gpt-4o,ollama:gemma3:12b" \
  --id "product-description-cost" \
  --concurrent

# Generate cost comparison report
dotenvx run -- pnpm run cli -- eval report --id product-description-cost --format markdown
```

### Complex Analysis Comparison

```bash
# Compare costs for detailed analysis
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Analyze the business implications of artificial intelligence in healthcare, including opportunities, challenges, and regulatory considerations" \
  --models "google:gemini-3-flash-preview,google:gemini-2.5-pro-exp-03-25,openrouter:openai/gpt-4o" \
  --id "healthcare-ai-analysis" \
  --concurrent

# Export detailed cost analysis
dotenvx run -- pnpm run cli -- eval report --id healthcare-ai-analysis --format csv --output healthcare-costs.csv
```

### Batch Processing Cost Analysis

```bash
# Process multiple documents and track costs
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Summarize this document in 100 words" \
  --models "google:gemini-3-flash-preview,openrouter:openai/gpt-4o-mini" \
  --id "document-batch-costs" \
  --directory "./documents" \
  --file-pattern "*.pdf" \
  --concurrent \
  --file-limit 20

# Analyze batch processing costs
dotenvx run -- pnpm run cli -- eval report --id document-batch-costs --format json
```

## Budget Management

### Cost Estimation

Before running large evaluations, estimate costs:

```bash
# Test with a small sample first
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Your planned prompt" \
  --models "google:gemini-3-flash-preview" \
  --id "cost-estimate-test"

# Check cost from the test
dotenvx run -- pnpm run cli -- eval report --id cost-estimate-test --format json | jq '.cost'

# Extrapolate: If 1 evaluation costs $0.001, then 1000 evaluations ≈ $1.00
```

### Cost Monitoring

Track spending over time:

```bash
# Export all evaluation costs
for eval_id in $(dotenvx run -- pnpm run cli -- eval list --json | jq -r '.[].id'); do
  dotenvx run -- pnpm run cli -- eval report --id "$eval_id" --format json >> all-costs.jsonl
done

# Analyze total spending
jq '.cost.totalCost' all-costs.jsonl | paste -sd+ | bc
```

### Budget Controls

Implement budget controls in your workflows:

```bash
# Use file limits for testing
dotenvx run -- pnpm run cli -- eval batch \
  --file-limit 10 \
  --models "google:gemini-3-flash-preview" \
  --id "budget-controlled-test"

# Use cheaper models for development
dotenvx run -- pnpm run cli -- eval run \
  --models "ollama:gemma3:12b" \
  --id "development-test"
```

## Real-World Cost Scenarios

### Scenario 1: Content Creation (1000 articles/month)

```bash
# Cost comparison for content creation
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Write a 500-word article about sustainable technology trends" \
  --models "google:gemini-3-flash-preview,openrouter:openai/gpt-4o-mini,openrouter:openai/gpt-4o" \
  --id "content-creation-costs" \
  --concurrent

# Estimate monthly costs:
# - Gemini 2.0 Flash: ~$15/month
# - GPT-4o-mini: ~$45/month  
# - GPT-4o: ~$400/month
```

### Scenario 2: Document Analysis (10,000 PDFs/month)

```bash
# Cost-effective document processing
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Extract key information: title, date, summary, classification" \
  --models "google:gemini-3-flash-preview" \
  --id "document-analysis-cost" \
  --directory "./sample-docs" \
  --file-pattern "*.pdf" \
  --file-limit 100 \
  --schema "title, date, summary, classification" \
  --concurrent

# Estimated monthly cost with Gemini 2.0 Flash: ~$200-400/month
```

### Scenario 3: Customer Support (24/7 chatbot)

```bash
# Cost analysis for support responses
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Provide helpful customer support response to this inquiry: 'How do I reset my password?'" \
  --models "google:gemini-3-flash-preview,openrouter:openai/gpt-4o-mini" \
  --id "support-response-cost" \
  --concurrent

# For 1000 interactions/day:
# - Gemini 2.0 Flash: ~$30/month
# - GPT-4o-mini: ~$60/month
```

## Cost-Quality Trade-offs

### Quality Assessment Methods

1. **A/B Testing**: Compare outputs from different models
2. **Human Evaluation**: Rate model outputs for quality
3. **Automated Metrics**: Use scoring systems for consistency
4. **User Feedback**: Collect feedback on model performance

### Decision Framework

| Use Case | Budget Priority | Quality Priority | Recommended Model |
|----------|----------------|------------------|-------------------|
| Development/Testing | High | Low-Medium | Ollama models |
| Content Creation | Medium | Medium-High | Gemini 2.0 Flash |
| Customer Support | High | Medium | Gemini 2.0 Flash |
| Research Analysis | Low | High | GPT-4o or Gemini 2.5 Pro |
| Legal/Medical | Low | Very High | GPT-4o with human review |

## Advanced Cost Optimization

### Prompt Template Optimization

```bash
# Create reusable prompts to reduce token usage
# Instead of repeating instructions, use templates

# Inefficient: Repeat context each time
dotenvx run -- pnpm run cli -- eval run \
  --prompt "You are a technical writer. Write clearly and concisely. Use bullet points. Explain [TOPIC]" \
  --models "google:gemini-3-flash-preview" \
  --id "inefficient"

# Efficient: Use system message for context
dotenvx run -- pnpm run cli -- eval run \
  --system "You are a technical writer. Write clearly and concisely. Use bullet points." \
  --prompt "Explain [TOPIC]" \
  --models "google:gemini-3-flash-preview" \
  --id "efficient"
```

### Batch Size Optimization

```bash
# Find optimal batch size for your use case
# Test different concurrency levels and batch sizes

# Small batches (safer, lower concurrency)
dotenvx run -- pnpm run cli -- eval batch \
  --file-limit 50 \
  --max-concurrency 2 \
  --id "small-batch-test"

# Large batches (riskier, higher concurrency)
dotenvx run -- pnpm run cli -- eval batch \
  --file-limit 200 \
  --max-concurrency 5 \
  --id "large-batch-test"
```

### Model Selection Automation

Create scripts to automatically select the most cost-effective model:

```bash
#!/bin/bash
# cost-optimizer.sh

TASK_COMPLEXITY=$1  # simple, medium, complex
BUDGET=$2          # low, medium, high

case "$TASK_COMPLEXITY-$BUDGET" in
  "simple-low")
    MODEL="ollama:gemma3:12b"
    ;;
  "simple-medium"|"medium-low")
    MODEL="google:gemini-3-flash-preview"
    ;;
  "medium-medium"|"complex-low")
    MODEL="google:gemini-3-flash-preview"
    ;;
  "medium-high"|"complex-medium")
    MODEL="openrouter:openai/gpt-4o-mini"
    ;;
  "complex-high")
    MODEL="openrouter:openai/gpt-4o"
    ;;
esac

dotenvx run -- pnpm run cli -- eval run --models "$MODEL" --prompt "$3" --id "$4"
```

## Cost Reporting and Analytics

### Generate Cost Reports

```bash
# Monthly cost summary
dotenvx run -- pnpm run cli -- eval list --json | jq '
  map(select(.date | startswith("2025-01"))) | 
  map(.cost.totalCost) | 
  add
'

# Cost by model type
dotenvx run -- pnpm run cli -- eval list --json | jq '
  group_by(.models[0]) | 
  map({model: .[0].models[0], total_cost: map(.cost.totalCost) | add})
'

# Average cost per evaluation
dotenvx run -- pnpm run cli -- eval list --json | jq '
  map(.cost.totalCost) | 
  add / length
'
```

### Export for External Analysis

```bash
# Export to CSV for spreadsheet analysis
dotenvx run -- pnpm run cli -- eval list --json | jq -r '
  ["ID", "Date", "Model", "Cost", "Tokens"] as $headers |
  $headers,
  (.[] | [.id, .date, .models[0], .cost.totalCost, .cost.usage.total])
  | @csv
' > evaluation-costs.csv

# Export to format suitable for BI tools
dotenvx run -- pnpm run cli -- eval list --json | jq '[.[] | {
  id, 
  date, 
  model: .models[0], 
  cost: .cost.totalCost, 
  input_tokens: .cost.usage.promptTokens,
  output_tokens: .cost.usage.completionTokens
}]' > costs-for-bi.json
```

## Best Practices

### Planning
- **Start Small**: Test with small samples before scaling
- **Set Budgets**: Establish monthly/weekly spending limits
- **Monitor Regularly**: Check costs frequently during development
- **Document Decisions**: Keep records of model selection rationale

### Execution
- **Use Appropriate Models**: Match model capability to task complexity
- **Optimize Prompts**: Reduce unnecessary tokens in prompts and responses
- **Batch Efficiently**: Use concurrent processing for better throughput
- **Monitor Performance**: Track cost per quality unit

### Analysis
- **Regular Reviews**: Analyze costs weekly or monthly
- **Trend Analysis**: Look for patterns in spending over time
- **ROI Calculation**: Measure value generated per dollar spent
- **Optimization Opportunities**: Identify areas for cost reduction

## Next Steps

- Try [batch processing](/guide/batch-processing) for cost-effective scaling
- Explore [model evaluation](/guide/model-evaluation) for quality assessment
- See [cost optimization examples](/examples/cost-optimization) for specific scenarios
- Learn about [structured output](/guide/structured-output) for consistent results