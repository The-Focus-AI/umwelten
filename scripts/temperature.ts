import { ModelDetails, ModelResponse } from "../src/cognition/types.js";
import { Interaction } from "../src/interaction/interaction.js";
import { Stimulus } from "../src/stimulus/stimulus.js";

export async function catPoem(model: ModelDetails): Promise<ModelResponse> {
  const prompt = "Write a short poem about a cat.";

  const stimulus = new Stimulus({
    role: "helpful assistant",
    objective: "write short poems about cats",
    instructions: [
      "You are a helpful assistant that writes short poems about cats",
      "Write creative and engaging poems",
      "Keep poems short and focused"
    ],
    runnerType: 'base'
  });

  const interaction = new Interaction(model, stimulus);
  interaction.addMessage({
    role: "user",
    content: prompt,
  });

  console.log(`Generating text for ${model.name}...`);
  const response = await interaction.streamText();

  console.log(`Generated text for ${model.name}:`, response.content);

  return response;
}

let response = await catPoem({
  name: "gemma3:27b",
  provider: "ollama",
  temperature: 2,
});

response = await catPoem({
  name: "gemma3:27b",
  provider: "ollama",
  temperature: 0.5,
});

