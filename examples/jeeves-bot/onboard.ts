/**
 * Onboarding: ensure the work directory has everything it needs (config, STIMULUS.md, skills/, tools/).
 * Run at startup if not onboarded, or again via /onboard.
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getWorkDir } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG_JSON = JSON.stringify(
  {
    agents: [],
    skillsDirs: ['./skills'],
    toolsDir: 'tools',
  },
  null,
  2
);

function getConfigPath(workDir: string): string {
  if (process.env.JEEVES_CONFIG_PATH) {
    return resolve(process.env.JEEVES_CONFIG_PATH);
  }
  return join(workDir, 'config.json');
}

/**
 * Check if the work directory is "onboarded": has config and STIMULUS.md (or prompts/) so everything lives in the work dir.
 */
export async function isWorkDirOnboarded(workDir: string): Promise<boolean> {
  try {
    await access(getConfigPath(workDir), constants.R_OK);
  } catch {
    return false;
  }

  const stimulusPath = join(workDir, 'STIMULUS.md');
  const promptsDir = join(workDir, 'prompts');
  try {
    await access(stimulusPath, constants.R_OK);
    return true;
  } catch {
    try {
      await access(join(promptsDir, 'main.md'), constants.R_OK);
      return true;
    } catch {
      try {
        await access(join(promptsDir, 'persona.md'), constants.R_OK);
        return true;
      } catch {
        return false;
      }
    }
  }
}

export interface OnboardingResult {
  workDir: string;
  created: string[];
  skipped: string[];
}

/**
 * Ensure the work directory has config.json, STIMULUS.md, skills/, and tools/.
 * Creates only what's missing. Safe to run again.
 */
export async function runOnboarding(workDir: string): Promise<OnboardingResult> {
  const created: string[] = [];
  const skipped: string[] = [];

  await mkdir(workDir, { recursive: true });

  // Config: only create in work dir when JEEVES_CONFIG_PATH is not set
  const configPath = getConfigPath(workDir);
  if (!process.env.JEEVES_CONFIG_PATH) {
    try {
      await access(configPath, constants.R_OK);
      skipped.push('config.json');
    } catch {
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, DEFAULT_CONFIG_JSON, 'utf-8');
      created.push('config.json');
    }
  } else {
    skipped.push('config.json (using JEEVES_CONFIG_PATH)');
  }

  // STIMULUS.md: copy from package JEEVES_PROMPT.md if missing
  const stimulusPath = join(workDir, 'STIMULUS.md');
  try {
    await access(stimulusPath, constants.R_OK);
    skipped.push('STIMULUS.md');
  } catch {
    const templatePath = join(__dirname, 'JEEVES_PROMPT.md');
    try {
      const content = await readFile(templatePath, 'utf-8');
      await writeFile(stimulusPath, content, 'utf-8');
      created.push('STIMULUS.md');
    } catch {
      // Fallback: minimal STIMULUS so load-prompts has a body
      await writeFile(
        stimulusPath,
        `# Persona\n\nYou are a helpful butler. Edit this file to customize your persona and instructions.\n`,
        'utf-8'
      );
      created.push('STIMULUS.md (minimal)');
    }
  }

  // skills/ and tools/ directories
  const skillsDir = join(workDir, 'skills');
  const toolsDir = join(workDir, 'tools');
  try {
    await access(skillsDir, constants.R_OK);
    skipped.push('skills/');
  } catch {
    await mkdir(skillsDir, { recursive: true });
    created.push('skills/');
  }
  try {
    await access(toolsDir, constants.R_OK);
    skipped.push('tools/');
  } catch {
    await mkdir(toolsDir, { recursive: true });
    created.push('tools/');
  }

  return { workDir, created, skipped };
}

/**
 * Print onboarding result to console (for CLI).
 */
export function printOnboardingResult(result: OnboardingResult): void {
  console.log('[JEEVES] Onboarding: work directory is set up.');
  if (result.created.length > 0) {
    console.log('[JEEVES] Created:', result.created.join(', '));
  }
  if (result.skipped.length > 0) {
    console.log('[JEEVES] Already present:', result.skipped.join(', '));
  }
  console.log('[JEEVES] Work directory:', result.workDir);
}
