/**
 * Jeeves Dagger tool: run_bash - Execute bash commands in Dagger containers with experience-based state management.
 * Supports isolated experience directories that maintain state between commands.
 */

import { cp, rm, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, normalize, relative } from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { dag, connection, type Container } from '@dagger.io/dagger';
import { loadConfig, getWorkDir, getAgentById, getFileAllowedRoots } from '../config.js';
import type { JeevesConfig } from '../config.js';

const runBashSchema = z.object({
  command: z.string().describe('Bash command or script to execute'),
  agentId: z
    .string()
    .optional()
    .describe('Optional agent id or name; if set, uses agent project path as source. If omitted, uses Jeeves work directory.'),
  experienceId: z
    .string()
    .optional()
    .describe('Experience identifier for chaining commands. If provided, uses isolated experience directory. If omitted, generates a new experience ID.'),
  action: z
    .enum(['start', 'continue', 'commit', 'discard'])
    .optional()
    .default('continue')
    .describe('Experience action: start (new experience), continue (default, continue existing), commit (export to original dir), discard (delete experience)'),
  image: z.string().optional().default('ubuntu:22.04').describe('Base container image (default: ubuntu:22.04)'),
  timeout: z.number().optional().default(300).describe('Execution timeout in seconds (default: 300)'),
  workdir: z.string().optional().default('/workspace').describe('Working directory inside container (default: /workspace)'),
});

interface ExperienceMetadata {
  experienceId: string;
  sourcePath: string;
  created: string;
  lastUsed: string;
  agentId?: string;
}

function resolvePath(agentId: string | undefined, config: JeevesConfig): string {
  if (agentId) {
    const agent = getAgentById(config, agentId);
    if (!agent) {
      throw new Error(`AGENT_NOT_FOUND: ${agentId}`);
    }
    return resolve(agent.projectPath);
  }
  return getWorkDir();
}

function ensureAllowed(resolved: string, allowedRoots: string[]): void {
  const normalized = normalize(resolved);
  for (const root of allowedRoots) {
    const rootNorm = normalize(root);
    const rel = relative(rootNorm, normalized);
    if (rel && !rel.startsWith('..') && !rel.startsWith('/')) {
      return;
    }
    if (normalized === rootNorm) return;
  }
  throw new Error('OUTSIDE_ALLOWED_PATH: path is not under the Jeeves work directory or any configured agent project');
}

/**
 * Get the base directory for Dagger experiences.
 * Stored in a sibling of workDir (e.g. ~/.jeeves-dagger-experiences) to avoid
 * cp(workDir, workDir/.dagger-experiences/...) which Node rejects as "copy to subdirectory of self".
 */
function getExperiencesBaseDir(): string {
  const workDir = getWorkDir();
  const workDirName = workDir.split(/[/\\]/).filter(Boolean).pop() || '.jeeves';
  const parent = resolve(workDir, '..');
  return join(parent, `${workDirName}-dagger-experiences`);
}

function getExperienceDir(experienceId: string): string {
  return join(getExperiencesBaseDir(), experienceId);
}

function getExperienceMetaPath(experienceId: string): string {
  return join(getExperienceDir(experienceId), 'meta.json');
}

async function generateExperienceId(): Promise<string> {
  return `experience-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

async function experienceExists(experienceId: string): Promise<boolean> {
  try {
    const metaPath = getExperienceMetaPath(experienceId);
    await access(metaPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadExperienceMetadata(experienceId: string): Promise<ExperienceMetadata | null> {
  try {
    const metaPath = getExperienceMetaPath(experienceId);
    const content = await readFile(metaPath, 'utf-8');
    return JSON.parse(content) as ExperienceMetadata;
  } catch {
    return null;
  }
}

async function saveExperienceMetadata(metadata: ExperienceMetadata): Promise<void> {
  const experienceDir = getExperienceDir(metadata.experienceId);
  await mkdir(experienceDir, { recursive: true });
  const metaPath = getExperienceMetaPath(metadata.experienceId);
  await writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

async function startExperience(
  experienceId: string,
  sourcePath: string,
  agentId?: string
): Promise<void> {
  const experienceDir = getExperienceDir(experienceId);
  const experiencesBaseDir = getExperiencesBaseDir();

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

  await saveExperienceMetadata({
    experienceId,
    sourcePath,
    created: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    agentId,
  });
}

async function continueExperience(experienceId: string): Promise<ExperienceMetadata> {
  const metadata = await loadExperienceMetadata(experienceId);
  if (!metadata) {
    throw new Error(`EXPERIENCE_NOT_FOUND: Experience ${experienceId} does not exist`);
  }

  metadata.lastUsed = new Date().toISOString();
  await saveExperienceMetadata(metadata);

  return metadata;
}

async function commitExperience(experienceId: string): Promise<ExperienceMetadata> {
  const metadata = await loadExperienceMetadata(experienceId);
  if (!metadata) {
    throw new Error(`EXPERIENCE_NOT_FOUND: Experience ${experienceId} does not exist`);
  }

  const experienceDir = getExperienceDir(experienceId);

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

async function discardExperience(experienceId: string): Promise<void> {
  const experienceDir = getExperienceDir(experienceId);
  await rm(experienceDir, { recursive: true });
}

async function executeInDagger(
  command: string,
  experienceDir: string,
  image: string,
  timeout: number,
  containerWorkdir: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  try {
    await connection(
      async () => {
        const hostDir = dag.host().directory(experienceDir, {
          exclude: ['.git', 'node_modules', 'meta.json'],
        });

        let container: Container = dag
          .container()
          .from(image)
          .withDirectory(containerWorkdir, hostDir)
          .withWorkdir(containerWorkdir);

        const timeoutCmd = [
          'sh',
          '-c',
          `timeout ${timeout} bash -c ${JSON.stringify(command)} 2>&1 || (exit_code=$?; [ $exit_code -eq 124 ] && echo "Execution timed out" && exit 124; exit $exit_code)`,
        ];

        container = container.withExec(timeoutCmd);

        try {
          stdout = await container.stdout();
          exitCode = 0;
        } catch (execError: any) {
          try {
            stdout = await container.stdout();
          } catch {
            stdout = '';
          }
          try {
            stderr = await container.stderr();
          } catch {
            stderr = execError.message || String(execError);
          }

          if (
            stderr.includes('timeout') ||
            stderr.includes('124') ||
            execError.message?.includes('timeout')
          ) {
            exitCode = 124;
          } else {
            exitCode = 1;
          }
        }

        const modifiedDir = container.directory(containerWorkdir);
        await modifiedDir.export(experienceDir);
      },
      { LogOutput: process.stderr }
    );
  } catch (connectionError) {
    const errorMessage =
      connectionError instanceof Error ? connectionError.message : String(connectionError);

    if (errorMessage.includes('124') || errorMessage.includes('timed out')) {
      exitCode = 124;
      stderr = `Execution timed out after ${timeout} seconds`;
    } else {
      exitCode = 1;
      stderr = errorMessage;
    }
  }

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

export const runBashTool = tool({
  description:
    'Execute bash commands in a Dagger-managed container with experience-based state management. Supports chaining commands by maintaining isolated experience directories. Use experienceId to chain commands together.',
  inputSchema: runBashSchema,
  execute: async ({ command, agentId, experienceId, action, image, timeout, workdir }) => {
    const config = await loadConfig();
    const roots = getFileAllowedRoots(config);

    try {
      const sourcePath = resolvePath(agentId, config);
      ensureAllowed(sourcePath, roots);

      let finalExperienceId = experienceId;
      if (!finalExperienceId) {
        finalExperienceId = await generateExperienceId();
      }

      const experienceDir = getExperienceDir(finalExperienceId);

      let startedThisRequest = false;
      if (action === 'start') {
        if (await experienceExists(finalExperienceId)) {
          return {
            error: 'EXPERIENCE_EXISTS',
            message: `Experience ${finalExperienceId} already exists. Use 'continue' to use it or 'discard' to delete it.`,
          };
        }
        await startExperience(finalExperienceId, sourcePath, agentId);
        startedThisRequest = true;
      } else if (action === 'discard') {
        if (!(await experienceExists(finalExperienceId))) {
          return {
            error: 'EXPERIENCE_NOT_FOUND',
            message: `Experience ${finalExperienceId} does not exist.`,
          };
        }
        await discardExperience(finalExperienceId);
        return {
          experienceId: finalExperienceId,
          status: 'discarded',
          message: `Experience ${finalExperienceId} discarded.`,
        };
      } else if (action === 'commit') {
        if (!(await experienceExists(finalExperienceId))) {
          return {
            error: 'EXPERIENCE_NOT_FOUND',
            message: `Experience ${finalExperienceId} does not exist.`,
          };
        }
        const metadata = await commitExperience(finalExperienceId);
        return {
          experienceId: finalExperienceId,
          status: 'committed',
          message: `Experience ${finalExperienceId} committed to ${metadata.sourcePath}.`,
        };
      }

      let status: 'new' | 'continued';
      if (startedThisRequest) {
        status = 'new';
        await continueExperience(finalExperienceId);
      } else if (!(await experienceExists(finalExperienceId))) {
        await startExperience(finalExperienceId, sourcePath, agentId);
        status = 'new';
      } else {
        await continueExperience(finalExperienceId);
        status = 'continued';
      }

      const result = await executeInDagger(command, experienceDir, image, timeout, workdir);

      if (result.exitCode === 124) {
        return {
          experienceId: finalExperienceId,
          status,
          stdout: result.stdout,
          stderr: result.stderr || `Execution timed out after ${timeout} seconds`,
          exitCode: result.exitCode,
          timedOut: true,
        };
      }

      return {
        experienceId: finalExperienceId,
        status,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        success: result.exitCode === 0,
      };
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message.startsWith('AGENT_NOT_FOUND')) {
          return { error: err.message };
        }
        if (err.message.startsWith('OUTSIDE_ALLOWED_PATH')) {
          return { error: err.message };
        }
        if (err.message.startsWith('EXPERIENCE_NOT_FOUND')) {
          return { error: err.message };
        }
        if (err.message.startsWith('EXPERIENCE_EXISTS')) {
          return { error: err.message };
        }
      }
      return { error: String(err) };
    }
  },
});
