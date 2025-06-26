import { BaseModelRunner } from "../src/cognition/runner.js";
import { ModelDetails, ModelResponse } from "../src/cognition/types.js";
import { Interaction } from "../src/interaction/interaction.js";
import { evaluate } from "../src/evaluation/evaluate.js";

export async function frankenstein(model: ModelDetails): Promise<ModelResponse> {
  const systemPrompt = "You are a literary critic that writes about books.";
  const prompt = "Who is the monster in Mary Shelley's Frankenstein?";

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

await evaluate(frankenstein, "frankenstein", "ollama-27b", { name: "gemma3:27b", provider: "ollama" });
await evaluate(frankenstein, "frankenstein", "ollama-12b", { name: "gemma3:12b", provider: "ollama" });
await evaluate(frankenstein, "frankenstein", "google-flash", { name: "gemini-2.0-flash", provider: "google" });
await evaluate(frankenstein, "frankenstein", "google-pro", { name: "gemini-2.5-flash", provider: "google" });
