/**
 * Skill/plugin provisioner: detects skill references in scripts and generates
 * container requirements (apt packages, git repos to clone) for those skills.
 *
 * Skills are cloned from their git repos into the container at build time —
 * no host filesystem mounts. This makes provisioning portable and reproducible.
 *
 * Currently handles:
 * - chrome-driver plugin (chromium, perl, git clone)
 * - nano-banana CLI (git clone)
 * - Generic plugin detection from ~/.claude/plugins/cache/ references
 */

import { homedir } from 'node:os';
import { normalizeGitUrl } from '../../../stimulus/skills/loader.js';
import type { SkillRepo } from './types.js';

/** Requirements generated from skill/plugin detection. */
export interface SkillRequirements {
  aptPackages: string[];
  envVars: string[];
  skillRepos: SkillRepo[];
}

/** Known skill mappings: plugin name -> git repo + container requirements. */
const KNOWN_SKILLS: Record<
  string,
  {
    gitRepo: string;
    aptPackages: string[];
    containerPath: string;
    setupCommands?: string[];
  }
> = {
  'chrome-driver': {
    gitRepo: 'The-Focus-AI/chrome-driver',
    aptPackages: ['chromium', 'perl', 'libwww-perl', 'libjson-perl'],
    containerPath: '/opt/chrome-driver',
  },
  'nano-banana': {
    gitRepo: 'The-Focus-AI/nano-banana-cli',
    aptPackages: [],
    containerPath: '/opt/nano-banana',
  },
};

/**
 * Detect skill/plugin references in script contents and return container requirements.
 * Scans for ~/.claude/plugins/cache/<marketplace>/<plugin>/ paths to determine which
 * skills a project uses, then maps them to git repos for container cloning.
 */
export async function detectSkillRequirements(
  scriptContents: string[],
  _projectPath: string
): Promise<SkillRequirements> {
  const allApt = new Set<string>();
  const allEnvVars = new Set<string>();
  const skillRepos: SkillRepo[] = [];
  const seenSkills = new Set<string>();

  const combined = scriptContents.join('\n');

  // Pattern: ~/.claude/plugins/cache/<marketplace>/<plugin-name>/
  const pluginRefs = combined.matchAll(
    /~\/\.claude\/plugins\/cache\/([^/]+)\/([^/]+)\//g
  );

  const detectedPlugins = new Set<string>();

  for (const match of pluginRefs) {
    const marketplace = match[1];
    const pluginName = match[2];
    detectedPlugins.add(`${marketplace}/${pluginName}`);
  }

  // Also detect expanded home dir paths: /Users/foo/.claude/plugins/cache/<marketplace>/<plugin>/
  const homePluginPath = homedir() + '/.claude/plugins/cache/';
  const escapedHome = homePluginPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expandedRefs = combined.matchAll(
    new RegExp(escapedHome + '([^/]+)/([^/]+)/', 'g')
  );

  for (const match of expandedRefs) {
    const marketplace = match[1];
    const pluginName = match[2];
    detectedPlugins.add(`${marketplace}/${pluginName}`);
  }

  for (const pluginRef of detectedPlugins) {
    const pluginName = pluginRef.split('/').pop()!;

    if (seenSkills.has(pluginName)) continue;
    seenSkills.add(pluginName);

    const knownSkill = KNOWN_SKILLS[pluginName];

    if (knownSkill) {
      knownSkill.aptPackages.forEach((p) => allApt.add(p));
      skillRepos.push({
        name: pluginName,
        gitRepo: knownSkill.gitRepo,
        containerPath: knownSkill.containerPath,
        aptPackages: knownSkill.aptPackages,
        setupCommands: knownSkill.setupCommands ?? [],
      });
    } else {
      // Unknown plugin: create a generic entry using marketplace/pluginName as repo guess
      // The marketplace slug often maps to a GitHub org
      skillRepos.push({
        name: pluginName,
        gitRepo: pluginRef, // marketplace/pluginName as best-guess repo
        containerPath: `/opt/${pluginName}`,
        aptPackages: [],
        setupCommands: [],
      });
    }
  }

  return {
    aptPackages: [...allApt],
    envVars: [...allEnvVars],
    skillRepos,
  };
}

/**
 * Look up a skill name in KNOWN_SKILLS and return a SkillRepo entry.
 * Used to resolve agent-declared skillsFromGit references.
 * Falls back to treating the input as a git repo if not in KNOWN_SKILLS.
 */
export function resolveSkillRepo(nameOrRepo: string): SkillRepo {
  // Check if it matches a known skill by name
  const known = KNOWN_SKILLS[nameOrRepo];
  if (known) {
    return {
      name: nameOrRepo,
      gitRepo: known.gitRepo,
      containerPath: known.containerPath,
      aptPackages: known.aptPackages,
      setupCommands: known.setupCommands ?? [],
    };
  }

  // Treat as a git repo (owner/repo or URL)
  const name = nameOrRepo.split('/').pop()?.replace(/\.git$/, '') ?? nameOrRepo;
  return {
    name,
    gitRepo: nameOrRepo,
    containerPath: `/opt/${name}`,
    aptPackages: [],
    setupCommands: [],
  };
}

/** Normalize a git repo string to a full URL. Re-exported for use in index.ts. */
export { normalizeGitUrl };
