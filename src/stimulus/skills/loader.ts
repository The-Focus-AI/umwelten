import { readdir, readFile, mkdir } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import matter from 'gray-matter';
import type { SkillDefinition } from './types.js';

const SKILL_MD = 'SKILL.md';

/**
 * Load a single skill from a directory that contains SKILL.md.
 * @internal
 */
export async function loadSkillFromPath(skillDir: string): Promise<SkillDefinition | null> {
  const skillMdPath = join(skillDir, SKILL_MD);
  try {
    const content = await readFile(skillMdPath, 'utf-8');
    const { data, content: body } = matter(content);

    if (!data.name || typeof data.name !== 'string') {
      console.warn(`Skill at ${skillDir}: missing or invalid 'name' field`);
      return null;
    }
    if (!data.description || typeof data.description !== 'string') {
      console.warn(`Skill at ${skillDir}: missing or invalid 'description' field`);
      return null;
    }

    return {
      name: data.name,
      description: data.description,
      instructions: body.trim(),
      path: skillDir,
      license: data.license,
      compatibility: data.compatibility,
      allowedTools: typeof data['allowed-tools'] === 'string' ? data['allowed-tools'].split(/\s+/).filter(Boolean) : undefined,
      metadata: data.metadata,
      disableModelInvocation: data['disable-model-invocation'],
      userInvocable: data['user-invocable'],
      context: data.context,
      argumentHint: data['argument-hint'],
    };
  } catch {
    return null;
  }
}

/**
 * Load all skills from a directory: each subdirectory that contains SKILL.md becomes one SkillDefinition.
 */
export async function loadSkillsFromDirectory(dir: string): Promise<SkillDefinition[]> {
  const skills: SkillDefinition[] = [];
  const resolvedDir = dir.startsWith('~') ? join(homedir(), dir.slice(1)) : isAbsolute(dir) ? dir : join(process.cwd(), dir);
  try {
    const entries = await readdir(resolvedDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = join(resolvedDir, entry.name);
      const skill = await loadSkillFromPath(skillDir);
      if (skill) skills.push(skill);
    }
  } catch {
    // Directory doesn't exist or not readable
  }
  return skills;
}

function isGitUrl(s: string): boolean {
  return /^https?:\/\//.test(s) || s.startsWith('git@') || /^[^/]+\/[^/]+$/.test(s) && !s.includes(' ');
}

function normalizeGitUrl(repo: string): string {
  const t = repo.trim();
  if (t.startsWith('http://') || t.startsWith('https://') || t.startsWith('git@')) return t;
  // owner/repo -> https://github.com/owner/repo
  if (/^[^/]+\/[^/]+$/.test(t)) return `https://github.com/${t}`;
  return t;
}

function slugFromRepo(repo: string): string {
  const url = normalizeGitUrl(repo);
  const match = url.match(/(?:github\.com[/:]|git@[^:]+:)([^/]+\/[^/]+?)(?:\.git)?\/?$/i) || url.match(/([^/]+\/[^/]+)$/);
  const base = match ? match[1].replace(/\.git$/, '') : url;
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Load a single skill from a git repo: clone into cache (or use existing), then parse SKILL.md at repo root.
 */
export async function loadSkillFromGit(repo: string): Promise<SkillDefinition | null> {
  if (!isGitUrl(repo)) {
    console.warn(`loadSkillFromGit: not a git URL or owner/repo: ${repo}`);
    return null;
  }
  const url = normalizeGitUrl(repo);
  const slug = slugFromRepo(repo);
  const cacheRoot = join(homedir(), '.umwelten', 'skills-cache');
  const cacheDir = join(cacheRoot, slug);

  try {
    if (!existsSync(cacheDir)) {
      await mkdir(cacheRoot, { recursive: true });
      execSync(`git clone --depth 1 "${url}" "${cacheDir}"`, { stdio: 'pipe' });
    }
    return loadSkillFromPath(cacheDir);
  } catch (err) {
    console.warn(`loadSkillFromGit failed for ${repo}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
