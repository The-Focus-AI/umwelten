# Creative Writing Examples

This page shows how to use Umwelten for creative writing tasks, including poetry generation and temperature experimentation. These examples correspond to the migrated `cat-poem.ts` and `temperature.ts` scripts.

## Basic Poetry Generation

### Simple Cat Poem Evaluation

Replicate the original `cat-poem.ts` script functionality:

```bash
# Evaluate cat poem generation across multiple models
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Write a short poem about a cat." \
  --models "ollama:gemma3:27b,ollama:gemma3:12b,google:gemini-3-flash-preview,google:gemini-2.5-pro-exp-03-25" \
  --id "cat-poem" \
  --system "You are a helpful assistant that writes short poems about cats." \
  --temperature 0.5
```

### Generate Report

```bash
# View results in markdown format
dotenvx run -- pnpm run cli -- eval report --id cat-poem --format markdown

# Export to HTML for sharing
dotenvx run -- pnpm run cli -- eval report --id cat-poem --format html --output cat-poems.html
```

## Temperature Effects

### Testing Different Temperature Values

Compare how temperature affects creativity (replaces `temperature.ts`):

```bash
# High temperature (more creative/random)
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Write a short poem about a cat" \
  --models "ollama:gemma3:27b" \
  --id "temperature-high" \
  --system "You are a helpful assistant that writes short poems about cats." \
  --temperature 2.0

# Low temperature (more focused/predictable)  
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Write a short poem about a cat" \
  --models "ollama:gemma3:27b" \
  --id "temperature-low" \
  --system "You are a helpful assistant that writes short poems about cats." \
  --temperature 0.5

# Medium temperature (balanced)
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Write a short poem about a cat" \
  --models "ollama:gemma3:27b" \
  --id "temperature-medium" \
  --system "You are a helpful assistant that writes short poems about cats." \
  --temperature 1.0
```

### Compare Temperature Results

```bash
# Generate individual reports
dotenvx run -- pnpm run cli -- eval report --id temperature-high --format markdown
dotenvx run -- pnpm run cli -- eval report --id temperature-low --format markdown  
dotenvx run -- pnpm run cli -- eval report --id temperature-medium --format markdown
```

## Advanced Creative Writing

### Story Generation with Multiple Models

```bash
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Write a creative short story about an AI that learns to paint" \
  --models "ollama:gemma3:27b,google:gemini-3-flash-preview,openrouter:openai/gpt-4o-mini" \
  --id "ai-painter-story" \
  --system "You are a creative writer who specializes in science fiction short stories." \
  --temperature 1.2 \
  --concurrent
```

### Poetry with Structured Output

Extract structured information from generated poems:

```bash
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Write a haiku about the ocean, then analyze its structure" \
  --models "google:gemini-3-flash-preview,ollama:gemma3:12b" \
  --id "structured-haiku" \
  --schema "poem, syllable_count int, theme, mood" \
  --temperature 0.8
```

### Interactive UI Mode

Watch stories generate in real-time:

```bash
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Write a dramatic short story with dialogue" \
  --models "ollama:gemma3:27b,google:gemini-3-flash-preview" \
  --id "dramatic-story" \
  --temperature 1.3 \
  --ui
```

## Expected Output Examples

### Cat Poem Results (temperature 0.5)

**Ollama Gemma3:27b**
```
Whiskers twitching in the morning light,
A feline friend with eyes so bright.
Purring softly on my chest,
In your warmth, I find my rest.

Graceful leaps from chair to floor,
Always curious, wanting more.
Little paws and gentle purr,
You're my favorite ball of fur.
```

**Google Gemini 2.0 Flash**  
```
Silken paws on windowsill,
Golden eyes so bright and still.
Whiskers twitch at morning birds,
Poetry beyond mere words.

Curled up tight in sunny spots,
Connecting all life's scattered dots.
In your purr I hear the song
Of contentment, pure and strong.
```

### Temperature Comparison

**High Temperature (2.0) - More Creative/Random**
```
Cosmic whiskers dance through starlight dreams,
While rainbow paws chase moonbeam streams!
A purr that echoes through dimensions vast,
This mystical cat, unsurpassed!

Translucent fur of liquid gold,
Stories that will never be told...
```

**Low Temperature (0.5) - More Focused**
```
A gentle cat with soft gray fur,
Content to sit and softly purr.
By the window watching birds,
A peaceful scene beyond mere words.

Small and quiet, warm and sweet,
Curled up cozy at my feet.
```

## Performance Comparison

### Sample Report Output

```markdown
# Evaluation Report: cat-poem

**Generated:** 2025-01-27T10:30:00.000Z  
**Total Models:** 4

| Model | Provider | Response Length | Tokens (P/C/Total) | Time (ms) | Cost Estimate |
|-------|----------|----------------|-------------------|-----------|---------------|
| gemma3:27b | ollama | 285 | 24/71/95 | 8420 | Free |
| gemma3:12b | ollama | 245 | 24/61/85 | 3210 | Free |
| gemini-3-flash-preview | google | 310 | 24/78/102 | 2100 | $0.000031 |
| gemini-2.5-pro-exp-03-25 | google | 298 | 24/75/99 | 4200 | $0.000087 |

## Statistics
- **Total Time:** 18,930ms (18.9s)
- **Total Tokens:** 381
- **Total Cost:** $0.000118
- **Average Response Length:** 285 characters
```

## Tips for Creative Writing Evaluation

### Temperature Guidelines
- **0.0-0.3**: Very focused, predictable output
- **0.4-0.7**: Good balance of creativity and coherence  
- **0.8-1.2**: More creative, some unpredictability
- **1.3-2.0**: Highly creative, potentially incoherent

### Model Selection
- **For Poetry**: Ollama models often excel at rhythm and flow
- **For Stories**: Google Gemini models provide good narrative structure
- **For Experimentation**: OpenRouter gives access to diverse writing styles

### System Prompts
- Be specific about the writing style you want
- Include constraints (length, format, tone)
- Mention the target audience if relevant

## Next Steps

- Try [analysis & reasoning examples](/examples/analysis-reasoning) for more complex tasks
- Explore [structured output](/examples/structured-output) for extracting writing metrics
- See [cost optimization](/examples/cost-optimization) for budget-conscious creative projects