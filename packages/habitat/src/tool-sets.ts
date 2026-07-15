/**
 * Habitat tool sets: named collections of tools that can be registered together.
 */

import type { Tool } from "ai";
import type { Habitat } from "./habitat.js";
import { createFileTools } from "./tools/file-tools.js";
import { currentTimeTool } from "./tools/time-tools.js";
import { createAgentTools } from "./tools/agent-tools.js";
import { createSessionTools } from "./tools/session-tools.js";
import { createExternalInteractionTools } from "./tools/external-interaction-tools.js";
import { createAgentRunnerTools } from "./tools/agent-runner-tools.js";
import { createSecretsTools } from "./tools/secrets-tools.js";
import { createSearchTools } from "./tools/search-tools.js";
import { createSelfModifyTools } from "./tools/self-modify-tools.js";
import { createInspectTools } from "./tools/inspect-tools.js";
import { createRemoteAgentTools } from "./tools/remote-agent-tools.js";
import {
  wgetTool,
  markifyTool,
  parseFeedTool,
  setDownloadsDir,
} from "@umwelten/core/stimulus/tools/url-tools.js";
import { createExecTools } from "./tools/exec-tools.js";
import { createProvisionTools } from "./tools/provision-tools.js";
import { createArtifactTools } from "./tools/artifact-tools.js";
import { createUIResourceTools } from "./tools/ui-resource-tools.js";
import { createRoomHistoryTools } from "./tools/room-history-tools.js";
import { resolveProjectDir } from "./config.js";
import { accessSync } from "node:fs";

/**
 * A ToolSet is a named collection of tools that can be registered together.
 */
export interface ToolSet {
  name: string;
  description: string;
  /** Factory that creates tools given the habitat context. */
  createTools(habitat: Habitat): Record<string, Tool>;
}

/** File operations: read, write, list, ripgrep -- sandboxed to habitat's allowed roots. */
export const fileToolSet: ToolSet = {
  name: "file-operations",
  description: "Read, write, list, and search files within the habitat",
  createTools: (habitat) => createFileTools(habitat),
};

/** Time: current_time tool. */
export const timeToolSet: ToolSet = {
  name: "time",
  description: "Get current date and time",
  createTools: () => ({ current_time: currentTimeTool }),
};

/** URL operations: wget, markify, parse_feed. Already in src/stimulus/tools/. */
export const urlToolSet: ToolSet = {
  name: "url-operations",
  description: "Fetch URLs, convert to markdown, parse feeds",
  createTools: (habitat) => {
    // Configure downloads to go inside the habitat work dir so read_file can access them
    setDownloadsDir(`${habitat.getWorkDir()}/downloads`);
    return {
      wget: wgetTool,
      markify: markifyTool,
      parse_feed: parseFeedTool,
    };
  },
};

/** Agent CRUD: list, add, update, remove agents. */
export const agentToolSet: ToolSet = {
  name: "agent-management",
  description: "Manage agents (other habitats)",
  createTools: (habitat) => createAgentTools(habitat),
};

/** Session tools: list, show, messages, stats, inspect, read_file. */
export const sessionToolSet: ToolSet = {
  name: "session-management",
  description: "List and inspect sessions",
  createTools: (habitat) => createSessionTools(habitat),
};

/** External interaction tools: list, show, messages, stats for agent interactions. */
export const externalInteractionToolSet: ToolSet = {
  name: "external-interactions",
  description: "Read Claude Code/Cursor conversation history for agents",
  createTools: (habitat) => createExternalInteractionTools(habitat),
};

/** Agent runner tools: agent_clone, agent_logs, agent_status, agent_ask. */
export const agentRunnerToolSet: ToolSet = {
  name: "agent-runner",
  description: "Clone, monitor, and delegate to managed agent sub-agents",
  createTools: (habitat) => createAgentRunnerTools(habitat),
};

/** Secrets management: set, remove, list secrets in the habitat store. */
export const secretsToolSet: ToolSet = {
  name: "secrets",
  description: "Manage secrets (API keys, tokens) in the habitat secret store",
  createTools: (habitat) => createSecretsTools(habitat),
};

/** Web search via Tavily. Reads TAVILY_API_KEY from habitat secrets or env. */
export const searchToolSet: ToolSet = {
  name: "search",
  description: "Search the web for current information",
  createTools: (habitat) => createSearchTools(habitat),
};

/** Shell execution: run commands in the habitat work directory. */
export const execToolSet: ToolSet = {
  name: "exec",
  description: "Execute shell commands in the habitat work directory",
  createTools: (habitat) =>
    createExecTools({
      getWorkDir: () => habitat.getWorkDir(),
      getProjectDir: () => {
        const config = habitat.getConfig();
        if (config.gitUrl) {
          const projectDir = resolveProjectDir(habitat.getWorkDir(), config);
          try {
            accessSync(projectDir);
            return projectDir;
          } catch {
            return undefined;
          }
        }
        return undefined;
      },
      findReadOnlyAgentForPath: (absPath: string) =>
        habitat.findReadOnlyAgentForPath(absPath),
    }),
};

/** Provisioning: clone git repos, install runtimes via mise, declare secrets. */
export const provisionToolSet: ToolSet = {
  name: "provisioning",
  description:
    "Reproducible habitat provisioning: clone project, install runtimes, manage required secrets",
  createTools: (habitat) =>
    createProvisionTools({
      getWorkDir: () => habitat.getWorkDir(),
      getConfig: () => habitat.getConfig(),
      getConfigPath: () => habitat.configPath,
      reloadConfig: () => habitat.reloadConfig().then(() => {}),
    }),
};

/** Artifacts: publish files as named, timestamped artifacts with metadata. */
export const artifactToolSet: ToolSet = {
  name: "artifacts",
  description: "Publish and list artifacts (files shared with the user)",
  createTools: (habitat) =>
    createArtifactTools({
      getWorkDir: () => habitat.getWorkDir(),
      getSessionId: () => (habitat as any)._currentSessionId,
      // Absolutize the model-facing artifact URL when a public origin is known
      // (#194). The tool runs with no inbound request, so fall back to BASE_URL
      // (set per child by Gaia / in prod). Undefined ⇒ relative URL (local dev).
      getPublicOrigin: () => {
        const base = process.env.BASE_URL?.trim();
        return base ? base.replace(/\/$/, "") : undefined;
      },
    }),
};

export const uiResourceToolSet: ToolSet = {
  name: "ui-resources",
  description: "Emit renderable mcp-ui UI resources (charts, forms, cards) to the user",
  createTools: (habitat) =>
    createUIResourceTools({
      getWorkDir: () => habitat.getWorkDir(),
      // Absolutize a relative externalUrl against the public origin (#194);
      // BASE_URL is set per child by Gaia / in prod. Undefined ⇒ left relative.
      getPublicOrigin: () => {
        const base = process.env.BASE_URL?.trim();
        return base ? base.replace(/\/$/, "") : undefined;
      },
    }),
};

/**
 * Remote habitats: ask_remote_agent — A2A message/send to peers declared in
 * config.agents[] with kind "remote-habitat" (e.g. the Gaia orchestrator).
 * Registers no tools when the habitat declares no remote peers.
 */
export const remoteAgentToolSet: ToolSet = {
  name: "remote-agents",
  description: "Talk to remote habitats (A2A) declared in this habitat's config",
  createTools: (habitat) =>
    createRemoteAgentTools({
      getConfig: () => habitat.getConfig(),
      getSecret: (name) => habitat.getSecret(name),
    }),
};

/** Self-modification: create/remove/reload tools and skills at runtime. */
export const selfModifyToolSet: ToolSet = {
  name: "self-modify",
  description:
    "Create, remove, and reload custom tools and skills at runtime",
  createTools: (habitat) => createSelfModifyTools(habitat),
};

/** Skill / agent inspection: discovers requirements without mutating anything. */
export const inspectToolSet: ToolSet = {
  name: "inspect",
  description:
    "Inspect skills and aggregate provisioning requirements (env vars, CLI tools)",
  createTools: (habitat) =>
    createInspectTools({
      getSkills: () => habitat.getSkills(),
      computeRequirements: () => habitat.computeRequirements(),
    }),
};

/** All standard tool sets that a typical habitat includes (host orchestrator). */
/** Room history (#102 v2): pull the SaaS room's recent discussion on demand. */
export const roomHistoryToolSet: ToolSet = {
  name: "room-history",
  description:
    "Fetch the recent discussion from the habitats room this conversation lives in",
  createTools: () => createRoomHistoryTools(),
};

export const standardToolSets: ToolSet[] = [
  fileToolSet,
  timeToolSet,
  urlToolSet,
  agentToolSet,
  sessionToolSet,
  externalInteractionToolSet,
  agentRunnerToolSet,
  secretsToolSet,
  searchToolSet,
  selfModifyToolSet,
  inspectToolSet,
  remoteAgentToolSet,
  roomHistoryToolSet,
];

/**
 * Minimal tool sets for a habitat container (MCP server mode).
 * Self-awareness tools: file ops, secrets, self-modify, time, URL fetch,
 * plus session introspection — the container's sessions live on its own
 * volume, so "what's been going on in my sessions" must be answerable
 * in-container (sessions_* are read-only inspectors + learnings append).
 */
export const containerToolSets: ToolSet[] = [
  fileToolSet,
  timeToolSet,
  urlToolSet,
  sessionToolSet,
  secretsToolSet,
  selfModifyToolSet,
  execToolSet,
  provisionToolSet,
  artifactToolSet,
  uiResourceToolSet,
  inspectToolSet,
  remoteAgentToolSet,
  roomHistoryToolSet,
];

/**
 * Tool sets for Gaia-managed containers.
 * Same as containerToolSets but WITHOUT secretsToolSet — secrets are
 * managed by Gaia's master vault, not by the container itself.
 */
export const managedContainerToolSets: ToolSet[] = [
  fileToolSet,
  timeToolSet,
  urlToolSet,
  sessionToolSet,
  selfModifyToolSet,
  execToolSet,
  provisionToolSet,
  artifactToolSet,
  uiResourceToolSet,
  inspectToolSet,
  remoteAgentToolSet,
  roomHistoryToolSet,
];
