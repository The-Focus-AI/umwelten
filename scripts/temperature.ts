import { BaseModelRunner } from "../src/cognition/runner.js";
import { ModelDetails, ModelResponse } from "../src/cognition/types.js";
import { Interaction } from "../src/interaction/interaction.js";

export async function catPoem(model: ModelDetails): Promise<ModelResponse> {
  const systemPrompt = "You are a helpful assistant that writes short poems about cats.";
  const prompt = "Write a short poem about a cat.";

  const modelRunner = new BaseModelRunner();
  const conversation = new Interaction(model, systemPrompt);
  conversation.addMessage({
    role: "user",
    content: prompt,
  });

  console.log(`Generating text for ${model.name} using BaseModelRunner...`);
  const response = await modelRunner.generateText(conversation);

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

