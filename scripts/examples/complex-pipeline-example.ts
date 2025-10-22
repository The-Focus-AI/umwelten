import { ModelDetails } from "../../src/cognition/types.js";
import { ComplexPipeline } from "../../src/evaluation/strategies/complex-pipeline.js";
import { 
  createCreativeStimulus,
  LiteraryAnalysisTemplate,
  CreativeWritingTemplate,
  PoetryGenerationTemplate
} from "../../src/stimulus/templates/creative-templates.js";
import { 
  createCodingStimulus,
  CodeGenerationTemplate,
  DebuggingTemplate
} from "../../src/stimulus/templates/coding-templates.js";

// Define models to use (using available Ollama models)
const models: ModelDetails[] = [
  {
    name: "gemma3:12b",
    provider: "ollama",
    contextLength: 32768,
    costs: { promptTokens: 0, completionTokens: 0 },
    maxTokens: 1000,
    temperature: 0.7
  },
  {
    name: "qwen2.5:14b",
    provider: "ollama", 
    contextLength: 32768,
    costs: { promptTokens: 0, completionTokens: 0 },
    maxTokens: 1000,
    temperature: 0.7
  }
];

// Create a complex pipeline for creative writing evaluation
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

// Define the pipeline steps
const steps = [
  {
    id: "brainstorm",
    name: "Brainstorm Ideas",
    strategy: "simple" as const,
    stimulus: createCreativeStimulus(LiteraryAnalysisTemplate),
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
    stimulus: createCreativeStimulus(LiteraryAnalysisTemplate),
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
    stimulus: createCreativeStimulus(CreativeWritingTemplate),
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
    stimulus: createCreativeStimulus(PoetryGenerationTemplate),
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
    stimulus: createCodingStimulus(CodeGenerationTemplate),
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
    stimulus: createCodingStimulus(DebuggingTemplate),
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

// Run the pipeline
console.log("🚀 Starting Complex Pipeline Evaluation...");
console.log(`📋 Pipeline: ${creativePipeline['options'].name}`);
console.log(`🔧 Steps: ${steps.length}`);
console.log(`🤖 Models: ${models.length}`);

try {
  const result = await creativePipeline.run({ models, steps });
  
  console.log("\n✅ Pipeline completed successfully!");
  console.log(`⏱️  Total time: ${result.metrics.totalTime}ms`);
  console.log(`🎯 Successful steps: ${result.successfulSteps}/${result.totalSteps}`);
  console.log(`❌ Failed steps: ${result.failedSteps}`);
  console.log(`💰 Total cost: $${result.metrics.totalCost.toFixed(6)}`);
  console.log(`🔢 Total tokens: ${result.metrics.totalTokens}`);
  
  // Display step results
  console.log("\n📊 Step Results:");
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
  
  // Display final creative outputs
  console.log("\n🎨 Creative Outputs:");
  
  const storyStep = result.steps['write-story'];
  if (storyStep?.status === 'success' && storyStep.result.responses.length > 0) {
    console.log("\n📖 Generated Stories:");
    storyStep.result.responses.forEach((response, index) => {
      console.log(`\n--- Story ${index + 1} (${response.metadata.model}) ---`);
      console.log(response.content);
    });
  }
  
  const poemStep = result.steps['write-poem'];
  if (poemStep?.status === 'success' && poemStep.result.responses.length > 0) {
    console.log("\n🎭 Generated Poem:");
    console.log(poemStep.result.responses[0].content);
  }
  
  const codeStep = result.steps['debug-code'];
  if (codeStep?.status === 'success' && codeStep.result.responses.length > 0) {
    console.log("\n💻 Final Code Implementation:");
    console.log(codeStep.result.responses[0].content);
  }
  
} catch (error) {
  console.error("❌ Pipeline failed:", error);
  process.exit(1);
}

console.log("\n🎉 Complex Pipeline Example Complete!");
