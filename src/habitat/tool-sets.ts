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
import {
  wgetTool,
  markifyTool,
  parseFeedTool,
} from "../stimulus/tools/url-tools.js";

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
  createTools: () => ({
    wget: wgetTool,
    markify: markifyTool,
    parse_feed: parseFeedTool,
  }),
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

/** All standard tool sets that a typical habitat includes.
 *  Focused on agent management — file/url/time tools are left to sub-agents. */
export const standardToolSets: ToolSet[] = [
  agentToolSet,
  sessionToolSet,
  externalInteractionToolSet,
  agentRunnerToolSet,
  secretsToolSet,
  searchToolSet,
];
