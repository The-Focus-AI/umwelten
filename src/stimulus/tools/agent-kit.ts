/**
 * createAgentKit — one-shot factory for an "agent in a box".
 *
 * Given a workspace directory, returns:
 *   - a sandboxed tool record (read, write, create_directory, list_directory, ripgrep, bash)
 *   - optional `systemContext` loaded from <workspace>/AGENTS.md
 *   - optional `skill` tool wired to <workspace>/skills/ (auto-discovered)
 *
 * Drop the result into a Stimulus:
 *
 * ```ts
 * const kit = await createAgentKit({ workspaceDir: './workspace' });
 * const stimulus = new Stimulus({
 *   role: '...',
 *   systemContext: kit.systemContext,
 *   tools: kit.tools,
 * });
 * ```
 *
 * SECURITY NOTE: the bash tool is NOT confined to the workspace — it just sets
 * cwd. See bash-tool.ts for details.
 */

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tool } from 'ai';
import { createFsTools } from './fs-tools.js';
import { createBashTool } from './bash-tool.js';
import { loadSkillsFromDirectory, SkillsRegistry, createSkillTool } from '../skills/index.js';

export interface AgentKitOptions {
  /** Workspace directory. Becomes the primary sandbox root and bash cwd. */
  workspaceDir: string;
  /**
   * Additional read/write/list/grep allowed roots. Useful for letting the agent
   * read its own source tree, a sibling project, etc. Bash cwd is always
   * `workspaceDir` regardless.
   */
  extraRoots?: string[];
  /** Override skills dir (default: <workspaceDir>/skills if it exists). */
  skillsDir?: string;
  /** Override AGENTS.md path (default: <workspaceDir>/AGENTS.md if it exists). */
  agentsMdPath?: string;
  /** Bash timeout ms (default: 30_000). */
  bashTimeoutMs?: number;
  /** Extra env vars passed to bash. */
  bashEnv?: Record<string, string>;
}

export interface AgentKit {
  /** Tool record ready to attach to `Stimulus.tools`. */
  tools: Record<string, Tool>;
  /** AGENTS.md contents if found, else undefined. Pass to `Stimulus.systemContext`. */
  systemContext?: string;
  /** Names of skills auto-discovered under skillsDir (empty if no skills/ dir). */
  skills: string[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function createAgentKit(opts: AgentKitOptions): Promise<AgentKit> {
  const { workspaceDir } = opts;
  const roots = [workspaceDir, ...(opts.extraRoots ?? [])];

  const tools: Record<string, Tool> = {
    ...createFsTools(roots),
    bash: createBashTool({
      cwd: workspaceDir,
      timeoutMs: opts.bashTimeoutMs,
      env: opts.bashEnv,
    }),
  };

  let systemContext: string | undefined;
  const agentsMdPath = opts.agentsMdPath ?? join(workspaceDir, 'AGENTS.md');
  if (await exists(agentsMdPath)) {
    systemContext = await readFile(agentsMdPath, 'utf-8');
  }

  const skillsDir = opts.skillsDir ?? join(workspaceDir, 'skills');
  let skills: string[] = [];
  if (await exists(skillsDir)) {
    const defs = await loadSkillsFromDirectory(skillsDir);
    if (defs.length > 0) {
      const registry = new SkillsRegistry();
      registry.addSkills(defs);
      tools.skill = createSkillTool(registry);
      skills = defs.map((d) => d.name);
    }
  }

  return { tools, systemContext, skills };
}
