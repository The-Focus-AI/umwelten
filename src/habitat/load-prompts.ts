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
  // General behavior
  "Be concise and precise.",
  'Use current_time when the user asks for the time, date, or "now".',
  "Use the search tool when the user asks for current information or to look something up on the web.",
  "For fetching web content, prefer markify over wget. Use markify to convert webpages to readable markdown.",
  "Use parse_feed for RSS, Atom, or XML feed URLs.",
  'File operations: paths are relative to the work directory (or to the agent project if agentId is set). Use list_directory with path "." to list the work dir.',
  "When listing or showing external interactions, always identify the agent by id or name first.",
  "For current date or time, use the current_time tool instead of guessing.",

  // Secrets
  "Secrets in agent config are references only (env var names); never store or echo secret values.",
  "SECURITY CRITICAL: Never use export, variables, or template literals in exec commands. BAD: exec('export TOKEN=secret && curl -H $TOKEN'). GOOD: Pass secrets via the env parameter only. Variables in command strings can leak in logs and process listings.",
  "Bridge containers inject secrets via environment variables securely - they are never exposed in command strings or logs.",
  "After setting a secret with secrets_set, you MUST bridge_stop then bridge_start to restart the container with the new secret injected. Secrets are only injected at container build time, not into running containers.",

  // Managed agents + optional bridge runtimes
  "Use agent_clone to add an agent from a git repo. This clones the repo into the habitat workspace and registers it as a managed agent on the host filesystem.",
  "Use agent_ask to inspect and manage cloned agents through their host-side project workspace.",
  "Use bridge_start, bridge_ls, bridge_read, and bridge_exec only when a project needs an isolated runtime.",
  "IMPORTANT: agent_ask requires a configured model for the sub-agent. If no model is configured and you need isolated execution, use bridge_start and then bridge_exec/bridge_read/bridge_ls.",
  "If you start a bridge, the supervisor monitors container health for that runtime.",

  // Running scripts in bridge containers
  "CRITICAL — RUNNING SCRIPTS IN BRIDGED AGENTS: When the user asks you to run a script inside an isolated agent runtime, call `bridge_exec(agentId, './run.sh')` immediately as your first action. Do not manually decompose the script before trying the top-level entrypoint.",
  "ABSOLUTELY FORBIDDEN: Never run a script's steps manually one-by-one. If a script calls sub-scripts, you run the TOP-LEVEL script only. You do not replicate the pipeline by calling curl, grep, or other commands yourself. The script is the entry point — run it, don't decompose it.",
  "ABSOLUTELY FORBIDDEN: Never create mock, dummy, or fake scripts to replace missing tools. Never create shim scripts that pretend to be a real tool (e.g. a fake 'claude' CLI, fake 'chrome-driver', fake 'op'). If a required tool is missing, STOP and tell the user what is missing and what needs to be installed. Do not fake success.",
  "ABSOLUTELY FORBIDDEN: Never rewrite or modify the project's existing scripts to work around missing dependencies. The scripts are the source of truth. If a script requires a tool that isn't installed, install the real tool or report the failure honestly.",
  "When a script fails, report the ACTUAL error output. Do not hide failures behind mock implementations or manual workarounds.",

  // Installing tools in bridge containers
  "CRITICAL — INSTALLING CLAUDE CLI: When a project needs the `claude` CLI, ALWAYS install it with the official script: `curl -fsSL https://claude.ai/install.sh | bash`. NEVER install via npm (`npm install -g @anthropic/claude-cli` or similar). The official script is the only supported method.",
  "When you discover missing tools in a bridge container (from actual error output), install only what the error says is missing. Do NOT preemptively install packages. Only install a tool after a script fails because that specific tool is not found.",

  // Session and debugging tools
  "Use sessions_list and sessions_show to review previous conversation history when debugging issues or understanding what happened in past interactions.",
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
