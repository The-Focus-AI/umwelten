import TurndownService from "turndown";
import { Stimulus } from "../stimulus/stimulus.js";
import { ModelDetails } from "../cognition/types.js";
import { Interaction } from "../interaction/interaction.js";

const markifyUrl = process.env.MARKIFY_URL || "https://markify.fly.dev";

let builtInTurndown: TurndownService | null = null;

function getBuiltInTurndown(): TurndownService {
  if (!builtInTurndown) {
    builtInTurndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    });
  }
  return builtInTurndown;
}

/**
 * Convert HTML to markdown using the built-in Turndown library.
 * No network or env vars required.
 */
export function fromHtmlBuiltIn(html: string): string {
  const service = getBuiltInTurndown();
  return service.turndown(html);
}

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

export async function fromHtmlViaMarkify(html: string): Promise<string> {
  const response = await fetch(`${markifyUrl}/html2markdown`, {
    method: "POST",
    headers: {
      "Content-Type": "text/html",
    },
    body: html,
  });
  if (!response.ok) {
    throw new Error(`Markify service error: ${response.status} ${response.statusText}`);
  }
  return response.text();
}
