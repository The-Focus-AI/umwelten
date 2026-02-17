/**
 * Project analyzer: static detection of project requirements for container provisioning.
 *
 * Detects project type, scans scripts for tool/command usage, parses CLAUDE.md
 * and .env for env var names, and detects skill/plugin references.
 */

import { readFile, readdir, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { detectProjectType } from '../../../evaluation/codebase/context-provider.js';
import type { ProjectRequirements, CacheVolumeConfig, SkillRepo } from './types.js';
import { detectSkillRequirements, resolveSkillRepo } from './skill-provisioner.js';

/** Base images per project type. */
const PROJECT_BASE_IMAGES: Record<string, string> = {
  npm: 'node:20',
  pip: 'python:3.11',
  cargo: 'rust:1.75',
  go: 'golang:1.21',
  maven: 'maven:3.9-eclipse-temurin-17',
  gradle: 'gradle:8.5-jdk17',
  shell: 'ubuntu:22.04',
  unknown: 'ubuntu:22.04',
};

/** Default setup commands per project type. */
const PROJECT_SETUP_COMMANDS: Record<string, string[]> = {
  npm: ['npm install'],
  pip: ['pip install -r requirements.txt || pip install -e . || true'],
  cargo: ['cargo fetch'],
  go: ['go mod download'],
  maven: ['mvn dependency:resolve'],
  gradle: ['gradle dependencies'],
  shell: [],
  unknown: [],
};

/** Cache volumes per project type. */
const PROJECT_CACHE_VOLUMES: Record<string, CacheVolumeConfig[]> = {
  npm: [
    { name: 'npm-cache', mountPath: '/root/.npm' },
  ],
  pip: [
    { name: 'pip-cache', mountPath: '/root/.cache/pip' },
  ],
  cargo: [
    { name: 'cargo-registry', mountPath: '/usr/local/cargo/registry' },
    { name: 'cargo-target', mountPath: '/workspace/target' },
  ],
  go: [
    { name: 'go-mod-cache', mountPath: '/go/pkg/mod' },
    { name: 'go-build-cache', mountPath: '/root/.cache/go-build' },
  ],
  maven: [{ name: 'maven-repo', mountPath: '/root/.m2/repository' }],
  gradle: [{ name: 'gradle-cache', mountPath: '/root/.gradle' }],
  shell: [],
  unknown: [],
};

/** Patterns that detect commands/tools in shell scripts. */
const TOOL_PATTERNS: Array<{
  pattern: RegExp;
  tool: string;
  aptPackages?: string[];
  npmGlobalPackages?: string[];
  envVars?: string[];
}> = [
  {
    pattern: /\b(magick|convert)\b/,
    tool: 'imagemagick',
    aptPackages: ['imagemagick'],
  },
  {
    pattern: /\bclaude\s+--model\b|\bclaude\s+-p\b|\bclaude\s+--print\b/,
    tool: 'claude-cli',
    npmGlobalPackages: ['@anthropic-ai/claude-code'],
    envVars: ['ANTHROPIC_API_KEY'],
  },
  {
    pattern: /\bnpx\s+/,
    tool: 'npx',
    // Node is needed — handled by base image selection
  },
  {
    pattern: /\bjq\b/,
    tool: 'jq',
    aptPackages: ['jq'],
  },
  {
    pattern: /\bcurl\b/,
    tool: 'curl',
    aptPackages: ['curl'],
  },
  {
    pattern: /\bwget\b/,
    tool: 'wget',
    aptPackages: ['wget'],
  },
  {
    pattern: /\bgit\b/,
    tool: 'git',
    aptPackages: ['git'],
  },
  {
    pattern: /\bpython3?\b/,
    tool: 'python',
    aptPackages: ['python3'],
  },
  {
    pattern: /\bffmpeg\b/,
    tool: 'ffmpeg',
    aptPackages: ['ffmpeg'],
  },
  {
    pattern: /\bsqlite3\b/,
    tool: 'sqlite3',
    aptPackages: ['sqlite3'],
  },
];

/** In-memory cache for project analysis results. */
const analysisCache = new Map<string, { requirements: ProjectRequirements; analyzedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Analyze a project directory and return its requirements for container provisioning.
 * Results are cached in-memory for 5 minutes.
 */
export async function analyzeProject(projectPath: string): Promise<ProjectRequirements> {
  // Check cache
  const cached = analysisCache.get(projectPath);
  if (cached && Date.now() - cached.analyzedAt < CACHE_TTL_MS) {
    return cached.requirements;
  }

  const requirements = await doAnalyzeProject(projectPath);

  // Cache result
  analysisCache.set(projectPath, { requirements, analyzedAt: Date.now() });

  return requirements;
}

/** Clear the analysis cache (for testing). */
export function clearAnalysisCache(): void {
  analysisCache.clear();
}

async function doAnalyzeProject(projectPath: string): Promise<ProjectRequirements> {
  // Step 1: Detect project type (reuses existing detectProjectType + adds 'shell')
  let projectType = await detectProjectType(projectPath);
  if (projectType === 'unknown') {
    projectType = await detectShellProject(projectPath);
  }

  const detectedTools: string[] = [];
  const envVarNames = new Set<string>();
  const aptPackages = new Set<string>();
  const npmGlobalPackages = new Set<string>();
  const skillRepos: SkillRepo[] = [];
  const seenSkillNames = new Set<string>();

  // Step 2: Scan scripts in bin/ and root for tool usage
  const scriptContents = await collectScriptContents(projectPath);

  for (const content of scriptContents) {
    for (const toolDef of TOOL_PATTERNS) {
      if (toolDef.pattern.test(content)) {
        if (!detectedTools.includes(toolDef.tool)) {
          detectedTools.push(toolDef.tool);
        }
        toolDef.aptPackages?.forEach((p) => aptPackages.add(p));
        toolDef.npmGlobalPackages?.forEach((p) => npmGlobalPackages.add(p));
        toolDef.envVars?.forEach((v) => envVarNames.add(v));
      }
    }

    // Detect npx package names for env var hints
    const npxMatches = content.matchAll(/\bnpx\s+([@\w/-]+)/g);
    for (const match of npxMatches) {
      // npx packages often need API keys — we'll detect those from CLAUDE.md
    }
  }

  // Step 3: Detect skill/plugin references in scripts
  const skillReqs = await detectSkillRequirements(scriptContents, projectPath);
  skillReqs.aptPackages.forEach((p) => aptPackages.add(p));
  skillReqs.envVars.forEach((v) => envVarNames.add(v));
  for (const repo of skillReqs.skillRepos) {
    if (!seenSkillNames.has(repo.name)) {
      seenSkillNames.add(repo.name);
      skillRepos.push(repo);
    }
  }

  // Step 4: Parse CLAUDE.md for env var names
  const claudeEnvVars = await parseClaudeMdEnvVars(projectPath);
  claudeEnvVars.forEach((v) => envVarNames.add(v));

  // Step 5: Parse .env for var names (not values)
  const dotEnvVars = await parseDotEnvVarNames(projectPath);
  dotEnvVars.forEach((v) => envVarNames.add(v));

  // Step 6: Determine base image
  let baseImage = PROJECT_BASE_IMAGES[projectType] || PROJECT_BASE_IMAGES.unknown;

  // If we detected npx or node-dependent tools but project isn't npm, upgrade to node image
  if (
    (detectedTools.includes('npx') || detectedTools.includes('claude-cli')) &&
    projectType !== 'npm'
  ) {
    baseImage = 'node:20';
  }

  // Step 7: Build setup commands
  const setupCommands: string[] = [];

  // apt packages first (if any)
  const allApt = [...aptPackages];
  if (allApt.length > 0) {
    // Only add apt-get if base image supports it (not alpine)
    if (!baseImage.includes('alpine')) {
      setupCommands.push(
        `apt-get update -qq && apt-get install -y -qq ${allApt.join(' ')} && rm -rf /var/lib/apt/lists/*`
      );
    } else {
      setupCommands.push(`apk add --no-cache ${allApt.join(' ')}`);
    }
  }

  // npm globals
  const allNpmGlobal = [...npmGlobalPackages];
  if (allNpmGlobal.length > 0) {
    setupCommands.push(`npm install -g ${allNpmGlobal.join(' ')}`);
  }

  // Project-specific setup
  const projectSetup = PROJECT_SETUP_COMMANDS[projectType] || [];
  setupCommands.push(...projectSetup);

  // Cache volumes
  const cacheVolumes = PROJECT_CACHE_VOLUMES[projectType] || [];

  // Add apt cache volume if we're installing packages
  if (allApt.length > 0) {
    cacheVolumes.push({ name: 'apt-cache', mountPath: '/var/cache/apt' });
  }

  return {
    projectType,
    detectedTools,
    envVarNames: [...envVarNames],
    aptPackages: allApt,
    npmGlobalPackages: allNpmGlobal,
    setupCommands,
    baseImage,
    cacheVolumes,
    skillRepos,
  };
}

/** Check if the project is a shell-based project (run.sh, setup.sh, Makefile, bin/ dir). */
async function detectShellProject(projectPath: string): Promise<string> {
  const shellMarkers = ['run.sh', 'setup.sh', 'Makefile', 'makefile'];

  for (const marker of shellMarkers) {
    try {
      await stat(join(projectPath, marker));
      return 'shell';
    } catch {
      continue;
    }
  }

  // Check for bin/ directory with scripts
  try {
    const binDir = join(projectPath, 'bin');
    const entries = await readdir(binDir);
    if (entries.length > 0) {
      return 'shell';
    }
  } catch {
    // no bin/ dir
  }

  return 'unknown';
}

/** Collect contents of all scripts in the project (bin/, root shell scripts). */
async function collectScriptContents(projectPath: string): Promise<string[]> {
  const contents: string[] = [];

  // Read scripts from bin/
  try {
    const binDir = join(projectPath, 'bin');
    const entries = await readdir(binDir);
    for (const entry of entries) {
      try {
        const content = await readFile(join(binDir, entry), 'utf-8');
        contents.push(content);
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    // no bin/ dir
  }

  // Read root shell scripts
  const rootScripts = ['run.sh', 'setup.sh', 'start.sh', 'build.sh', 'deploy.sh'];
  for (const script of rootScripts) {
    try {
      const content = await readFile(join(projectPath, script), 'utf-8');
      contents.push(content);
    } catch {
      // file doesn't exist
    }
  }

  // Read CLAUDE.md too — it may contain command examples
  try {
    const content = await readFile(join(projectPath, 'CLAUDE.md'), 'utf-8');
    contents.push(content);
  } catch {
    // no CLAUDE.md
  }

  return contents;
}

/** Parse CLAUDE.md for env var names (A-Z_0-9 patterns, especially *_API_KEY, *_TOKEN). */
async function parseClaudeMdEnvVars(projectPath: string): Promise<string[]> {
  const envVars = new Set<string>();

  try {
    const content = await readFile(join(projectPath, 'CLAUDE.md'), 'utf-8');

    // Match env var patterns: UPPER_CASE_WITH_UNDERSCORES (at least 2 parts)
    const matches = content.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g);
    for (const match of matches) {
      const name = match[1];
      // Filter to likely env vars (API keys, tokens, secrets, URLs)
      if (
        name.endsWith('_KEY') ||
        name.endsWith('_TOKEN') ||
        name.endsWith('_SECRET') ||
        name.endsWith('_URL') ||
        name.endsWith('_API_KEY') ||
        name.startsWith('ANTHROPIC_') ||
        name.startsWith('OPENAI_') ||
        name.startsWith('GOOGLE_') ||
        name.startsWith('GEMINI_') ||
        name.startsWith('GITHUB_') ||
        name.startsWith('TAVILY_') ||
        name.startsWith('AWS_')
      ) {
        envVars.add(name);
      }
    }
  } catch {
    // no CLAUDE.md
  }

  return [...envVars];
}

/** Parse .env file for variable names (not values). */
async function parseDotEnvVarNames(projectPath: string): Promise<string[]> {
  const envVars = new Set<string>();

  for (const envFile of ['.env', '.env.example', '.env.local']) {
    try {
      const content = await readFile(join(projectPath, envFile), 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const name = trimmed.substring(0, eqIdx).trim();
            if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
              envVars.add(name);
            }
          }
        }
      }
    } catch {
      // file doesn't exist
    }
  }

  return [...envVars];
}
