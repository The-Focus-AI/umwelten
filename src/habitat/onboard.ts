/**
 * Habitat onboarding: ensure the work directory has config.json, STIMULUS.md, skills/, tools/.
 * Safe to run multiple times -- only creates what's missing.
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import type { OnboardingResult } from './types.js';

const DEFAULT_CONFIG_JSON = JSON.stringify(
  {
    agents: [],
    skillsDirs: ['./skills'],
    toolsDir: 'tools',
  },
  null,
  2
);

const MINIMAL_STIMULUS = `# Persona

You are a helpful assistant. Edit this file to customize your persona and instructions.
`;

/**
 * Check if the work directory is onboarded: has config.json and STIMULUS.md (or prompts/).
 */
export async function isOnboarded(workDir: string, configPath: string): Promise<boolean> {
  try {
    await access(configPath, constants.R_OK);
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

/**
 * Run onboarding to ensure work dir has everything it needs.
 * @param workDir - The work directory path
 * @param configPath - The config file path
 * @param envPrefix - Env prefix for display and checking config path override
 * @param templatePath - Optional path to a stimulus template file (copied as STIMULUS.md)
 */
export async function runOnboarding(
  workDir: string,
  configPath: string,
  envPrefix: string,
  templatePath?: string
): Promise<OnboardingResult> {
  const created: string[] = [];
  const skipped: string[] = [];

  await mkdir(workDir, { recursive: true });

  // Config: only create in work dir when config path env var is not set
  const configPathEnv = process.env[`${envPrefix}_CONFIG_PATH`];
  if (!configPathEnv) {
    try {
      await access(configPath, constants.R_OK);
      skipped.push('config.json');
    } catch {
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, DEFAULT_CONFIG_JSON, 'utf-8');
      created.push('config.json');
    }
  } else {
    skipped.push(`config.json (using ${envPrefix}_CONFIG_PATH)`);
  }

  // STIMULUS.md: copy from template if provided, otherwise create minimal
  const stimulusPath = join(workDir, 'STIMULUS.md');
  try {
    await access(stimulusPath, constants.R_OK);
    skipped.push('STIMULUS.md');
  } catch {
    if (templatePath) {
      try {
        const content = await readFile(templatePath, 'utf-8');
        await writeFile(stimulusPath, content, 'utf-8');
        created.push('STIMULUS.md');
      } catch {
        await writeFile(stimulusPath, MINIMAL_STIMULUS, 'utf-8');
        created.push('STIMULUS.md (minimal)');
      }
    } else {
      await writeFile(stimulusPath, MINIMAL_STIMULUS, 'utf-8');
      created.push('STIMULUS.md (minimal)');
    }
  }

  // skills/ and tools/ directories
  for (const dirName of ['skills', 'tools']) {
    const dirPath = join(workDir, dirName);
    try {
      await access(dirPath, constants.R_OK);
      skipped.push(`${dirName}/`);
    } catch {
      await mkdir(dirPath, { recursive: true });
      created.push(`${dirName}/`);
    }
  }

  return { workDir, created, skipped };
}
