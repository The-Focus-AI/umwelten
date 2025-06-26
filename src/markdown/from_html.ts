import { Stimulus } from "../interaction/stimulus.js";
import { ModelDetails } from "../cognition/types.js";
import { Interaction } from "../interaction/interaction.js";
import { BaseModelRunner } from "../cognition/runner.js";

const markifyUrl = process.env.MARKIFY_URL || "https://markify.fly.dev";

export async function fromHtmlViaModel(html: string, model: ModelDetails) {
  const prompt = new Prompt();
  prompt.addInstruction(
    `You are a helpful assistant that converts html to markdown.`
  );

  prompt.addInstruction(`Convert the html to markdown.`);
  prompt.addInstruction(`Dont add any other text, just the markdown.`);
  prompt.addInstruction(`Keep image links as is`)
  prompt.addInstruction(`Update links to include baseURL when relative links are used`)

  const conversation = new Conversation(model, prompt.getPrompt());
  conversation.addMessage({ role: "user", content: html });
  const modelRunner = new BaseModelRunner();
  const response = await modelRunner.streamText(conversation);
  return response.content;
}

export async function fromHtmlViaMarkify(html: string) {
  const response = await fetch(`${markifyUrl}/html2markdown`, {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
    },
    body: html,
  });
  return response.text();
}
