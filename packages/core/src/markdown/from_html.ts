import TurndownService from "turndown";

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
 * Strip <style> and <script> blocks so Turndown doesn't emit CSS/JS as raw text.
 * Improves markdown quality for JS-heavy pages (e.g. Substack, SPA).
 */
function stripNonContent(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
}

/**
 * Convert HTML to markdown using the built-in Turndown library.
 * Strips <style> and <script> before conversion. No network or env vars required.
 */
export function fromHtmlBuiltIn(html: string): string {
  const cleaned = stripNonContent(html);
  const service = getBuiltInTurndown();
  return service.turndown(cleaned);
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
