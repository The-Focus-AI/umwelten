/**
 * A2A agent skills vs MCP skills.
 *
 * - An **A2A agent skill** (`AgentCard.skills[]`) is an advertised capability
 *   of an agent: "you can ask me to do X". It carries no content.
 * - An **MCP skill** (Skills extension) is a `SKILL.md` instruction package
 *   with a file manifest that a host may load into a model's context.
 *
 * Mapping rule: an agent's card MAY advertise the MCP skills it **serves** on
 * its own MCP surface (they are part of what the agent offers), as A2A skills
 * whose `id` is `mcp-skill:<SKILL.md uri>` and whose tags include `mcp-skill`.
 * It MUST NOT advertise MCP skills it has **loaded** from other servers: those
 * are per-conversation, approval-bound, untrusted third-party content, and
 * re-advertising them would launder their origin.
 */

import type { Skill } from "@modelcontextprotocol/client/ext/skills";

export const MCP_SKILL_A2A_ID_PREFIX = "mcp-skill:";
export const MCP_SKILL_A2A_TAG = "mcp-skill";

/** The JSON shape of an A2A 1.0 `AgentSkill` (as accepted by `AgentCard.fromJSON`). */
export interface A2AAgentSkillJson {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

/** A2A agent-card skills for MCP skills an agent serves. */
export function a2aSkillsForServedMcpSkills(entries: readonly Skill[]): A2AAgentSkillJson[] {
  return entries.map((entry) => ({
    id: `${MCP_SKILL_A2A_ID_PREFIX}${entry.uri}`,
    name: entry.frontmatter.name,
    description: entry.frontmatter.description,
    tags: [MCP_SKILL_A2A_TAG],
  }));
}

/** The `SKILL.md` URI behind an A2A skill id, when that skill is a served MCP skill. */
export function mcpSkillUriFromA2ASkillId(id: string): string | undefined {
  return id.startsWith(MCP_SKILL_A2A_ID_PREFIX) ? id.slice(MCP_SKILL_A2A_ID_PREFIX.length) : undefined;
}
