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
import { buildTimeoutBashExecArgs } from '../../../src/evaluation/dagger-exec-args.js';
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
    .describe('Required for chaining: use the SAME experienceId for every run_bash in a multi-step workflow so later commands see earlier changes (installed deps, created files). If omitted, each call gets a new workspace and previous state is lost.'),
  action: z
    .enum(['start', 'continue', 'commit', 'discard'])
    .optional()
    .default('continue')
    .describe('Experience action: start (new experience), continue (default, continue existing), commit (export to original dir), discard (delete experience)'),
  image: z.string().optional().default('ubuntu:22.04').describe('Base container image (default: ubuntu:22.04)'),
  timeout: z.number().optional().default(300).describe('Execution timeout in seconds (default: 300)'),
  workdir: z.string().optional().default('/workspace').describe('Working directory inside container (default: /workspace)'),
  pathRoot: z
    .enum(['workspace', 'slash'])
    .optional()
    .default('workspace')
    .describe(
      "When 'slash', leading / in the command is translated to /workspace (so /repos → /workspace/repos). System paths like /bin, /usr are left unchanged. Default 'workspace' does no translation."
    ),
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

/**
 * When pathRoot is 'slash', translate leading / to /workspace in the command
 * so that /repos → /workspace/repos. System paths (/bin, /usr, etc.) are left unchanged.
 * Does not parse quoted strings; paths inside quotes may be translated.
 */
function translateSlashToWorkspace(command: string): string {
  return command.replace(
    /(^|[\s;|&(])\/((?!workspace\/)(?!workspace$)(?!bin\/)(?!bin$)(?!usr\/)(?!usr$)(?!etc\/)(?!etc$)(?!lib\/)(?!lib$)(?!lib64\/)(?!lib64$)(?!sbin\/)(?!sbin$)(?!opt\/)(?!opt$)(?!root\/)(?!root$)(?!home\/)(?!home$)(?!tmp\/)(?!tmp$)(?!var\/)(?!var$)(?!run\/)(?!run$)(?!dev\/)(?!dev$)(?!proc\/)(?!proc$)(?!sys\/)(?!sys$)[a-zA-Z0-9_.-]+(?:\/[^\s;|&)'"]*)?)/g,
    (_, prefix, path) => `${prefix}/workspace/${path}`
  );
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

        // Use array form so command is one argv—no shell escaping; preserves $VAR, quotes, etc.
        const execArgs = buildTimeoutBashExecArgs(command, timeout);
        container = container.withExec(execArgs);

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
    'Execute bash in a Dagger container. Use one experienceId per task and pass the EXACT SAME experienceId on every call (do not use task-2, task-3, etc.—each new ID starts a new workspace). Set pathRoot to "slash" to treat / as the work directory (e.g. /repos → /workspace/repos). Default image ubuntu:22.04 has Perl but not Chrome; for chrome-driver install Chrome in the first step with the same experienceId, then run the script.',
  inputSchema: runBashSchema,
  execute: async ({ command, agentId, experienceId, action, image, timeout, workdir, pathRoot }) => {
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

      const effectiveCommand = pathRoot === 'slash' ? translateSlashToWorkspace(command) : command;
      const result = await executeInDagger(effectiveCommand, experienceDir, image, timeout, workdir);

      if (result.exitCode === 124) {
        return {
          experienceId: finalExperienceId,
          status,
          hint: 'Reuse this experienceId on retry so the next command sees current state.',
          stdout: result.stdout,
          stderr: result.stderr || `Execution timed out after ${timeout} seconds`,
          exitCode: result.exitCode,
          timedOut: true,
        };
      }

      const hint =
        result.exitCode !== 0
          ? 'Retry with the SAME experienceId after fixing the command or installing deps (e.g. Chrome for chrome-driver scripts). Do not create a new experienceId.'
          : status === 'new'
            ? 'Reuse this exact experienceId for the next run_bash call in this workflow. Do not use experienceId-2 or similar.'
            : undefined;

      return {
        experienceId: finalExperienceId,
        status,
        ...(hint && { hint }),
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
