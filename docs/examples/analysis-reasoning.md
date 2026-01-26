# Analysis & Reasoning Examples

This example demonstrates how to use Umwelten for complex analytical and reasoning tasks. These examples correspond to scripts like `frankenstein.ts` and show how to evaluate model capabilities in literary analysis, critical thinking, and complex reasoning.

## Literary Analysis

### Classic Literature Analysis (Frankenstein Script Migration)

This replicates the functionality of the `frankenstein.ts` script:

```bash
npx umwelten eval run \
  --prompt "Who is the monster in Mary Shelley's Frankenstein? Analyze the moral complexity of both Victor Frankenstein and his creature, considering their actions, motivations, and the consequences of their choices." \
  --models "ollama:gemma3:27b,ollama:gemma3:12b,google:gemini-2.0-flash,google:gemini-2.5-flash" \
  --id "frankenstein-analysis" \
  --system "You are a literary critic that writes about books with deep analytical insight and scholarly perspective."
```

### Comparative Literature Analysis

Compare different works and themes:

```bash
npx umwelten eval run \
  --prompt "Compare the themes of isolation and alienation in Mary Shelley's Frankenstein and Emily Dickinson's poetry. How do both authors explore the human condition through their respective mediums?" \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o,ollama:gemma3:27b" \
  --id "isolation-themes" \
  --system "You are a comparative literature scholar specializing in 19th-century American and British literature" \
  --concurrent
```

### Modern Literary Criticism

Apply contemporary critical theories:

```bash
npx umwelten eval run \
  --prompt "Analyze George Orwell's 1984 through the lens of modern surveillance capitalism. What parallels exist between Orwell's dystopia and contemporary digital privacy concerns?" \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o-mini,ollama:llama3.2:latest" \
  --id "orwell-modern-analysis" \
  --system "You are a contemporary literary critic who specializes in connecting classic literature to modern social and technological issues" \
  --temperature 0.4
```

## Complex Reasoning Tasks

### Ethical Dilemma Analysis

Test reasoning capabilities with ethical scenarios:

```bash
npx umwelten eval run \
  --prompt "A self-driving car must choose between hitting one person or swerving to hit five people. Analyze this trolley problem variant from utilitarian, deontological, and virtue ethics perspectives. What factors should influence the car's programming?" \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o,ollama:gemma3:27b" \
  --id "trolley-problem-ai" \
  --system "You are a moral philosopher with expertise in applied ethics and artificial intelligence" \
  --concurrent
```

### Scientific Theory Analysis

Evaluate understanding of complex scientific concepts:

```bash
npx umwelten eval run \
  --prompt "Explain the relationship between quantum mechanics and general relativity. Why is finding a theory of quantum gravity so challenging, and what are the leading approaches (string theory, loop quantum gravity, etc.)?" \
  --models "google:gemini-2.5-pro-exp-03-25,openrouter:openai/gpt-4o,ollama:deepseek-r1:32b" \
  --id "quantum-gravity" \
  --system "You are a theoretical physicist who can explain complex concepts clearly while maintaining scientific rigor" \
  --temperature 0.2
```

### Historical Analysis

Test historical reasoning and cause-effect understanding:

```bash
npx umwelten eval run \
  --prompt "Analyze the multiple causes of World War I. How did the assassination of Archduke Franz Ferdinand trigger such a massive conflict? Evaluate the role of imperialism, nationalism, alliances, and militarism." \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o-mini,ollama:gemma3:27b" \
  --id "wwi-causes" \
  --system "You are a historian specializing in early 20th-century European politics and international relations" \
  --concurrent
```

## Structured Reasoning

### Argument Analysis with Schema

Extract structured reasoning patterns:

```bash
npx umwelten eval run \
  --prompt "Analyze the following argument and identify its structure: 'Climate change is primarily caused by human activities because atmospheric CO2 levels have increased dramatically since industrialization, and this correlates with global temperature rises.'" \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o" \
  --id "argument-analysis" \
  --schema "premise, conclusion, logical_structure, fallacies array, strength_rating int: 1-10, reasoning_type" \
  --system "You are a logic and critical thinking expert who analyzes argument structures"
```

### Multi-step Problem Solving

Test complex reasoning chains:

```bash
npx umwelten eval run \
  --prompt "A company's revenue decreased by 15% this quarter, but their profit margin increased by 3%. Their main competitor gained 8% market share. Analyze what this suggests about the company's strategy, market conditions, and future prospects. Provide specific recommendations." \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o,ollama:gemma3:27b" \
  --id "business-analysis" \
  --system "You are a business analyst with expertise in financial analysis and strategic consulting" \
  --temperature 0.3 \
  --concurrent
```

## Interactive Reasoning Mode

### Real-time Analysis

Watch complex reasoning develop in real-time:

```bash
npx umwelten eval run \
  --prompt "Analyze the philosophical implications of artificial general intelligence (AGI). If machines can think, feel, and make decisions like humans, what does this mean for consciousness, free will, and moral responsibility?" \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o" \
  --id "agi-philosophy" \
  --system "You are a philosopher of mind who specializes in consciousness, AI ethics, and the intersection of technology and human experience" \
  --ui \
  --temperature 0.5
```

## Expected Analysis Examples

### Frankenstein Monster Analysis

**Google Gemini 2.0 Flash Response:**
```
The question of who the true "monster" is in Mary Shelley's Frankenstein reveals the novel's profound moral complexity. While the Creature commits heinous acts—murdering William, framing Justine, killing Clerval and Elizabeth—Victor Frankenstein bears significant moral responsibility as creator and abandoner.

Victor's Monstrosity:
- Abandons his creation immediately after bringing it to life
- Refuses to take responsibility for the Creature's actions  
- Prioritizes his reputation over preventing further violence
- Creates life without considering the ethical implications
- Shows callous disregard for the Creature's emotional needs

The Creature's Monstrosity:
- Commits deliberate murder of innocents
- Uses psychological warfare against Victor
- Refuses to show mercy despite understanding morality
- Demands Victor create a companion or face consequences

However, the Creature begins innocent and becomes violent only after experiencing rejection, isolation, and cruelty. Victor, conversely, acts from selfishness and pride from the beginning. Shelley suggests that true monstrosity lies not in appearance or origin, but in the choice to abandon moral responsibility. Victor's failure as a creator makes him, arguably, the greater monster.
```

**Ollama Gemma3:27b Response:**
```
The true monster in Frankenstein is a complex question that Shelley deliberately leaves ambiguous, but I argue it's primarily Victor Frankenstein himself.

Victor as Monster:
- Pursues forbidden knowledge without considering consequences
- Creates life then immediately abandons his "child"
- Refuses to take responsibility when the Creature kills
- Lies to protect his reputation while innocents die
- Shows complete lack of empathy for his creation's suffering

The Creature, while physically monstrous and violent, is born innocent. His evil develops through:
- Social rejection based on appearance
- Complete isolation and abandonment  
- Self-education that shows him what he's been denied
- Logical but twisted reasoning: if he cannot have love, he'll have revenge

The Creature's violence is reactive, not innate. He learns language, literature, and morality, showing capacity for good. His murders are strategic psychological attacks on Victor, not random violence.

Shelley's genius is showing how monstrosity is created, not born. Victor's scientific hubris and moral cowardice create the very monster he fears. The Creature becomes monstrous because he's treated as one. This makes Victor the ultimate monster - not for creating life, but for abandoning his moral obligations to that life.
```

## Performance Comparison Report

### Sample Reasoning Analysis Report

```markdown
# Analysis & Reasoning Report: frankenstein-analysis

**Generated:** 2025-01-27T21:30:00.000Z  
**Analysis Type:** Literary Criticism
**Total Models:** 4

| Model | Provider | Response Length | Reasoning Depth | Time (ms) | Cost |
|-------|----------|----------------|-----------------|-----------|------|
| gemini-2.0-flash | google | 1450 | High | 3200 | $0.000089 |
| gemma3:27b | ollama | 1380 | High | 12400 | Free |
| gemma3:12b | ollama | 980 | Medium | 6800 | Free |
| gemini-2.5-flash | google | 1520 | Very High | 4100 | $0.000156 |

## Reasoning Quality Assessment

### Analytical Depth
- **Gemini 2.5 Flash**: Most sophisticated analysis with nuanced arguments
- **Gemini 2.0 Flash**: Well-structured with clear examples
- **Gemma3:27b**: Good philosophical depth, strong moral reasoning
- **Gemma3:12b**: Solid but less detailed analysis

### Evidence Usage
- All models referenced specific plot points and character actions
- Gemini models provided more textual evidence
- Ollama models focused more on thematic analysis
- Strong consistency in identifying key moral issues

### Argument Structure
- Clear thesis statements across all responses
- Logical progression from premise to conclusion
- Good use of counterarguments and complexity
- Effective comparison between Victor and the Creature

### Literary Insight
- Understanding of Shelley's intentional moral ambiguity
- Recognition of Gothic novel conventions
- Connection to broader themes of responsibility and creation
- Appreciation for psychological character development

## Statistics
- **Average Analysis Length:** 1332 words
- **Total Processing Time:** 26.5s
- **Cost per Analysis:** $0.000061 (Google models)
- **Reasoning Consistency:** 95% agreement on core themes
```

## Advanced Reasoning Patterns

### Socratic Method Analysis

Guide models through step-by-step reasoning:

```bash
npx umwelten eval run \
  --prompt "Using the Socratic method, examine this statement: 'Artificial intelligence will never truly understand human emotions because it lacks consciousness.' Break down each assumption and explore counterarguments systematically." \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o" \
  --id "socratic-ai-emotions" \
  --system "You are a philosophy teacher who uses the Socratic method to examine assumptions and explore ideas through questioning"
```

### Causal Chain Analysis

Test understanding of complex cause-and-effect relationships:

```bash
npx umwelten eval run \
  --prompt "Trace the causal chain from social media algorithm design to political polarization. Identify key mechanisms, feedback loops, and potential intervention points." \
  --models "google:gemini-2.0-flash,openrouter:openai/gpt-4o,ollama:gemma3:27b" \
  --id "social-media-polarization" \
  --system "You are a social scientist who specializes in technology's impact on society and political behavior" \
  --concurrent
```

### Paradox Resolution

Challenge models with logical paradoxes:

```bash
npx umwelten eval run \
  --prompt "Analyze the Ship of Theseus paradox in the context of personal identity and consciousness. If we gradually replace all neurons in a brain with functionally identical artificial ones, is the resulting consciousness the same person?" \
  --models "google:gemini-2.5-pro-exp-03-25,openrouter:openai/gpt-4o" \
  --id "ship-theseus-consciousness" \
  --system "You are a philosopher of mind who specializes in personal identity, consciousness, and the mind-body problem"
```

## Tips for Effective Analysis Tasks

### Prompt Design for Analysis
- Ask for specific analytical frameworks (utilitarian, deontological, etc.)
- Request evidence and examples to support arguments
- Include multiple perspectives or counterarguments
- Specify the desired depth and scope of analysis

### Model Selection for Reasoning
- **Google Gemini 2.5**: Best for complex philosophical reasoning
- **OpenRouter GPT-4o**: Excellent for structured arguments
- **Ollama Gemma3:27b**: Good balance of depth and accessibility
- **Multiple models**: Compare reasoning approaches and validate conclusions

### System Prompt Best Practices
- Specify the expertise level and perspective
- Include relevant background or context
- Set expectations for analytical depth
- Mention specific methodologies or frameworks

### Temperature for Analysis
- **0.1-0.3**: Rigorous academic analysis
- **0.4-0.6**: Balanced reasoning with some creativity
- **0.7+**: More exploratory and speculative analysis

## Use Cases for Analysis Tasks

### Academic Research
- Literature analysis and interpretation
- Historical event analysis
- Scientific theory evaluation
- Philosophical argument construction

### Professional Analysis
- Business case studies
- Policy analysis and recommendations
- Market research interpretation
- Risk assessment and mitigation

### Creative Analysis
- Character development in fiction
- Thematic exploration in art
- Cultural trend analysis
- Innovation opportunity identification

## Next Steps

- Try [structured output examples](/examples/structured-output) for data-driven analysis
- Explore [cost optimization](/examples/cost-optimization) for large-scale reasoning tasks
- See [PDF analysis examples](/examples/pdf-analysis) for document-based reasoning
- Review [multi-language evaluation](/examples/multi-language) for code reasoning tasks