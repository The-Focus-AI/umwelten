/**
 * SkillDefinition: first-class skill object per Agent Skills spec (SKILL.md).
 * Used in StimulusOptions, registry, and loaders.
 */
export interface SkillDefinition {
  name: string;
  description: string;
  instructions: string;
  path: string;
  // Optional fields from Agent Skills spec
  license?: string;
  compatibility?: string;
  // Space-separated tool patterns per Agent Skills spec, e.g. "Bash(git:*) Read".
  allowedTools?: string;
  metadata?: Record<string, string>;
  // Claude Code extensions
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  context?: 'fork' | 'inline';
  argumentHint?: string;
}
