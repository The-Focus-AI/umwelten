# Simple Text Generation

This example demonstrates basic text generation and model comparison using Umwelten. These patterns are fundamental to most evaluation workflows and show how to systematically test model capabilities.

## Basic Text Generation

### Simple Model Comparison

Compare how different models handle the same prompt:

```bash
umwelten eval run \
  --prompt "Explain quantum computing in simple terms" \
  --models "ollama:gemma3:12b,google:gemini-2.0-flash,openrouter:openai/gpt-4o-mini" \
  --id "quantum-explanation" \
  --concurrent
```

### With System Prompt and Temperature

Add context and control creativity:

```bash
umwelten eval run \
  --prompt "Explain quantum entanglement and its practical applications" \
  --models "ollama:gemma3:27b,google:gemini-2.0-flash,openrouter:openai/gpt-4o" \
  --id "quantum-detailed" \
  --system "You are a physics professor explaining complex concepts to undergraduate students. Use analogies and examples." \
  --temperature 0.3
```

### Interactive Mode with Real-time Streaming

Watch responses generate in real-time:

```bash
umwelten eval run \
  --prompt "Write a comprehensive explanation of artificial intelligence, covering its history, current applications, and future potential" \
  --models "ollama:gemma3:12b,google:gemini-2.0-flash" \
  --id "ai-comprehensive" \
  --system "You are a technology expert writing for a general audience" \
  --ui \
  --concurrent
```

## Advanced Text Generation Patterns

### Comparing Programming Languages

Test analytical capabilities across models:

```bash
umwelten eval run \
  --prompt "Compare Python, JavaScript, and Rust for web development. Include performance, learning curve, and ecosystem considerations." \
  --models "ollama:gemma3:12b,ollama:llama3.2:latest,google:gemini-2.0-flash,openrouter:openai/gpt-4o-mini" \
  --id "lang-comparison" \
  --system "You are a senior software engineer with experience in multiple programming languages" \
  --concurrent \
  --max-concurrency 3
```

### Technical Writing Evaluation

Test technical writing capabilities:

```bash
umwelten eval run \
  --prompt "Write a technical specification for a REST API that manages user accounts, including authentication, CRUD operations, and error handling" \
  --models "ollama:codestral:latest,google:gemini-2.0-flash,openrouter:openai/gpt-4o" \
  --id "api-spec" \
  --system "You are a senior API architect writing clear, comprehensive technical specifications" \
  --temperature 0.2
```

### Story Writing with Different Creativity Levels

Test creative writing at different temperatures:

```bash
# High creativity
umwelten eval run \
  --prompt "Write a short science fiction story about first contact with an alien civilization" \
  --models "ollama:gemma3:27b,google:gemini-2.0-flash" \
  --id "scifi-creative" \
  --system "You are a creative science fiction writer known for imaginative scenarios" \
  --temperature 1.5

# Low creativity (more structured)
umwelten eval run \
  --prompt "Write a short science fiction story about first contact with an alien civilization" \
  --models "ollama:gemma3:27b,google:gemini-2.0-flash" \
  --id "scifi-structured" \
  --system "You are a science fiction writer focused on realistic, scientifically grounded scenarios" \
  --temperature 0.3
```

## Resume and Error Handling

### Resume Interrupted Evaluations

Continue from where you left off if interrupted:

```bash
umwelten eval run \
  --prompt "Write a detailed analysis of renewable energy technologies and their impact on climate change" \
  --models "ollama:gemma3:27b,google:gemini-2.0-flash,openrouter:openai/gpt-4o-mini" \
  --id "renewable-energy" \
  --resume \
  --concurrent
```

### Timeout Handling for Long Responses

Set appropriate timeouts for complex prompts:

```bash
umwelten eval run \
  --prompt "Write a comprehensive business plan for a sustainable technology startup, including market analysis, financial projections, and implementation timeline" \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o" \
  --id "business-plan" \
  --timeout 60000 \
  --concurrent
```

## Report Generation and Analysis

### Generate Comprehensive Reports

```bash
# Markdown report
umwelten eval report --id quantum-explanation --format markdown

# HTML report with rich formatting
umwelten eval report --id lang-comparison --format html --output comparison-report.html

# CSV export for further analysis
umwelten eval report --id ai-comprehensive --format csv --output ai-analysis.csv

# JSON for programmatic processing
umwelten eval report --id renewable-energy --format json
```

### List and Discover Evaluations

```bash
# List all evaluations
umwelten eval list

# Show detailed information
umwelten eval list --details

# JSON format for scripting
umwelten eval list --json
```

## Expected Output Examples

### Sample Quantum Computing Explanation

**Google Gemini 2.0 Flash:**
```
Quantum computing is a revolutionary approach to processing information that leverages the bizarre properties of quantum mechanics. Unlike classical computers that use bits (0s and 1s), quantum computers use quantum bits or "qubits" that can exist in multiple states simultaneously through a phenomenon called superposition.

Think of it this way: while a classical bit is like a coin that's either heads or tails, a qubit is like a spinning coin that's both heads AND tails until it lands. This allows quantum computers to explore many possible solutions to a problem simultaneously.

Key concepts:
- Superposition: Qubits can be in multiple states at once
- Entanglement: Qubits can be mysteriously connected across distances
- Interference: Quantum states can amplify correct answers and cancel wrong ones

Current applications include cryptography, drug discovery, financial modeling, and optimization problems. While still in early stages, quantum computing promises to solve certain problems exponentially faster than classical computers.
```

**Ollama Gemma3:12b:**
```
Quantum computing represents a fundamentally different approach to computation compared to classical computers. Here's a simplified explanation:

Classical vs Quantum:
- Classical computers process information using bits that are either 0 or 1
- Quantum computers use quantum bits (qubits) that can be 0, 1, or both simultaneously

This "both states at once" property is called superposition, and it's what gives quantum computers their potential power. Imagine being able to try all possible solutions to a puzzle simultaneously rather than testing them one by one.

Another key principle is entanglement, where qubits become interconnected and measuring one instantly affects the others, regardless of distance.

These properties allow quantum computers to potentially solve certain problems much faster than classical computers, particularly in areas like:
- Cryptography and security
- Drug and materials discovery  
- Complex optimization
- Artificial intelligence

However, quantum computers are still experimental and face significant technical challenges including maintaining quantum states and error correction.
```

## Performance Comparison Report

### Sample Report Output

```markdown
# Text Generation Report: quantum-explanation

**Generated:** 2025-01-27T20:15:00.000Z  
**Total Models:** 3

| Model | Provider | Response Length | Tokens (P/C/Total) | Time (ms) | Cost Estimate |
|-------|----------|----------------|-------------------|-----------|---------------|
| gemini-2.0-flash | google | 1240 | 15/248/263 | 2100 | $0.000078 |
| gemma3:12b | ollama | 1180 | 15/236/251 | 8400 | Free |
| gpt-4o-mini | openrouter | 1320 | 15/264/279 | 3200 | $0.000042 |

## Quality Analysis

### Explanation Clarity
- **Google Gemini**: Excellent use of analogies (spinning coin example)
- **Ollama Gemma3**: Good structured approach with clear comparisons
- **OpenRouter GPT-4o-mini**: Comprehensive coverage with technical depth

### Technical Accuracy
- All models provided accurate fundamental explanations
- Gemini included more practical applications
- GPT-4o-mini had the most detailed technical coverage

### Readability
- Average reading level: 12th grade
- All responses accessible to general audiences
- Good balance of technical detail and simplicity

## Statistics
- **Total Time:** 13.7s
- **Total Cost:** $0.000120
- **Average Response Length:** 1247 characters
- **Cost per Response:** $0.000040 (paid models only)
```

## Tips for Effective Text Generation

### Model Selection
- **Google Gemini 2.0 Flash**: Fast, cost-effective, good for most tasks
- **Ollama Models**: Free local processing, good for experimentation
- **OpenRouter GPT-4o**: Highest quality for complex reasoning
- **Multiple Models**: Use for comparison and quality validation

### Prompt Design
- Be specific about the desired output format and length
- Include context about the target audience
- Use system prompts to set the role and expertise level
- Consider temperature based on creativity vs. accuracy needs

### Temperature Guidelines
- **0.0-0.3**: Factual, consistent, technical content
- **0.4-0.7**: Balanced creativity and coherence
- **0.8-1.2**: Creative writing, brainstorming
- **1.3-2.0**: Highly creative, potentially inconsistent

### Performance Optimization
- Use `--concurrent` for multiple models (3-5x faster)
- Set appropriate `--timeout` for complex prompts
- Use `--ui` for long-running evaluations to monitor progress
- Enable `--resume` for reliability with large evaluation sets

## Common Use Cases

### Educational Content
- Explaining complex concepts to different audiences
- Creating study materials and summaries
- Generating examples and analogies

### Technical Documentation
- API documentation and specifications
- Architecture explanations
- Process documentation

### Content Creation
- Blog posts and articles
- Marketing copy with different tones
- Creative writing and storytelling

### Analysis and Comparison
- Technology comparisons
- Market analysis
- Research summaries

## Next Steps

- Try [analysis & reasoning examples](/examples/analysis-reasoning) for more complex tasks
- Explore [structured output](/examples/structured-output) for data extraction
- See [creative writing examples](/examples/creative-writing) for artistic tasks
- Review [cost optimization](/examples/cost-optimization) for budget-conscious projects