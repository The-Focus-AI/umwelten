import { Stimulus } from "../stimulus/stimulus.js";
import { ModelDetails } from "../cognition/types.js";
import { Interaction } from "../interaction/interaction.js";

const markifyUrl = process.env.MARKIFY_URL || "https://markify.fly.dev";

export async function fromHtmlViaModel(html: string, model: ModelDetails) {
  const stimulus = new Stimulus({
    role: "helpful assistant",
    objective: "convert html to markdown",
    instructions: [
      "You are a helpful assistant that converts html to markdown.",
      "Convert the html to markdown.",
      "Don't add any other text, just the markdown.",
      "Keep image links as is",
      "Update links to include baseURL when relative links are used"
    ],
    runnerType: 'base'
  });

  const interaction = new Interaction(model, stimulus);
  interaction.addMessage({ role: "user", content: html });
  const response = await interaction.streamText();
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
