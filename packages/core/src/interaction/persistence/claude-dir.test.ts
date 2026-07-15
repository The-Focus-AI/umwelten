/**
 * claudeConfigDir/claudeProjectsDir: the single resolution rule for where
 * Claude Code's data lives. Must honor CLAUDE_CONFIG_DIR (habitat
 * containers relocate ~/.claude to /data/claude-config) and fall back to
 * ~/.claude — matching the write side (claudeNativeSessionPath in habitat).
 */
import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { claudeConfigDir, claudeProjectsDir } from './claude-dir.js';

describe('claudeConfigDir', () => {
  it('honors CLAUDE_CONFIG_DIR', () => {
    const env = { CLAUDE_CONFIG_DIR: '/data/claude-config' };
    expect(claudeConfigDir(env)).toBe('/data/claude-config');
    expect(claudeProjectsDir(env)).toBe(join('/data/claude-config', 'projects'));
  });

  it('falls back to ~/.claude when unset or blank', () => {
    expect(claudeConfigDir({})).toBe(join(homedir(), '.claude'));
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: '  ' })).toBe(
      join(homedir(), '.claude'),
    );
    expect(claudeProjectsDir({})).toBe(join(homedir(), '.claude', 'projects'));
  });
});
