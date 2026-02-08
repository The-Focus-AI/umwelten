/**
 * HabitatAgent: a sub-agent for a managed project.
 * A HabitatAgent = Stimulus (built from the project's files) + persistent Interaction.
 * Follows the same pattern as loadStimulusOptionsFromWorkDir but reads from
 * the agent's projectPath instead of the habitat's work dir.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Stimulus, StimulusOptions } from '../stimulus/stimulus.js';
import { Interaction } from '../interaction/core/interaction.js';
import type { AgentEntry } from './types.js';
import type { Habitat } from './habitat.js';
import { fileExists } from './config.js';

/**
 * Build a Stimulus from a managed project's files.
 * Reads CLAUDE.md, README.md, package.json, and .claude/ directory
 * from the agent's projectPath to build context.
 */
export async function buildAgentStimulus(
  agent: AgentEntry,
  habitat: Habitat
): Promise<Stimulus> {
  const projectPath = agent.projectPath;
  const contextParts: string[] = [];

  // Read CLAUDE.md or README.md for project context
  const claudeMd = await readProjectFile(projectPath, 'CLAUDE.md');
  const readmeMd = await readProjectFile(projectPath, 'README.md');

  if (claudeMd) {
    contextParts.push(`# CLAUDE.md\n\n${claudeMd}`);
  }
  if (readmeMd) {
    contextParts.push(`# README.md\n\n${readmeMd}`);
  }

  // Read package.json for project metadata
  const packageJson = await readProjectFile(projectPath, 'package.json');
  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson);
      const summary = [
        `# Project: ${pkg.name || agent.name}`,
        pkg.description ? `Description: ${pkg.description}` : '',
        pkg.scripts ? `Scripts: ${Object.keys(pkg.scripts).join(', ')}` : '',
        pkg.dependencies ? `Dependencies: ${Object.keys(pkg.dependencies).join(', ')}` : '',
      ].filter(Boolean).join('\n');
      contextParts.push(summary);
    } catch {
      // Invalid JSON, skip
    }
  }

  // Read .claude/settings.json if present
  const claudeSettings = await readProjectFile(projectPath, '.claude/settings.json');
  if (claudeSettings) {
    contextParts.push(`# .claude/settings.json\n\n${claudeSettings}`);
  }

  // Read .claude/commands/ directory if present
  const commandsDir = join(projectPath, '.claude', 'commands');
  try {
    const entries = await readdir(commandsDir, { withFileTypes: true });
    const mdFiles = entries.filter(e => e.isFile() && e.name.endsWith('.md'));
    if (mdFiles.length > 0) {
      const commandNames = mdFiles.map(e => e.name.replace('.md', ''));
      contextParts.push(`# Available Claude Commands\n\n${commandNames.join(', ')}`);
    }
  } catch {
    // No commands directory
  }

  // Add agent config info
  if (agent.commands) {
    const cmdList = Object.entries(agent.commands)
      .map(([k, v]) => `- ${k}: \`${v}\``)
      .join('\n');
    contextParts.push(`# Configured Commands\n\n${cmdList}`);
  }

  if (agent.logPatterns?.length) {
    const logList = agent.logPatterns
      .map(lp => `- ${lp.pattern} (${lp.format})`)
      .join('\n');
    contextParts.push(`# Log Patterns\n\n${logList}`);
  }

  const systemContext = contextParts.join('\n\n---\n\n');

  const stimulusOptions: StimulusOptions = {
    role: `habitat agent for ${agent.name}`,
    objective: `understand and manage the ${agent.name} project`,
    instructions: [
      `You are a sub-agent managing the "${agent.name}" project at ${agent.projectPath}.`,
      'Use read_file, list_directory, and ripgrep with agentId to explore the project.',
      'Use agent_logs to read log files for this project.',
      `When using file tools, always pass agentId="${agent.id}".`,
      'Provide concise, actionable analysis when asked about the project.',
      'Remember context from previous conversations about this project.',
    ],
    maxToolSteps: 30,
    systemContext,
  };

  const stimulus = new Stimulus(stimulusOptions);

  // Register the habitat's tools into this stimulus
  // (they already support agentId scoping)
  const habitatTools = habitat.getTools();
  for (const [name, tool] of Object.entries(habitatTools)) {
    stimulus.addTool(name, tool);
  }

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

  private constructor(
    agent: AgentEntry,
    stimulus: Stimulus,
    interaction: Interaction,
    sessionId: string,
    sessionDir: string
  ) {
    this.agent = agent;
    this.stimulus = stimulus;
    this.interaction = interaction;
    this.sessionId = sessionId;
    this.sessionDir = sessionDir;
  }

  /**
   * Create or resume a HabitatAgent.
   * Loads stimulus from the project, creates or resumes a persistent session.
   */
  static async create(habitat: Habitat, agentEntry: AgentEntry): Promise<HabitatAgent> {
    const stimulus = await buildAgentStimulus(agentEntry, habitat);

    const sessionId = `habitat-agent-${agentEntry.id}`;
    const { interaction, sessionDir } = await habitat.createInteraction({
      sessionId,
      sessionType: 'habitat-agent',
    });

    // Replace the habitat's stimulus with the agent-specific one
    interaction.setStimulus(stimulus);

    return new HabitatAgent(agentEntry, stimulus, interaction, sessionId, sessionDir);
  }

  /**
   * Send a message to the agent and get a response.
   * The agent uses tools to reason about the project.
   */
  async ask(message: string): Promise<string> {
    this.interaction.addMessage({ role: 'user', content: message });

    const response = await this.interaction.generateText();

    // Persist transcript
    this.interaction.notifyTranscriptUpdate();

    // Extract text response
    const text = response.text ?? '';
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

async function readProjectFile(projectPath: string, relativePath: string): Promise<string | null> {
  const fullPath = join(projectPath, relativePath);
  if (!await fileExists(fullPath)) return null;
  try {
    const content = await readFile(fullPath, 'utf-8');
    return content.trim() || null;
  } catch {
    return null;
  }
}
