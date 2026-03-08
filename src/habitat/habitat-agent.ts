/**
 * HabitatAgent: a sub-agent for a managed project.
 * A HabitatAgent = Stimulus (built from the project's files) + persistent Interaction.
 * Follows the same pattern as loadStimulusOptionsFromWorkDir but reads from
 * the agent's projectPath instead of the habitat's work dir.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Stimulus, StimulusOptions } from "../stimulus/stimulus.js";
import { Interaction } from "../interaction/core/interaction.js";
import { discoverSkillsInDirectory } from "../stimulus/skills/loader.js";
import type { AgentEntry } from "./types.js";
import type { Habitat } from "./habitat.js";
import { fileExists } from "./config.js";
import { createFileTools } from "./tools/file-tools.js";

/**
 * Build a Stimulus from a managed project's files.
 * Reads CLAUDE.md, README.md, package.json, and .claude/ directory
 * from the agent's projectPath to build context.
 */
export async function buildAgentStimulus(
  agent: AgentEntry,
  habitat: Habitat,
): Promise<Stimulus> {
  const projectPath = agent.projectPath;
  const contextParts: string[] = [];
  const runtimeEntryFiles = [
    "run.sh",
    "setup.sh",
    "start.sh",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    ".env.example",
    "Makefile",
  ];

  // Read CLAUDE.md or README.md for project context
  const claudeMd = await readProjectFile(projectPath, "CLAUDE.md");
  const readmeMd = await readProjectFile(projectPath, "README.md");

  if (claudeMd) {
    contextParts.push(`# CLAUDE.md\n\n${claudeMd}`);
  }
  if (readmeMd) {
    contextParts.push(`# README.md\n\n${readmeMd}`);
  }

  const memoryMd = await readOptionalFile(join(habitat.getAgentDir(agent.id), "MEMORY.md"));
  if (memoryMd) {
    contextParts.push(`# MEMORY.md\n\n${memoryMd}`);
  }

  for (const file of runtimeEntryFiles) {
    const content = await readProjectFile(projectPath, file);
    if (content) {
      contextParts.push(`# ${file}\n\n${content}`);
    }
  }

  // Read package.json for project metadata
  const packageJson = await readProjectFile(projectPath, "package.json");
  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson);
      const summary = [
        `# Project: ${pkg.name || agent.name}`,
        pkg.description ? `Description: ${pkg.description}` : "",
        pkg.scripts ? `Scripts: ${Object.keys(pkg.scripts).join(", ")}` : "",
        pkg.dependencies
          ? `Dependencies: ${Object.keys(pkg.dependencies).join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      contextParts.push(summary);
    } catch {
      // Invalid JSON, skip
    }
  }

  // Read .claude/settings.json if present
  const claudeSettings = await readProjectFile(
    projectPath,
    ".claude/settings.json",
  );
  if (claudeSettings) {
    contextParts.push(`# .claude/settings.json\n\n${claudeSettings}`);
  }

  // Read .claude/commands/ directory if present
  const commandsDir = join(projectPath, ".claude", "commands");
  try {
    const entries = await readdir(commandsDir, { withFileTypes: true });
    const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".md"));
    if (mdFiles.length > 0) {
      const commandNames = mdFiles.map((e) => e.name.replace(".md", ""));
      contextParts.push(
        `# Available Claude Commands\n\n${commandNames.join(", ")}`,
      );
    }
  } catch {
    // No commands directory
  }

  // List available bin/ scripts so the agent knows where to inspect next.
  const binDir = join(projectPath, "bin");
  try {
    const entries = await readdir(binDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    if (files.length > 0) {
      contextParts.push(`# bin/\n\n${files.join("\n")}`);

      // Inline bin/* scripts because they often define the actual runtime contract.
      for (const file of files) {
        const content = await readProjectFile(projectPath, join("bin", file));
        if (content) {
          contextParts.push(`# bin/${file}\n\n${content}`);
        }
      }
    }
  } catch {
    // No bin directory
  }

  // Add agent config info
  if (agent.commands) {
    const cmdList = Object.entries(agent.commands)
      .map(([k, v]) => `- ${k}: \`${v}\``)
      .join("\n");
    contextParts.push(`# Configured Commands\n\n${cmdList}`);
  }

  if (agent.logPatterns?.length) {
    const logList = agent.logPatterns
      .map((lp) => `- ${lp.pattern} (${lp.format})`)
      .join("\n");
    contextParts.push(`# Log Patterns\n\n${logList}`);
  }

  const systemContext = contextParts.join("\n\n---\n\n");

  const stimulusOptions: StimulusOptions = {
    role: `habitat agent for ${agent.name}`,
    objective: `understand and manage the ${agent.name} project`,
    instructions: [
      `You are a sub-agent managing the "${agent.name}" project at ${agent.projectPath}.`,
      "Use read_file, list_directory, and ripgrep with agentId to explore the project.",
      "Prefer host-side file tools first when inspecting the repo. Do not use bridge tools unless the user explicitly asks for an isolated runtime or host-side inspection is insufficient.",
      "When asked how the project runs or what it needs, inspect the actual runnable entrypoints first (for example run.sh, setup.sh, start.sh, Makefile targets, Dockerfile, and bin/* scripts) and follow the scripts they invoke. Do not rely only on README or package manifests.",
      "Treat every external executable invoked by those entrypoints as a potential dependency. Explicitly look for required CLIs, environment variables, host integrations, hardcoded absolute paths, and optional fallbacks.",
      "Ignore incidental mentions in reports/, notes, or research documents unless those files are part of the actual runnable path.",
      "Use agent_logs to read log files for this project.",
      `When using file tools, always pass agentId="${agent.id}".`,
      "Provide concise, actionable analysis when asked about the project.",
      "Remember context from previous conversations about this project.",
    ],
    maxToolSteps: 30,
    systemContext,
  };

  const stimulus = new Stimulus(stimulusOptions);

  // Sub-agents must always be able to inspect the managed repo directly,
  // even if the top-level habitat was configured without file tools.
  const fileTools = createFileTools(habitat);
  for (const [name, tool] of Object.entries(fileTools)) {
    stimulus.addTool(name, tool);
  }

  // Register the habitat's tools into this stimulus
  // (they already support agentId scoping)
  const habitatTools = habitat.getTools();
  for (const [name, tool] of Object.entries(habitatTools)) {
    stimulus.addTool(name, tool);
  }

  // Load habitat's shared skills (from git, local skills dirs)
  const habitatSkills = habitat.getSkills();
  if (habitatSkills.length > 0) {
    stimulus.getOrCreateSkillsRegistry().addSkills(habitatSkills);
  }

  // Discover skills in the agent's own repo (e.g. .claude/skills/)
  const agentSkills = await discoverSkillsInDirectory(agent.projectPath);
  if (agentSkills.length > 0) {
    stimulus.getOrCreateSkillsRegistry().addSkills(agentSkills);
  }

  // Add the skills activation tool if any skills were loaded
  stimulus.addSkillsTool();

  return stimulus;
}

/**
 * HabitatAgent: wraps a Stimulus + persistent Interaction for a managed project.
 * The Interaction uses a dedicated session so it persists across restarts.
 */
export class HabitatAgent {
  readonly agent: AgentEntry;
  readonly stimulus: Stimulus;
  private interaction: Interaction;
  private sessionId: string;
  private sessionDir: string;
  private habitat: Habitat;

  private constructor(
    agent: AgentEntry,
    stimulus: Stimulus,
    interaction: Interaction,
    sessionId: string,
    sessionDir: string,
    habitat: Habitat,
  ) {
    this.agent = agent;
    this.stimulus = stimulus;
    this.interaction = interaction;
    this.sessionId = sessionId;
    this.sessionDir = sessionDir;
    this.habitat = habitat;
  }

  /**
   * Create or resume a HabitatAgent.
   * Loads stimulus from the project, creates or resumes a persistent session.
   */
  static async create(
    habitat: Habitat,
    agentEntry: AgentEntry,
  ): Promise<HabitatAgent> {
    const stimulus = await buildAgentStimulus(agentEntry, habitat);

    const sessionId = `habitat-agent-${agentEntry.id}`;
    const { interaction, sessionDir } = await habitat.createInteraction({
      sessionId,
      sessionType: "habitat-agent",
    });

    // Replace the habitat's stimulus with the agent-specific one
    interaction.setStimulus(stimulus);

    return new HabitatAgent(
      agentEntry,
      stimulus,
      interaction,
      sessionId,
      sessionDir,
      habitat,
    );
  }

  /**
   * Get the MCP server port from agent config.
   */
  getMCPPort(): number | undefined {
    return this.agent.mcpPort;
  }

  /**
   * Get the MCP endpoint URL.
   */
  getMCPEndpoint(): string | undefined {
    if (this.agent.mcpPort) {
      return `http://localhost:${this.agent.mcpPort}/mcp`;
    }
    return undefined;
  }

  /**
   * Send a message to the agent and get a response.
   * The agent uses tools to reason about the project.
   */
  async ask(message: string): Promise<string> {
    this.interaction.addMessage({ role: "user", content: message });

    const response = await this.interaction.generateText();

    // Persist transcript
    this.interaction.notifyTranscriptUpdate();

    // Extract text response
    const text = response.content ?? "";
    return text;
  }

  /** Get the underlying interaction for advanced use. */
  getInteraction(): Interaction {
    return this.interaction;
  }

  /** Get the session ID. */
  getSessionId(): string {
    return this.sessionId;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

async function readProjectFile(
  projectPath: string,
  relativePath: string,
): Promise<string | null> {
  const fullPath = join(projectPath, relativePath);
  if (!(await fileExists(fullPath))) return null;
  try {
    const content = await readFile(fullPath, "utf-8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

async function readOptionalFile(path: string): Promise<string | null> {
  if (!(await fileExists(path))) return null;
  try {
    const content = await readFile(path, "utf-8");
    return content.trim() || null;
  } catch {
    return null;
  }
}
