/**
 * Where Claude Code keeps its on-disk data.
 *
 * One resolution rule for every reader (adapter, session store, digester,
 * search): honor CLAUDE_CONFIG_DIR — the same override the Claude Code CLI
 * and Agent SDK use to relocate ~/.claude. Habitat containers set it to
 * /data/claude-config so native traces live on the data volume; without
 * this, in-container readers looked at ~/.claude and found nothing while
 * the writers filled /data/claude-config (the nativeSessionRef paths).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

/** Root of Claude Code's data dir ($CLAUDE_CONFIG_DIR, else ~/.claude). */
export function claudeConfigDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
}

/** Claude Code's projects dir (session JSONLs + sessions-index.json). */
export function claudeProjectsDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(claudeConfigDir(env), 'projects');
}
