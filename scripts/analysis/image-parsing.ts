import { ModelDetails, ModelResponse } from "../src/cognition/types.js";
import { ImageAnalysisStimulus } from "../src/stimulus/analysis/image-analysis.js";
import { Interaction } from "../src/interaction/interaction.js";
import path from "path";
import { SimpleEvaluation } from "../src/evaluation/strategies/simple-evaluation.js";

export async function parseImage(
  imagePath: string,
  model: ModelDetails
): Promise<ModelResponse> {
  const interaction = new Interaction(model, ImageAnalysisStimulus);
  interaction.addAttachmentFromPath(imagePath);
  return interaction.streamText();
}

// Create evaluation using new infrastructure
const evaluation = new SimpleEvaluation({
  id: "image-parsing",
  name: "Image Parsing Evaluation",
  description: "Test image analysis capabilities using the new infrastructure"
});

// Define the test case
const testCase = {
  id: "image-analysis-test",
  name: "Image Analysis Test",
  stimulus: ImageAnalysisStimulus,
  input: {
    imagePath: path.resolve("input/images/internet_archive_fffound.png")
  }
};

// Define models to test
const models = [
  {
    name: "gemma3:12b",
    provider: "ollama",
    costs: {
      promptTokens: 0.0001,
      completionTokens: 0.0001
    },
    maxTokens: 1000,
    temperature: 0.7
  },
  {
    name: "qwen2.5:14b",
    provider: "ollama",
    costs: {
      promptTokens: 0.0001,
      completionTokens: 0.0001
    },
    maxTokens: 1000,
    temperature: 0.7
  },
  {
    name: "phi4:latest",
    provider: "ollama",
    costs: {
      promptTokens: 0.0001,
      completionTokens: 0.0001
    },
    maxTokens: 1000,
    temperature: 0.7
  },
  {
    name: "phi4-mini:latest",
    provider: "ollama",
    costs: {
      promptTokens: 0.0001,
      completionTokens: 0.0001
    },
    maxTokens: 1000,
    temperature: 0.7
  },
  {
    name: "gemini-2.0-flash",
    provider: "google",
    costs: {
      promptTokens: 0.0001,
      completionTokens: 0.0001
    },
    maxTokens: 1000,
    temperature: 0.7
  },
  {
    name: "gemini-2.5-pro-exp-03-25",
    provider: "google",
    costs: {
      promptTokens: 0.0001,
      completionTokens: 0.0001
    },
    maxTokens: 1000,
    temperature: 0.7
  },
  {
    name: "gemini-2.5-flash-preview-04-17",
    provider: "google",
    costs: {
      promptTokens: 0.0001,
      completionTokens: 0.0001
    },
    maxTokens: 1000,
    temperature: 0.7
  }
];

// Run evaluation for each model
for (const model of models) {
  console.log(`\n=== Running evaluation for ${model.name} (${model.provider}) ===`);
  
  try {
    const result = await evaluation.run({
      model,
      testCases: [testCase]
    });
    
    console.log(`Evaluation completed for ${model.name}`);
    console.log(`Response: ${result.responses[0]?.content?.substring(0, 200)}...`);
  } catch (error) {
    console.error(`Error evaluating ${model.name}:`, error);
  }
}

console.log("\n=== Image Parsing Evaluation Complete ===");