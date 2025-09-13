import { Stimulus } from "../src/stimulus/stimulus.js";
import { Interaction } from "../src/interaction/interaction.js";
import { evaluate } from "../src/evaluation/evaluate.js";
import { ModelDetails, ModelResponse } from "../src/cognition/types.js";

export async function catPoem(model: ModelDetails) : Promise<ModelResponse> {
  const poemStimulus = new Stimulus({
    role: "literary genius", 
    objective: "write short poems about cats",
    temperature: 0.5,
    maxTokens: 200,
    runnerType: 'base'
  });
  const interaction = new Interaction(model, poemStimulus);

  console.log(`Generating cat poem for ${model.name}...`);
  
  // Use streamText directly for better control over streaming
  interaction.addMessage({ role: "user", content: "Write a short poem about a cat." });
  const response = await interaction.streamText();
  
  console.log(`Generated poem for ${model.name}:`, response.content);
  return response;
}

const models: ModelDetails[] = [
  { name: "gemma3:27b", provider: "ollama", temperature: 0.5 },
  { name: "gemma3:12b", provider: "ollama", temperature: 0.5 },
  { name: "gemini-2.0-flash", provider: "google" },
  { name: "gemini-2.5-flash", provider: "google" },
  { name: "gemini-2.5-pro", provider: "google" },
];

for (const model of models) {
  evaluate(catPoem, "cat-poem", model.name, model);
}
