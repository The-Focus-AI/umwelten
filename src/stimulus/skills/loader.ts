import { readdir, readFile, mkdir } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import matter from 'gray-matter';
import type { SkillDefinition } from './types.js';

const SKILL_MD = 'SKILL.md';

/** Directories to skip when recursively scanning for SKILL.md (e.g. .git, node_modules). */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', '.venv']);

/**
 * Recursively find all directories under root that contain SKILL.md.
 * Used so repos with nested skills (e.g. .claude/skills/browser-automation) are discovered.
 */
async function findSkillDirsRecursive(rootDir: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        const childPath = join(dir, entry.name);
        const skillMdPath = join(childPath, SKILL_MD);
        try {
          await readFile(skillMdPath, 'utf-8');
          found.push(childPath);
        } catch {
          await walk(childPath);
        }
      }
    } catch {
      // ignore unreadable dirs
    }
  }
  await walk(rootDir);
  return found;
}

/**
 * Discover all skills in a directory: SKILL.md at root (if present) plus any nested directory that contains SKILL.md.
 * Used after cloning a repo into the work/session cache so one repo can contribute multiple skills
 * (e.g. .claude/skills/browser-automation in chrome-driver).
 */
export async function discoverSkillsInDirectory(dir: string): Promise<SkillDefinition[]> {
  const skills: SkillDefinition[] = [];
  const rootSkill = await loadSkillFromPath(dir);
  if (rootSkill) skills.push(rootSkill);
  const nestedDirs = await findSkillDirsRecursive(dir);
  for (const skillDir of nestedDirs) {
    const skill = await loadSkillFromPath(skillDir);
    if (skill && !skills.some((existing) => existing.name === skill.name)) skills.push(skill);
  }
  return skills;
}

/**
 * Load a single skill from a directory that contains SKILL.md.
 * If frontmatter has no `name`, uses the directory's basename (e.g. browser-automation).
 * @internal
 */
export async function loadSkillFromPath(skillDir: string): Promise<SkillDefinition | null> {
  const skillMdPath = join(skillDir, SKILL_MD);
  try {
    const content = await readFile(skillMdPath, 'utf-8');
    const { data, content: body } = matter(content);

    const skillName =
      data.name && typeof data.name === 'string'
        ? data.name
        : (skillDir.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? 'skill');

    if (!data.description || typeof data.description !== 'string') {
      console.warn(`Skill at ${skillDir}: missing or invalid 'description' field`);
      return null;
    }

    return {
      name: skillName,
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

export function normalizeGitUrl(repo: string): string {
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
 * Load skills from a git repo: clone into the given cache root (work or session dir), then discover
 * all skills (SKILL.md at repo root plus subdirs with SKILL.md). No global cache; cacheRoot must
 * be provided (e.g. <workDir>/repos).
 */
export async function loadSkillsFromGit(repo: string, cacheRoot: string): Promise<SkillDefinition[]> {
  if (!isGitUrl(repo)) {
    console.warn(`loadSkillsFromGit: not a git URL or owner/repo: ${repo}`);
    return [];
  }
  if (!cacheRoot || cacheRoot.trim() === '') {
    console.warn('loadSkillsFromGit: cacheRoot is required (e.g. work dir/repos); no global cache.');
    return [];
  }
  const url = normalizeGitUrl(repo);
  const slug = slugFromRepo(repo);
  const cacheDir = join(cacheRoot, slug);

  try {
    if (!existsSync(cacheDir)) {
      await mkdir(cacheRoot, { recursive: true });
      execSync(`git clone --depth 1 "${url}" "${cacheDir}"`, { stdio: 'pipe' });
    }
    return discoverSkillsInDirectory(cacheDir);
  } catch (err) {
    console.warn(`loadSkillsFromGit failed for ${repo}:`, err instanceof Error ? err.message : err);
    return [];
  }
}
