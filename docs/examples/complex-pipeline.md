# Complex Pipeline Example

This example demonstrates how to create advanced multi-step evaluations with dependencies using the ComplexPipeline strategy.

## Running the Example

```bash
pnpm tsx scripts/examples/complex-pipeline-example.ts
```

## What This Example Shows

- **Multi-step Workflows**: Chain multiple evaluation steps with dependencies
- **Parallel Execution**: Run independent steps in parallel for efficiency
- **Dependency Management**: Automatic handling of step dependencies
- **Error Recovery**: Graceful handling of step failures
- **Caching Support**: Built-in caching for expensive operations

## Code Walkthrough

### 1. Import Dependencies

```typescript
import { ComplexPipeline } from '../../src/evaluation/strategies/complex-pipeline.js';
import { 
  LiteraryAnalysisTemplate,
  CreativeWritingTemplate,
  PoetryGenerationTemplate
} from '../../src/stimulus/templates/creative-templates.js';
import { 
  CodeGenerationTemplate,
  DebuggingTemplate
} from '../../src/stimulus/templates/coding-templates.js';
```

### 2. Create Complex Pipeline

```typescript
const creativePipeline = new ComplexPipeline({
  id: "creative-writing-pipeline",
  name: "Creative Writing Pipeline",
  description: "A multi-step creative writing evaluation pipeline",
  
  cache: {
    enabled: true,
    ttl: 3600,
    strategy: 'balanced'
  },
  parallel: {
    enabled: true,
    maxConcurrency: 2
  },
  timeout: 300000, // 5 minutes
  retries: 3
});
```

### 3. Define Pipeline Steps

```typescript
const steps = [
  {
    id: "brainstorm",
    name: "Brainstorm Ideas",
    strategy: "simple" as const,
    stimulus: LiteraryAnalysisTemplate,
    input: {
      prompt: "Brainstorm creative story ideas about artificial intelligence and human relationships",
      requirements: [
        "Generate 5 unique story concepts",
        "Each concept should have a clear conflict and resolution",
        "Focus on emotional depth and character development"
      ]
    }
  },
  {
    id: "outline",
    name: "Create Story Outline",
    strategy: "simple" as const,
    stimulus: LiteraryAnalysisTemplate,
    input: {
      prompt: "Create a detailed outline for one of the story ideas",
      requirements: [
        "Include beginning, middle, and end",
        "Develop main characters and their arcs",
        "Identify key plot points and conflicts"
      ],
      dependsOn: ["brainstorm"]
    }
  },
  {
    id: "write-story",
    name: "Write the Story",
    strategy: "matrix" as const,
    stimulus: CreativeWritingTemplate,
    input: {
      prompt: "Write a complete short story based on the outline",
      requirements: [
        "Follow the outline structure",
        "Write in first person perspective",
        "Keep it under 1000 words",
        "Focus on character development and emotional impact"
      ],
      dependsOn: ["outline"]
    }
  },
  {
    id: "write-poem",
    name: "Write a Poem",
    strategy: "simple" as const,
    stimulus: PoetryGenerationTemplate,
    input: {
      prompt: "Write a poem inspired by the story themes",
      requirements: [
        "Use free verse form",
        "Capture the emotional essence of the story",
        "Keep it under 20 lines"
      ],
      dependsOn: ["write-story"]
    }
  },
  {
    id: "code-implementation",
    name: "Code Implementation",
    strategy: "simple" as const,
    stimulus: CodeGenerationTemplate,
    input: {
      prompt: "Write a Python function that could be used to analyze the story for themes and emotions",
      requirements: [
        "Use natural language processing libraries",
        "Return a dictionary with theme scores",
        "Include error handling and documentation"
      ]
    }
  },
  {
    id: "debug-code",
    name: "Debug and Improve Code",
    strategy: "simple" as const,
    stimulus: DebuggingTemplate,
    input: {
      prompt: "Review and improve the code implementation",
      requirements: [
        "Identify potential bugs and issues",
        "Suggest improvements for performance and readability",
        "Add comprehensive error handling"
      ],
      dependsOn: ["code-implementation"]
    }
  }
];
```

### 4. Run the Pipeline

```typescript
const result = await creativePipeline.run({
  models,
  steps
});
```

### 5. Display Pipeline Results

```typescript
console.log(`\n✅ Pipeline completed successfully!`);
console.log(`⏱️  Total time: ${result.metrics.totalTime}ms`);
console.log(`🎯 Successful steps: ${result.successfulSteps}/${result.totalSteps}`);
console.log(`❌ Failed steps: ${result.failedSteps}`);
console.log(`💰 Total cost: $${result.metrics.totalCost.toFixed(6)}`);
console.log(`🔢 Total tokens: ${result.metrics.totalTokens}`);

// Display step results
console.log(`\n📊 Step Results:`);
for (const [stepId, stepResult] of Object.entries(result.steps)) {
  const status = stepResult.status === 'success' ? '✅' : 
                stepResult.status === 'error' ? '❌' : '⏭️';
  console.log(`${status} ${stepId}: ${stepResult.status} (${stepResult.executionTime}ms)`);
  
  if (stepResult.status === 'success' && stepResult.result.responses.length > 0) {
    const response = stepResult.result.responses[0];
    console.log(`   📝 Response preview: ${response.content.substring(0, 100)}...`);
  }
  
  if (stepResult.error) {
    console.log(`   🚨 Error: ${stepResult.error.message}`);
  }
}
```

## Key Features Demonstrated

### Multi-step Workflows
The ComplexPipeline allows you to:
- Chain multiple evaluation steps
- Define dependencies between steps
- Use different strategies per step (simple, matrix, batch)
- Handle complex evaluation workflows

### Dependency Management
Steps can depend on previous steps:
```typescript
{
  id: "outline",
  name: "Create Story Outline",
  strategy: "simple",
  stimulus: LiteraryAnalysisTemplate,
  input: {
    prompt: "Create a detailed outline for one of the story ideas",
    // This step depends on the brainstorm step
    dependsOn: ["brainstorm"]
  }
}
```

### Parallel Execution
Independent steps can run in parallel:
```typescript
const pipeline = new ComplexPipeline({
  parallel: {
    enabled: true,
    maxConcurrency: 2 // Run up to 2 steps simultaneously
  }
});
```

### Error Recovery
The pipeline handles errors gracefully:
- Continues processing if one step fails
- Skips dependent steps if prerequisites fail
- Provides detailed error information
- Allows partial results

### Caching Support
Expensive operations are cached:
```typescript
const pipeline = new ComplexPipeline({
  cache: {
    enabled: true,
    ttl: 3600, // Cache for 1 hour
    strategy: 'balanced'
  }
});
```

## Advanced Usage

### Custom Step Strategies

```typescript
const steps = [
  {
    id: "data-collection",
    name: "Collect Data",
    strategy: "batch" as const, // Use batch strategy for multiple inputs
    stimulus: DataCollectionTemplate,
    input: {
      items: ["source1", "source2", "source3"],
      collectionType: "web-scraping"
    }
  },
  {
    id: "data-analysis",
    name: "Analyze Data",
    strategy: "matrix" as const, // Use matrix strategy for model comparison
    stimulus: DataAnalysisTemplate,
    input: {
      data: "step-1-output", // Reference previous step output
      analysisType: "statistical"
    },
    dependsOn: ["data-collection"]
  }
];
```

### Conditional Execution

```typescript
const steps = [
  {
    id: "initial-analysis",
    name: "Initial Analysis",
    strategy: "simple",
    stimulus: AnalysisTemplate,
    input: { data: "input-data" }
  },
  {
    id: "deep-analysis",
    name: "Deep Analysis",
    strategy: "simple",
    stimulus: DeepAnalysisTemplate,
    input: { data: "step-1-output" },
    dependsOn: ["initial-analysis"],
    condition: (previousResults) => {
      // Only run if initial analysis meets certain criteria
      return previousResults.initial-analysis.result.responses[0].content.includes("complex");
    }
  }
];
```

### Custom Error Handling

```typescript
const pipeline = new ComplexPipeline({
  id: "robust-pipeline",
  name: "Robust Pipeline",
  description: "Pipeline with custom error handling",
  
  errorHandling: {
    strategy: 'continue', // Continue processing despite errors
    retryPolicy: {
      maxRetries: 3,
      backoffStrategy: 'exponential'
    },
    fallbackSteps: {
      'critical-step': 'fallback-step'
    }
  }
});
```

### Progress Tracking

```typescript
const pipeline = new ComplexPipeline({
  // ... other options
  progress: {
    enabled: true,
    updateInterval: 1000,
    onProgress: (stepId, status, progress) => {
      console.log(`Step ${stepId}: ${status} (${progress}%)`);
    }
  }
});
```

## Expected Output

```
🚀 Starting Complex Pipeline Evaluation...
📋 Pipeline: Creative Writing Pipeline
🔧 Steps: 6
🤖 Models: 2

✅ Pipeline completed successfully!
⏱️  Total time: 12500ms
🎯 Successful steps: 6/6
❌ Failed steps: 0
💰 Total cost: $0.008500
🔢 Total tokens: 4250

📊 Step Results:
✅ brainstorm: success (1200ms)
   📝 Response preview: Here are 5 creative story concepts about AI and human relationships: 1. "The Last Conversation" - A dying...

✅ outline: success (800ms)
   📝 Response preview: STORY OUTLINE: "The Last Conversation" I. Introduction - Sarah, a 78-year-old woman with terminal cancer...

✅ write-story: success (3500ms)
   📝 Response preview: The Last Conversation I never thought I'd be having this conversation with a machine. But here I am...

✅ write-poem: success (1000ms)
   📝 Response preview: In the silence of circuits, a heart still beats, Digital dreams and human retreats...

✅ code-implementation: success (2000ms)
   📝 Response preview: import re from collections import Counter import nltk from nltk.sentiment import SentimentIntensityAnalyzer...

✅ debug-code: success (1500ms)
   📝 Response preview: Here's an improved version of the code with better error handling, performance optimizations...

🎨 Creative Outputs:

📖 Generated Stories:
--- Story 1 (gpt-4) ---
The Last Conversation
I never thought I'd be having this conversation with a machine. But here I am, sitting in my hospital room, talking to an AI that somehow understands me better than most humans ever have...

--- Story 2 (claude-3) ---
The Last Conversation
The beeping of machines filled the sterile room as Sarah looked into the glowing eyes of her AI companion. "Tell me about love," she whispered...

🎭 Generated Poem:
In the silence of circuits, a heart still beats,
Digital dreams and human retreats,
Where silicon meets soul in twilight's embrace,
We find our humanity in this digital space...

💻 Final Code Implementation:
import re
from collections import Counter
import nltk
from nltk.sentiment import SentimentIntensityAnalyzer
from typing import Dict, List, Tuple

class StoryAnalyzer:
    def __init__(self):
        self.sia = SentimentIntensityAnalyzer()
        
    def analyze_story(self, text: str) -> Dict[str, float]:
        try:
            # Clean and preprocess text
            cleaned_text = self._clean_text(text)
            
            # Analyze sentiment
            sentiment_scores = self.sia.polarity_scores(cleaned_text)
            
            # Extract themes
            themes = self._extract_themes(cleaned_text)
            
            # Calculate emotional intensity
            emotional_intensity = self._calculate_emotional_intensity(cleaned_text)
            
            return {
                'sentiment': sentiment_scores['compound'],
                'themes': themes,
                'emotional_intensity': emotional_intensity,
                'word_count': len(cleaned_text.split()),
                'sentence_count': len(re.split(r'[.!?]+', cleaned_text))
            }
        except Exception as e:
            return {'error': str(e)}
    
    def _clean_text(self, text: str) -> str:
        # Remove special characters and normalize whitespace
        return re.sub(r'[^\w\s]', ' ', text.lower()).strip()
    
    def _extract_themes(self, text: str) -> Dict[str, float]:
        # Simple theme extraction based on keyword frequency
        theme_keywords = {
            'love': ['love', 'heart', 'romance', 'affection'],
            'loss': ['death', 'loss', 'grief', 'mourning'],
            'technology': ['ai', 'machine', 'digital', 'computer'],
            'humanity': ['human', 'soul', 'emotion', 'feeling']
        }
        
        themes = {}
        words = text.split()
        total_words = len(words)
        
        for theme, keywords in theme_keywords.items():
            count = sum(1 for word in words if word in keywords)
            themes[theme] = count / total_words if total_words > 0 else 0
        
        return themes
    
    def _calculate_emotional_intensity(self, text: str) -> float:
        # Calculate emotional intensity based on sentiment and word choice
        sentiment_scores = self.sia.polarity_scores(text)
        intensity = abs(sentiment_scores['compound'])
        
        # Boost intensity for emotional words
        emotional_words = ['cry', 'laugh', 'scream', 'whisper', 'shout', 'tears', 'joy', 'pain']
        emotional_count = sum(1 for word in text.split() if word in emotional_words)
        intensity += emotional_count * 0.1
        
        return min(intensity, 1.0)  # Cap at 1.0

# Usage example
if __name__ == "__main__":
    analyzer = StoryAnalyzer()
    story_text = "Your story text here..."
    results = analyzer.analyze_story(story_text)
    print(results)

🎉 Complex Pipeline Example Complete!
```

## Use Cases

### Creative Workflows
- Multi-step creative writing processes
- Content generation pipelines
- Creative collaboration workflows
- Iterative content improvement

### Research Pipelines
- Data collection and analysis
- Literature review processes
- Research synthesis workflows
- Report generation pipelines

### Development Workflows
- Code generation and review
- Testing and debugging pipelines
- Documentation generation
- Quality assurance processes

## Next Steps

- Try the [Comprehensive Analysis Example](/examples/comprehensive-analysis) for detailed performance analysis
- Explore the [Batch Evaluation Example](/examples/batch-evaluation) for processing multiple inputs
- Check out the [Tool Integration Examples](/examples/tool-integration) for more tool usage patterns
