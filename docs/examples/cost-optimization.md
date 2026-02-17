# Cost Optimization Examples

This example demonstrates how to use Umwelten for cost-effective AI model evaluation and optimization. These examples correspond to the migrated `google-pricing.ts` script and show how to compare costs, optimize spending, and make informed decisions about model selection.

## Basic Cost Comparison

### Google Models Pricing Analysis (google-pricing.ts equivalent)

Test Google models for pricing and cost analysis:

```bash
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Write a detailed analysis of machine learning trends in 2024, including key developments in LLMs, computer vision, and AI safety. Include specific examples and future predictions." \
  --models "google:gemini-3-flash-preview,google:gemini-2.5-pro-exp-03-25,google:gemini-1.5-flash-8b" \
  --id "google-pricing-comparison" \
  --temperature 0.3 \
  --concurrent
```

### Cross-Provider Cost Comparison

Compare costs across different providers for the same task:

```bash
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Analyze the competitive landscape for cloud computing services, focusing on AWS, Google Cloud, and Microsoft Azure. Include market share, pricing strategies, and key differentiators." \
  --models "google:gemini-3-flash-preview,openrouter:openai/gpt-4o-mini,openrouter:openai/gpt-4o,ollama:gemma3:12b" \
  --id "provider-cost-comparison" \
  --concurrent \
  --max-concurrency 3
```

### Generate Cost Analysis Report

```bash
# Generate detailed cost report
dotenvx run -- pnpm run cli -- eval report --id google-pricing-comparison --format markdown

# Export cost data for further analysis  
dotenvx run -- pnpm run cli -- eval report --id provider-cost-comparison --format csv --output cost-analysis.csv
```

## Cost Optimization Strategies

### Model Tier Comparison

Compare different model tiers for the same task:

```bash
# Premium tier
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Create a comprehensive business plan for a sustainable energy startup" \
  --models "google:gemini-2.5-pro-exp-03-25,openrouter:openai/gpt-4o" \
  --id "business-plan-premium" \
  --system "You are a business consultant with expertise in sustainable energy and startup development"

# Standard tier
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Create a comprehensive business plan for a sustainable energy startup" \
  --models "google:gemini-3-flash-preview,openrouter:openai/gpt-4o-mini" \
  --id "business-plan-standard" \
  --system "You are a business consultant with expertise in sustainable energy and startup development"

# Budget tier (free)
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Create a comprehensive business plan for a sustainable energy startup" \
  --models "ollama:gemma3:27b,ollama:llama3.2:latest" \
  --id "business-plan-budget" \
  --system "You are a business consultant with expertise in sustainable energy and startup development"
```

### Prompt Length Optimization

Test how prompt length affects costs:

```bash
# Detailed prompt (higher cost)
dotenvx run -- pnpm run cli -- eval run \
  --prompt "You are a financial analyst. Please provide a comprehensive analysis of Tesla's stock performance over the past 5 years, including quarterly earnings, market trends, competitive positioning, regulatory environment, technological developments, executive leadership changes, and forward-looking projections. Include specific metrics, comparisons to competitors, and risk assessments." \
  --models "google:gemini-3-flash-preview,openrouter:openai/gpt-4o-mini" \
  --id "detailed-prompt-cost"

# Concise prompt (lower cost)
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Analyze Tesla's 5-year stock performance including earnings, market trends, competition, and future outlook." \
  --models "google:gemini-3-flash-preview,openrouter:openai/gpt-4o-mini" \
  --id "concise-prompt-cost"
```

### Batch vs Individual Processing

Compare costs of batch vs individual processing:

```bash
# Individual processing (potentially higher cost due to overhead)
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Summarize this document in 100 words" \
  --models "google:gemini-3-flash-preview" \
  --id "individual-doc-1" \
  --attach "./docs/doc1.pdf"

dotenvx run -- pnpm run cli -- eval run \
  --prompt "Summarize this document in 100 words" \
  --models "google:gemini-3-flash-preview" \
  --id "individual-doc-2" \
  --attach "./docs/doc2.pdf"

# Batch processing (more efficient)
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Summarize this document in 100 words" \
  --models "google:gemini-3-flash-preview" \
  --id "batch-docs" \
  --directory "./docs" \
  --file-pattern "*.pdf" \
  --concurrent
```

## Advanced Cost Optimization

### Response Length Impact

Test how response length requirements affect costs:

```bash
# Short response
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Explain quantum computing in 50 words or less" \
  --models "google:gemini-3-flash-preview,openrouter:openai/gpt-4o-mini,ollama:gemma3:12b" \
  --id "short-response-cost" \
  --concurrent

# Medium response  
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Explain quantum computing in approximately 200 words" \
  --models "google:gemini-3-flash-preview,openrouter:openai/gpt-4o-mini,ollama:gemma3:12b" \
  --id "medium-response-cost" \
  --concurrent

# Long response
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Write a comprehensive explanation of quantum computing (800-1000 words)" \
  --models "google:gemini-3-flash-preview,openrouter:openai/gpt-4o-mini,ollama:gemma3:12b" \
  --id "long-response-cost" \
  --concurrent
```

### Context Window Optimization

Optimize for different context window needs:

```bash
# Large context (higher cost)
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Analyze this entire document and provide insights" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "large-context-test" \
  --attach "./large-document.pdf"

# Chunked processing (potentially lower cost)
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Analyze the executive summary and key findings sections" \
  --models "google:gemini-3-flash-preview" \
  --id "chunked-processing-test" \
  --attach "./large-document.pdf"
```

### Temperature and Quality Trade-offs

Balance cost with output quality using temperature:

```bash
# High quality, deterministic (may use more tokens for consistency)
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Write a professional email responding to a customer complaint" \
  --models "google:gemini-3-flash-preview,openrouter:openai/gpt-4o-mini" \
  --id "high-quality-email" \
  --temperature 0.1 \
  --concurrent

# Balanced creativity and cost
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Write a professional email responding to a customer complaint" \
  --models "google:gemini-3-flash-preview,openrouter:openai/gpt-4o-mini" \
  --id "balanced-email" \
  --temperature 0.7 \
  --concurrent
```

## Expected Cost Analysis Results

### Sample Cost Comparison Report

```markdown
# Cost Optimization Report: provider-cost-comparison

**Generated:** 2025-01-27T23:00:00.000Z  
**Task:** Cloud Computing Analysis (1000+ word responses)
**Total Models:** 4

## Cost Breakdown

| Model | Provider | Input Tokens | Output Tokens | Total Cost | Cost/1K Out | Response Quality |
|-------|----------|-------------|---------------|------------|-------------|------------------|
| gemini-3-flash-preview | google | 45 | 1,240 | $0.000405 | $0.327 | Excellent |
| gpt-4o-mini | openrouter | 45 | 1,180 | $0.000713 | $0.604 | Very Good |
| gpt-4o | openrouter | 45 | 1,320 | $0.013245 | $10.034 | Outstanding |
| gemma3:12b | ollama | 45 | 1,200 | $0.000000 | $0.000 | Good |

## Cost Efficiency Analysis

### Best Value Models
1. **Ollama Gemma3:12b** - Free local processing, good quality
2. **Google Gemini 2.0 Flash** - Excellent quality at low cost ($0.0004/response)
3. **OpenRouter GPT-4o-mini** - Premium quality at reasonable cost ($0.0007/response)

### Cost vs Quality Trade-offs
- **Gemini 2.0 Flash**: 18x cheaper than GPT-4o with 90% of the quality
- **GPT-4o-mini**: 19x cheaper than GPT-4o with 85% of the quality  
- **Ollama**: Free but requires local hardware and setup

### Scaling Projections
- **1,000 evaluations**: Gemini ($0.41) vs GPT-4o-mini ($0.71) vs GPT-4o ($13.25)
- **10,000 evaluations**: Gemini ($4.10) vs GPT-4o-mini ($7.10) vs GPT-4o ($132.50)
- **100,000 evaluations**: Gemini ($41) vs GPT-4o-mini ($71) vs GPT-4o ($1,325)

## Optimization Recommendations

### For Budget-Conscious Projects
- Use Ollama models for experimentation and development
- Switch to Gemini 2.0 Flash for production workloads
- Reserve premium models for critical tasks only

### For Quality-Critical Projects  
- Use GPT-4o for highest stakes content
- Use Gemini 2.5 Pro for complex analysis tasks
- Use multiple models and select best outputs

### For High-Volume Processing
- Implement model cascading (cheap model first, expensive model for edge cases)
- Use concurrent processing to reduce wall-clock time
- Consider batch processing for efficiency gains
```

### Detailed Cost Metrics

```json
{
  "cost_analysis": {
    "models": [
      {
        "name": "gemini-3-flash-preview",
        "provider": "google",
        "total_cost": 0.000405,
        "cost_per_1k_input": 0.075,
        "cost_per_1k_output": 0.300,
        "avg_response_time_ms": 3200,
        "cost_per_second": 0.000127
      },
      {
        "name": "gpt-4o-mini", 
        "provider": "openrouter",
        "total_cost": 0.000713,
        "cost_per_1k_input": 0.150,
        "cost_per_1k_output": 0.600,
        "avg_response_time_ms": 4100,
        "cost_per_second": 0.000174
      }
    ],
    "recommendations": {
      "most_cost_effective": "gemini-3-flash-preview",
      "best_quality_per_dollar": "gemini-3-flash-preview", 
      "fastest_response": "gemini-3-flash-preview",
      "free_alternative": "ollama:gemma3:12b"
    }
  }
}
```

## Cost Optimization Strategies

### 1. Model Selection Framework

```bash
# Tier 1: Experimentation and Development (Free)
dotenvx run -- pnpm run cli -- eval run \
  --models "ollama:gemma3:12b,ollama:llama3.2:latest" \
  --id "dev-testing" \
  --prompt "Test prompt for development"

# Tier 2: Production Workloads (Low Cost)  
dotenvx run -- pnpm run cli -- eval run \
  --models "google:gemini-3-flash-preview,google:gemini-1.5-flash-8b" \
  --id "production-standard" \
  --prompt "Production prompt"

# Tier 3: Premium Quality (High Cost)
dotenvx run -- pnpm run cli -- eval run \
  --models "google:gemini-2.5-pro-exp-03-25,openrouter:openai/gpt-4o" \
  --id "premium-quality" \
  --prompt "Critical quality prompt"
```

### 2. Prompt Engineering for Cost

```bash
# Cost-inefficient prompt
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Please provide a very detailed, comprehensive, extensive, and thorough analysis with multiple examples, extensive background information, detailed explanations, and comprehensive coverage of all aspects..." \
  --models "google:gemini-3-flash-preview" \
  --id "inefficient-prompt"

# Cost-efficient prompt
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Analyze X focusing on key points A, B, C. Include 2-3 specific examples. Target length: 300 words." \
  --models "google:gemini-3-flash-preview" \
  --id "efficient-prompt"
```

### 3. Batch Processing for Scale

```bash
# Process 100 documents efficiently
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Summarize key points in 100 words" \
  --models "google:gemini-3-flash-preview" \
  --id "cost-efficient-batch" \
  --directory "./documents" \
  --file-pattern "*.pdf" \
  --concurrent \
  --max-concurrency 5
```

### 4. Quality Validation Strategies

```bash
# Use cheap model for first pass
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Quick analysis of this document" \
  --models "google:gemini-3-flash-preview" \
  --id "first-pass"

# Use expensive model only for validation/refinement
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Detailed analysis building on initial findings" \
  --models "openrouter:openai/gpt-4o" \
  --id "validation-pass"
```

## Real-World Cost Scenarios

### Scenario 1: Content Creation (1000 articles/month)

```bash
# Option A: Premium models ($150/month)
dotenvx run -- pnpm run cli -- eval batch \
  --models "openrouter:openai/gpt-4o" \
  --prompt "Write a 500-word article about [topic]" \
  --id "premium-content"

# Option B: Balanced approach ($15/month)  
dotenvx run -- pnpm run cli -- eval batch \
  --models "google:gemini-3-flash-preview" \
  --prompt "Write a 500-word article about [topic]" \
  --id "balanced-content"

# Option C: Free local processing ($0/month + hardware)
dotenvx run -- pnpm run cli -- eval batch \
  --models "ollama:gemma3:27b" \
  --prompt "Write a 500-word article about [topic]" \
  --id "free-content"
```

### Scenario 2: Document Analysis (10,000 PDFs/month)

```bash
# High-volume processing optimization
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Extract key information: title, date, summary" \
  --models "google:gemini-3-flash-preview" \
  --schema "title, date, summary, confidence int" \
  --directory "./monthly-documents" \
  --file-pattern "*.pdf" \
  --concurrent \
  --max-concurrency 8 \
  --id "monthly-document-processing"
```

### Scenario 3: Research Analysis (100 papers/week)

```bash
# Mixed approach: cheap for screening, expensive for deep analysis
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Quick relevance assessment (relevant/not relevant)" \
  --models "google:gemini-3-flash-preview" \
  --id "paper-screening" \
  --directory "./papers" \
  --file-pattern "*.pdf"

# Follow-up with detailed analysis for relevant papers only
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Detailed analysis of methodology, findings, and significance" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "deep-paper-analysis" \
  --attach "./relevant-papers/*.pdf"
```

## Monitoring and Optimization Tools

### Cost Tracking Commands

```bash
# List all evaluations with cost information
dotenvx run -- pnpm run cli -- eval list --details

# Export cost data for analysis
dotenvx run -- pnpm run cli -- eval report --id all --format csv --output monthly-costs.csv

# Compare costs across time periods
dotenvx run -- pnpm run cli -- eval report --id january-batch --format json > jan-costs.json
dotenvx run -- pnpm run cli -- eval report --id february-batch --format json > feb-costs.json
```

### Budget Management

```bash
# Set evaluation limits for cost control
dotenvx run -- pnpm run cli -- eval batch \
  --file-limit 100 \
  --timeout 30000 \
  --models "google:gemini-3-flash-preview" \
  --id "budget-controlled-batch"
```

## Tips for Cost Optimization

### Model Selection Guidelines
1. **Development**: Use Ollama models (free)
2. **Production**: Start with Gemini 2.0 Flash
3. **Premium**: Use GPT-4o only when quality is critical
4. **Validation**: Use multiple cheap models instead of one expensive model

### Prompt Engineering  
- Be specific about desired output length
- Avoid redundant instructions and examples
- Use structured output to reduce post-processing
- Test with cheap models first

### Processing Optimization
- Use batch processing for similar tasks
- Enable concurrent processing for speed
- Set appropriate timeouts to avoid waste
- Use resume capability for interrupted jobs

### Quality vs Cost Balance
- Define quality thresholds for different use cases
- Use cheap models for screening, expensive for final analysis
- Implement human review for critical decisions
- Track quality metrics alongside cost metrics

## Next Steps

- Explore [batch processing](/examples/batch-processing) for large-scale cost optimization
- See [structured output](/examples/structured-output) for reducing post-processing costs
- Try [model evaluation](/examples/model-evaluation) for systematic quality comparison
- Review [analysis & reasoning](/examples/analysis-reasoning) for complex task optimization