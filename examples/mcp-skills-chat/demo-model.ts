/**
 * A deterministic stand-in model for running the chat example without API keys.
 *
 * It reads only what a real model would see — the transcript, the `skills`
 * prompt section, and the offered tools — and follows simple rules: pick a
 * skill whose name or description matches the user's words and `skill_load`
 * it; read the first supporting file the loaded skill points to; run the
 * skill's bash block when a `bash` tool is offered; then answer. Pass
 * `--model provider/id` to the chat server to use a real Pi model instead.
 */

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type AssistantMessage,
  type Message,
  type MutableModels,
} from "@earendil-works/pi-ai";

type CatalogEntry = { qualifiedName: string; name: string; description: string; origin: string };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join("\n");
  }
  return "";
}

function currentState(messages: Message[]) {
  const sections: Record<string, string> = {};
  const tools = new Set<string>();
  for (const m of messages) {
    if (m.role !== "system") continue;
    for (const [k, v] of Object.entries(m.sections ?? {})) {
      if (v === null) delete sections[k];
      else sections[k] = v;
    }
    for (const t of m.toolsAdded ?? []) tools.add(t.name);
    for (const t of m.toolsRemoved ?? []) tools.delete(t.name);
  }
  return { sections, tools };
}

function catalogOf(section: string | undefined): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const line of (section ?? "").split("\n")) {
    const m = line.match(/^- (\S+\/(\S+)) — (.*) \(origin: MCP server "([^"]+)"/);
    if (m) out.push({ qualifiedName: m[1]!, name: m[2]!, description: m[3]!, origin: m[4]! });
  }
  return out;
}

const STOP = new Set(["about", "their", "there", "which", "would", "could", "please", "should", "single"]);
function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !STOP.has(w));
}

function pickSkill(userText: string, catalog: CatalogEntry[]): CatalogEntry | undefined {
  const lower = userText.toLowerCase();
  let best: { entry: CatalogEntry; score: number } | undefined;
  for (const entry of catalog) {
    let score = 0;
    if (lower.includes(entry.name.toLowerCase()) || lower.includes(entry.name.replace(/-/g, " "))) score += 5;
    for (const w of new Set(words(`${entry.name.replace(/-/g, " ")} ${entry.description}`))) {
      if (lower.includes(w.slice(0, Math.max(5, w.length - 2)))) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { entry, score };
  }
  return best?.entry;
}

let callSeq = 0;
function call(name: string, args: Record<string, unknown>): AssistantMessage {
  return fauxAssistantMessage([fauxToolCall(name, args as never, { id: `demo-${++callSeq}` })], {
    stopReason: "toolUse",
  });
}

export function demoTurn(messages: Message[]): AssistantMessage {
  const { sections, tools } = currentState(messages);
  const catalog = catalogOf(sections.skills);
  const lastUserIndex = messages.map((m) => m.role).lastIndexOf("user");
  const userText = textOf(messages[lastUserIndex]?.content);
  const turn = messages.slice(lastUserIndex + 1);
  const results = turn.filter((m): m is Extract<Message, { role: "toolResult" }> => m.role === "toolResult");
  const last = turn.at(-1);

  if (!last || last.role === "user") {
    const skill = pickSkill(userText, catalog);
    if (skill) return call("skill_load", { skill: skill.qualifiedName });
    const statusTool = [...tools].find((t) => t.endsWith("__service_status"));
    const service = userText.toLowerCase().match(/\b(api|web|billing)\b/)?.[1];
    if (statusTool && service) return call(statusTool, { service });
    const timeTool = [...tools].find((t) => t.endsWith("__get_time"));
    if (timeTool && /\btime\b/i.test(userText)) return call(timeTool, {});
    return fauxAssistantMessage(
      catalog.length === 0
        ? "No MCP skills are available yet. Connect an MCP server on the left."
        : `I can use these MCP skills: ${catalog.map((c) => `${c.qualifiedName} (${c.description})`).join("; ")}. Tell me what you need.`,
    );
  }

  if (last.role === "toolResult") {
    const loaded = results.find((r) => r.toolName === "skill_load" && !r.isError);
    const loadedText = textOf(loaded?.content);
    if (last.isError) {
      return fauxAssistantMessage(`I could not use ${last.toolName}: ${textOf(last.content)}`);
    }
    if (loaded) {
      const skill = loadedText.match(/name="([^"]+)"/)?.[1] ?? "the skill";
      const origin = loadedText.match(/origin="([^"]+)"/)?.[1] ?? "mcp";
      const files = loadedText.match(/Other files of this skill \(read with skill_read\): (.+)/)?.[1]?.split(", ") ?? [];
      const wanted = files.find((f) => loadedText.includes(f) && !f.startsWith("scripts/"));
      const read = results.filter((r) => r.toolName === "skill_read");
      const qualified = catalog.find((c) => c.name === skill && `mcp:${c.origin}` === origin)?.qualifiedName ?? skill;
      if (wanted && read.length === 0) return call("skill_read", { skill: qualified, path: wanted });
      const bashBlock = loadedText.match(/```(?:bash|sh)\n([\s\S]+?)```/)?.[1]?.trim();
      const ranBash = results.some((r) => r.toolName === "bash");
      if (bashBlock && tools.has("bash") && !ranBash) return call("bash", { command: bashBlock });

      // The skill's instructions: everything between the origin notes and </mcp-skill>,
      // minus headings and code (the code is run or shown separately).
      const inner = loadedText.split("\n").filter((l) => !l.startsWith("<") && !l.startsWith("> "));
      const body = inner
        .join("\n")
        .replace(/```[\s\S]*?```/g, "")
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("#"));
      const extra = read.map((r) => textOf(r.content).split("\n").filter((l) => l.startsWith("- ")).join("\n")).join("\n");
      const bashOut = results.find((r) => r.toolName === "bash");
      return fauxAssistantMessage(
        [
          `Following **${qualified}** (served by ${origin}, verified):`,
          ...body,
          ...(extra ? ["", "House style from the skill's references:", extra] : []),
          ...(bashOut ? ["", "Collected on this host:", "```", textOf(bashOut.content).trim(), "```"] : []),
          ...(bashBlock && !tools.has("bash") ? ["", "(The skill wants to run a command, but this host has no bash tool.)"] : []),
          "",
          "(I'm the offline demo model, so I can show what the skill tells me to do but not actually do it. Start the agent with `--model provider:id` (e.g. `google:gemini-3-flash-preview`) for real answers.)",
        ].join("\n"),
      );
    }
    return fauxAssistantMessage(`Result from ${last.toolName}: ${textOf(last.content)}`);
  }

  return fauxAssistantMessage("…");
}

/** Install the demo model as provider `demo`, model `skills-demo`, answering forever. */
export function installDemoModel(models: MutableModels): { provider: string; modelId: string; topUp(): void } {
  const faux = fauxProvider({ provider: "demo", models: [{ id: "skills-demo" }] });
  models.setProvider(faux.provider);
  const step = (context: { messages: Message[] }) => demoTurn(context.messages);
  const topUp = () => {
    const missing = 50 - faux.getPendingResponseCount();
    if (missing > 0) faux.appendResponses(Array.from({ length: missing }, () => step));
  };
  topUp();
  return { provider: "demo", modelId: "skills-demo", topUp };
}
