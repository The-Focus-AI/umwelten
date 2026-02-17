/**
 * Experience lifecycle management for run_project.
 * Extracted from examples/jeeves-bot/tools/dagger.ts.
 *
 * An "experience" is an isolated copy of a project directory that maintains
 * state between container commands. Think of it as a working branch.
 */

import { cp, rm, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ExperienceMetadata } from './types.js';

/**
 * Get the base directory for Dagger experiences.
 * Stored as a sibling of workDir (e.g. ~/.habitat-dagger-experiences) to avoid
 * cp(workDir, workDir/.dagger-experiences/...) which Node rejects.
 */
export function getExperiencesBaseDir(workDir: string): string {
  const workDirName = workDir.split(/[/\\]/).filter(Boolean).pop() || '.habitat';
  const parent = resolve(workDir, '..');
  return join(parent, `${workDirName}-dagger-experiences`);
}

export function getExperienceDir(workDir: string, experienceId: string): string {
  return join(getExperiencesBaseDir(workDir), experienceId);
}

function getExperienceMetaPath(workDir: string, experienceId: string): string {
  return join(getExperienceDir(workDir, experienceId), 'meta.json');
}

export async function generateExperienceId(): Promise<string> {
  return `experience-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export async function experienceExists(workDir: string, experienceId: string): Promise<boolean> {
  try {
    const metaPath = getExperienceMetaPath(workDir, experienceId);
    await access(metaPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function loadExperienceMetadata(
  workDir: string,
  experienceId: string
): Promise<ExperienceMetadata | null> {
  try {
    const metaPath = getExperienceMetaPath(workDir, experienceId);
    const content = await readFile(metaPath, 'utf-8');
    return JSON.parse(content) as ExperienceMetadata;
  } catch {
    return null;
  }
}

export async function saveExperienceMetadata(
  workDir: string,
  metadata: ExperienceMetadata
): Promise<void> {
  const experienceDir = getExperienceDir(workDir, metadata.experienceId);
  await mkdir(experienceDir, { recursive: true });
  const metaPath = getExperienceMetaPath(workDir, metadata.experienceId);
  await writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

export async function startExperience(
  workDir: string,
  experienceId: string,
  sourcePath: string,
  agentId?: string
): Promise<void> {
  const experienceDir = getExperienceDir(workDir, experienceId);
  const experiencesBaseDir = getExperiencesBaseDir(workDir);

  await mkdir(experiencesBaseDir, { recursive: true });
  await mkdir(experienceDir, { recursive: true });

  await cp(sourcePath, experienceDir, {
    recursive: true,
    filter: (src) => {
      const parts = src.split(/[/\\]/);
      return !parts.some(
        (part) =>
          part === '.git' ||
          part === 'node_modules' ||
          part === '.dagger-experiences' ||
          part.endsWith('-dagger-experiences')
      );
    },
  });

  await saveExperienceMetadata(workDir, {
    experienceId,
    sourcePath,
    created: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    agentId,
  });
}

export async function continueExperience(
  workDir: string,
  experienceId: string
): Promise<ExperienceMetadata> {
  const metadata = await loadExperienceMetadata(workDir, experienceId);
  if (!metadata) {
    throw new Error(`EXPERIENCE_NOT_FOUND: Experience ${experienceId} does not exist`);
  }

  metadata.lastUsed = new Date().toISOString();
  await saveExperienceMetadata(workDir, metadata);

  return metadata;
}

export async function commitExperience(
  workDir: string,
  experienceId: string
): Promise<ExperienceMetadata> {
  const metadata = await loadExperienceMetadata(workDir, experienceId);
  if (!metadata) {
    throw new Error(`EXPERIENCE_NOT_FOUND: Experience ${experienceId} does not exist`);
  }

  const experienceDir = getExperienceDir(workDir, experienceId);

  await cp(experienceDir, metadata.sourcePath, {
    recursive: true,
    filter: (src) => {
      const name = src.split(/[/\\]/).pop() || '';
      return name !== 'meta.json';
    },
  });

  await rm(experienceDir, { recursive: true });

  return metadata;
}

export async function discardExperience(workDir: string, experienceId: string): Promise<void> {
  const experienceDir = getExperienceDir(workDir, experienceId);
  await rm(experienceDir, { recursive: true });
}
