import { join, resolve } from "node:path";
import type { AgentEntry } from "./types.js";

export function getAgentMemoryPath(
  agent: AgentEntry,
  getAgentDir: (agentId: string) => string,
): string {
  if (agent.memoryPath) {
    return resolve(agent.memoryPath);
  }
  return join(getAgentDir(agent.id), "MEMORY.md");
}
