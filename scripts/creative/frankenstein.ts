import { ModelDetails, ModelResponse } from "../src/cognition/types.js";
import { Interaction } from "../src/interaction/interaction.js";
import { LiteraryAnalysisTemplate } from "../src/stimulus/templates/creative-templates.js";
import { SimpleEvaluation } from "../src/evaluation/strategies/simple-evaluation.js";

export async function frankenstein(model: ModelDetails): Promise<ModelResponse> {
  const interaction = new Interaction(model, LiteraryAnalysisTemplate);
  interaction.addMessage({
    role: "user",
    content: "Who is the monster in Mary Shelley's Frankenstein?",
  });

  console.log(`Generating text for ${model.name}...`);
  const response = await interaction.streamText();

  console.log(`Generated text for ${model.name}:`, response.content);

  return response;
}

// Create evaluation using new infrastructure
const evaluation = new SimpleEvaluation({
  id: "frankenstein",
  name: "Frankenstein Literary Analysis",
  description: "Test literary analysis capabilities using Mary Shelley's Frankenstein"
});

// Define the test case
const testCase = {
  id: "frankenstein-analysis",
  name: "Frankenstein Analysis Test",
  stimulus: LiteraryAnalysisTemplate,
  input: {
    prompt: "Who is the monster in Mary Shelley's Frankenstein?"
  }
};

// Define models to test
const models = [
  { name: "gpt-oss:20b", provider: "ollama" },
  { name: "gemma3:27b", provider: "ollama" },
  { name: "gemma3:12b", provider: "ollama" },
  { name: "gemini-2.0-flash", provider: "google" },
  { name: "gemini-2.5-flash", provider: "google" }
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

console.log("\n=== Frankenstein Literary Analysis Complete ===");
