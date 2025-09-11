import { ModelDetails, ModelResponse } from "../src/cognition/types.js";
import { Interaction } from "../src/interaction/interaction.js";
import { Stimulus } from "../src/stimulus/stimulus.js";
import { evaluate } from "../src/evaluation/evaluate.js";

export async function frankenstein(model: ModelDetails): Promise<ModelResponse> {
  const literaryStimulus = new Stimulus({
    role: "literary critic",
    objective: "write about books",
    runnerType: 'base'
  });
  const prompt = "Who is the monster in Mary Shelley's Frankenstein?";

  const interaction = new Interaction(model, literaryStimulus);
  interaction.addMessage({
    role: "user",
    content: prompt,
  });

  console.log(`Generating text for ${model.name}...`);
  const response = await interaction.streamText();

  console.log(`Generated text for ${model.name}:`, response.content);

  return response;
}

await evaluate(frankenstein, "frankenstein", "gpt-oss:20b", { name: "gpt-oss:20b", provider: "ollama" });
await evaluate(frankenstein, "frankenstein", "ollama-27b", { name: "gemma3:27b", provider: "ollama" });
await evaluate(frankenstein, "frankenstein", "ollama-12b", { name: "gemma3:12b", provider: "ollama" });
await evaluate(frankenstein, "frankenstein", "google-flash", { name: "gemini-2.0-flash", provider: "google" });
await evaluate(frankenstein, "frankenstein", "google-pro", { name: "gemini-2.5-flash", provider: "google" });
