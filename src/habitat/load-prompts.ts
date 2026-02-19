/**
 * Load stimulus options from a habitat work directory.
 * Reads STIMULUS.md (or config.stimulusFile / prompts/) and AGENT.md,
 * plus optional memory files when config.memoryFiles.enabled is true.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import type { StimulusOptions } from "../stimulus/stimulus.js";
import type { HabitatConfig } from "./types.js";
import { fileExists } from "./config.js";

const DEFAULT_STIMULUS_BODY = `# Persona

You are a helpful assistant. Edit STIMULUS.md in your work directory to customize your persona and instructions.
`;

const DEFAULT_INSTRUCTIONS = [
  "Be concise and precise.",
  'Use current_time when the user asks for the time, date, or "now".',
  "Use the search tool when the user asks for current information or to look something up on the web.",
  "For fetching web content, prefer markify over wget. Use markify to convert webpages to readable markdown.",
  "Use parse_feed for RSS, Atom, or XML feed URLs.",
  'File operations: paths are relative to the work directory (or to the agent project if agentId is set). Use list_directory with path "." to list the work dir.',
  "When listing or showing external interactions, always identify the agent by id or name first.",
  "Secrets in agent config are references only (env var names); never store or echo secret values.",
  "For current date or time, use the current_time tool instead of guessing.",
  "When cloning an agent with agent_clone, it automatically starts a BridgeAgent in a Dagger container - no model configuration needed.",
  "IMPORTANT: agent_ask requires a configured model for the sub-agent. If no model is configured, use bridge_create instead for containerized execution.",
  "Bridge agents run in containers without needing LLM configuration - they use the Bridge MCP server for file/exec operations.",
  "SECURITY CRITICAL: Never use export, variables, or template literals in exec commands. BAD: exec('export TOKEN=secret && curl -H $TOKEN'). GOOD: Pass secrets via the env parameter only. Variables in command strings can leak in logs and process listings.",
  "Bridge containers inject secrets via environment variables securely - they are never exposed in command strings or logs.",
];

function normalizeInstructions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string") {
    return value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

async function loadStimulusFile(
  workDir: string,
  stimulusFile?: string,
): Promise<{ data: Record<string, unknown>; body: string } | null> {
  const candidates = stimulusFile
    ? [join(workDir, stimulusFile)]
    : [
        join(workDir, "STIMULUS.md"),
        join(workDir, "prompts", "main.md"),
        join(workDir, "prompts", "persona.md"),
      ];
  for (const path of candidates) {
    if (await fileExists(path)) {
      const content = await readFile(path, "utf-8");
      const { data, content: body } = matter(content);
      return { data: data as Record<string, unknown>, body: body.trim() };
    }
  }
  return null;
}

async function loadPromptsDirectory(workDir: string): Promise<string> {
  const promptsDir = join(workDir, "prompts");
  try {
    const entries = await readdir(promptsDir, { withFileTypes: true });
    const mdFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort();
    const parts: string[] = [];
    for (const name of mdFiles) {
      const content = await readFile(join(promptsDir, name), "utf-8");
      const parsed = matter(content);
      parts.push(parsed.content.trim());
    }
    return parts.join("\n\n---\n\n");
  } catch {
    return "";
  }
}

async function loadAgentMd(workDir: string): Promise<string | null> {
  const path = join(workDir, "AGENT.md");
  try {
    const content = await readFile(path, "utf-8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

async function loadMemoryFile(
  workDir: string,
  filename: string,
): Promise<string | null> {
  const path = join(workDir, filename);
  try {
    const content = await readFile(path, "utf-8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Load stimulus options from the work directory.
 * - Reads STIMULUS.md (or config.stimulusFile) with YAML frontmatter.
 * - Appends AGENT.md if present.
 * - Optionally loads memory files when config.memoryFiles.enabled is true.
 */
export async function loadStimulusOptionsFromWorkDir(
  workDir: string,
  config: HabitatConfig,
): Promise<Partial<StimulusOptions> & { systemContext: string }> {
  const stimulusSource = await loadStimulusFile(workDir, config.stimulusFile);
  let role = "assistant";
  let objective: string | undefined;
  let instructions = DEFAULT_INSTRUCTIONS;
  let maxToolSteps = 50;
  let stimulusBody: string;

  if (stimulusSource) {
    const { data, body } = stimulusSource;
    if (data.role != null && typeof data.role === "string") role = data.role;
    if (data.objective != null && typeof data.objective === "string")
      objective = data.objective;
    if (data.maxToolSteps != null && typeof data.maxToolSteps === "number")
      maxToolSteps = data.maxToolSteps;
    const fromFile = normalizeInstructions(data.instructions);
    if (fromFile.length > 0) instructions = fromFile;
    stimulusBody = body || DEFAULT_STIMULUS_BODY;
  } else {
    const promptsDirContent = await loadPromptsDirectory(workDir);
    stimulusBody = promptsDirContent || DEFAULT_STIMULUS_BODY;
  }

  const agentMd = await loadAgentMd(workDir);

  const systemContextParts: string[] = [stimulusBody];
  if (agentMd) systemContextParts.push(agentMd);

  // Memory files: only load when explicitly enabled
  if (config.memoryFiles?.enabled) {
    const memoryFileNames = config.memoryFiles.files ?? [];
    for (const filename of memoryFileNames) {
      const content = await loadMemoryFile(workDir, filename);
      if (content) {
        // For the last file in the list, show only recent entries (last 20 lines)
        const isLast = filename === memoryFileNames[memoryFileNames.length - 1];
        if (isLast && memoryFileNames.length > 1) {
          const lines = content.split("\n");
          const recent = lines.slice(-20).join("\n");
          systemContextParts.push(`## ${filename}\n\n${recent}`);
        } else {
          systemContextParts.push(`## ${filename}\n\n${content}`);
        }
      }
    }
  }

  const systemContext = systemContextParts.join("\n\n---\n\n");

  return {
    role,
    ...(objective && { objective }),
    instructions,
    maxToolSteps,
    systemContext,
  };
}
