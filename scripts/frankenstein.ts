import { BaseModelRunner } from "../src/models/runner.js";
import { ModelDetails, ModelResponse } from "../src/models/types.js";
import { Conversation } from "../src/conversation/conversation.js";
import { evaluate } from "../src/evaluation/evaluate.js";

export async function frankenstein(model: ModelDetails): Promise<ModelResponse> {
  const systemPrompt = "You are a literary critic that writes about books.";
  const prompt = "Who is the monster in Mary Shelley's Frankenstein?";

  const modelRunner = new BaseModelRunner();
  const conversation = new Conversation(model, systemPrompt);
  conversation.addMessage({
    role: "user",
    content: prompt,
  });

  console.log(`Generating text for ${model.name} using BaseModelRunner...`);
  // console.log(JSON.stringify(conversation, null, 2));
  const response = await modelRunner.generateText(conversation);

  console.log(`Generated text for ${model.name}:`, response.content);

  return response;
}

await evaluate(frankenstein, "frankenstein", {
  name: "gemma3:latest",
  provider: "ollama",
});

await evaluate(frankenstein, "frankenstein", {
  name: "gemma3:12b",
  provider: "ollama",
});


await evaluate(frankenstein, "frankenstein", {
  name: "gemini-2.0-flash",
  provider: "google",
});

await evaluate(frankenstein, "frankenstein", {
  name: "gemini-2.5-pro-exp-03-25",
  provider: "google",
});
