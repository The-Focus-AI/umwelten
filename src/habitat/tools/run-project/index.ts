/**
 * run_project tool: smart container provisioning for agent projects.
 *
 * Unlike run_bash, this tool auto-detects project requirements (language, tools,
 * env vars, skills/plugins), provisions a container with all dependencies,
 * injects API keys, and executes commands — no manual image/dep configuration.
 */

import { resolve, normalize, relative } from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import { dag, connection, type Container } from '@dagger.io/dagger';
import { buildTimeoutBashExecArgs } from '../../../evaluation/dagger-exec-args.js';
import { analyzeProject } from './project-analyzer.js';
import {
  generateExperienceId,
  experienceExists,
  startExperience,
  continueExperience,
  commitExperience,
  discardExperience,
  getExperienceDir,
} from './experience.js';
import type { RunProjectContext, RunProjectResult, ProjectRequirements } from './types.js';
import type { Tool } from 'ai';
import { normalizeGitUrl, resolveSkillRepo } from './skill-provisioner.js';

const runProjectSchema = z.object({
  command: z.string().describe('Bash command or script to execute'),
  agentId: z
    .string()
    .optional()
    .describe('Agent id or name; uses agent project path as source. If omitted, uses habitat work directory.'),
  experienceId: z
    .string()
    .optional()
    .describe(
      'Reuse the SAME experienceId for every run_project call in a multi-step workflow so later commands see earlier changes (installed deps, created files). If omitted, a new experience is auto-created.'
    ),
  action: z
    .enum(['continue', 'commit', 'discard'])
    .optional()
    .default('continue')
    .describe(
      "Experience action: continue (default — auto-starts if no experience exists), commit (export changes back to original dir), discard (delete experience)"
    ),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe('Additional env vars to inject into the container (key=value pairs)'),
  timeout: z.number().optional().default(300).describe('Execution timeout in seconds (default: 300)'),
});

function resolveSourcePath(agentId: string | undefined, ctx: RunProjectContext): string {
  if (agentId) {
    const agent = ctx.getAgent(agentId);
    if (!agent) {
      throw new Error(`AGENT_NOT_FOUND: ${agentId}`);
    }
    return resolve(agent.projectPath);
  }
  return ctx.workDir;
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
  throw new Error(
    'OUTSIDE_ALLOWED_PATH: path is not under the work directory or any configured agent project'
  );
}

/**
 * Gather environment variables from all sources:
 * 1. Detected env vars from project analysis (via habitat.getSecret)
 * 2. Agent-declared secrets (via habitat.getSecret)
 * 3. Explicit env param from tool call
 */
function gatherEnvVars(
  requirements: ProjectRequirements,
  agentId: string | undefined,
  explicitEnv: Record<string, string> | undefined,
  ctx: RunProjectContext
): Record<string, string> {
  const env: Record<string, string> = {};

  // From project analysis
  for (const name of requirements.envVarNames) {
    const value = ctx.getSecret(name);
    if (value) {
      env[name] = value;
    }
  }

  // From agent's declared secrets
  if (agentId) {
    const agent = ctx.getAgent(agentId);
    if (agent?.secrets) {
      for (const name of agent.secrets) {
        const value = ctx.getSecret(name);
        if (value) {
          env[name] = value;
        }
      }
    }
  }

  // Explicit overrides from tool call
  if (explicitEnv) {
    Object.assign(env, explicitEnv);
  }

  return env;
}

/**
 * Execute a command in a Dagger container with smart provisioning.
 */
async function executeInDagger(
  command: string,
  experienceDir: string,
  requirements: ProjectRequirements,
  envVars: Record<string, string>,
  timeout: number
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
          .from(requirements.baseImage)
          .withDirectory('/workspace', hostDir)
          .withWorkdir('/workspace');

        // Inject environment variables
        for (const [key, value] of Object.entries(envVars)) {
          container = container.withEnvVariable(key, value);
        }

        // Mount cache volumes
        for (const vol of requirements.cacheVolumes) {
          const cacheVol = dag.cacheVolume(vol.name);
          container = container.withMountedCache(vol.mountPath, cacheVol);
        }

        // Mount shared cache volume so multi-step pipelines can share data
        // Mounted at /shared (not /tmp — apt-get needs /tmp for GPG operations)
        const sharedCache = dag.cacheVolume('run-project-shared');
        container = container.withMountedCache('/shared', sharedCache);

        // Run setup commands (apt-get, npm globals, project deps)
        // Must run before skill cloning so git is available
        for (const cmd of requirements.setupCommands) {
          try {
            container = container.withExec(['bash', '-c', cmd]);
            // Force execution to catch setup errors early
            await container.stdout();
          } catch (setupError) {
            // Setup commands may fail non-fatally (e.g. optional deps)
            console.warn(`Setup command warning: ${cmd}`, setupError);
          }
        }

        // Clone skill repos into the container (after setup so git is installed)
        for (const skill of requirements.skillRepos) {
          const gitUrl = normalizeGitUrl(skill.gitRepo);
          container = container.withExec([
            'bash', '-c',
            `git clone --depth 1 "${gitUrl}" "${skill.containerPath}"`,
          ]);
          for (const cmd of skill.setupCommands) {
            container = container.withExec([
              'bash', '-c',
              `cd "${skill.containerPath}" && ${cmd}`,
            ]);
          }
        }

        // Execute the user's command with timeout
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

        // Export modified directory back to experience
        const modifiedDir = container.directory('/workspace');
        await modifiedDir.export(experienceDir);
      },
      { LogOutput: process.stderr }
    );
  } catch (connectionError) {
    const errorMessage =
      connectionError instanceof Error
        ? connectionError.message
        : String(connectionError);

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

/**
 * Create a run_project tool that closes over a habitat context.
 */
export function createRunProjectTool(ctx: RunProjectContext): Tool {
  return tool({
    description:
      'Execute commands in a smart auto-provisioned Dagger container. Auto-detects project type, ' +
      'installs dependencies (Node.js, Python, ImageMagick, Chrome, Claude CLI, etc.), injects API keys, ' +
      'and mounts skill plugins. Use one experienceId per task and pass the EXACT SAME experienceId on ' +
      'every call. Omit experienceId to auto-create a new experience.',
    inputSchema: runProjectSchema,
    execute: async ({ command, agentId, experienceId, action, env, timeout }) => {
      const roots = ctx.getAllowedRoots();
      const workDir = ctx.workDir;

      try {
        const sourcePath = resolveSourcePath(agentId, ctx);
        ensureAllowed(sourcePath, roots);

        let finalExperienceId = experienceId;
        if (!finalExperienceId) {
          finalExperienceId = await generateExperienceId();
        }

        const experienceDir = getExperienceDir(workDir, finalExperienceId);

        // Handle discard/commit actions that don't need container execution
        if (action === 'discard') {
          if (!(await experienceExists(workDir, finalExperienceId))) {
            return {
              error: 'EXPERIENCE_NOT_FOUND',
              message: `Experience ${finalExperienceId} does not exist.`,
            };
          }
          await discardExperience(workDir, finalExperienceId);
          return {
            experienceId: finalExperienceId,
            status: 'discarded',
            message: `Experience ${finalExperienceId} discarded.`,
          } satisfies Partial<RunProjectResult>;
        }

        if (action === 'commit') {
          if (!(await experienceExists(workDir, finalExperienceId))) {
            return {
              error: 'EXPERIENCE_NOT_FOUND',
              message: `Experience ${finalExperienceId} does not exist.`,
            };
          }
          const metadata = await commitExperience(workDir, finalExperienceId);
          return {
            experienceId: finalExperienceId,
            status: 'committed',
            message: `Experience ${finalExperienceId} committed to ${metadata.sourcePath}.`,
          } satisfies Partial<RunProjectResult>;
        }

        // 'continue' action: auto-start if experience doesn't exist
        let status: 'new' | 'continued';
        if (!(await experienceExists(workDir, finalExperienceId))) {
          await startExperience(workDir, finalExperienceId, sourcePath, agentId);
          status = 'new';
        } else {
          await continueExperience(workDir, finalExperienceId);
          status = 'continued';
        }

        // Analyze the project to determine container requirements
        const requirements = await analyzeProject(sourcePath);

        // Merge agent-declared skillsFromGit (if any)
        if (agentId) {
          const agent = ctx.getAgent(agentId);
          if (agent?.skillsFromGit) {
            const seenNames = new Set(requirements.skillRepos.map((r) => r.name));
            for (const ref of agent.skillsFromGit) {
              const resolved = resolveSkillRepo(ref);
              if (!seenNames.has(resolved.name)) {
                seenNames.add(resolved.name);
                requirements.skillRepos.push(resolved);
                resolved.aptPackages.forEach((p) => {
                  if (!requirements.aptPackages.includes(p)) {
                    requirements.aptPackages.push(p);
                  }
                });
              }
            }
          }
        }

        // Ensure git is available when skills need cloning
        if (requirements.skillRepos.length > 0 && !requirements.aptPackages.includes('git')) {
          requirements.aptPackages.push('git');
        }

        // Gather all env vars
        const envVars = gatherEnvVars(requirements, agentId, env as Record<string, string> | undefined, ctx);

        // Execute in Dagger
        const result = await executeInDagger(command, experienceDir, requirements, envVars, timeout);

        if (result.exitCode === 124) {
          return {
            experienceId: finalExperienceId,
            status,
            hint: 'Reuse this experienceId on retry so the next command sees current state.',
            stdout: result.stdout,
            stderr: result.stderr || `Execution timed out after ${timeout} seconds`,
            exitCode: result.exitCode,
            timedOut: true,
            success: false,
            detectedRequirements: {
              projectType: requirements.projectType,
              detectedTools: requirements.detectedTools,
              baseImage: requirements.baseImage,
              envVarsInjected: Object.keys(envVars),
              skillRepos: requirements.skillRepos.map((r) => `${r.name} (${r.gitRepo})`),
            },
          } satisfies RunProjectResult;
        }

        const hint =
          result.exitCode !== 0
            ? 'Retry with the SAME experienceId after fixing the command. Dependencies are already installed.'
            : status === 'new'
              ? 'Reuse this exact experienceId for the next run_project call in this workflow.'
              : undefined;

        return {
          experienceId: finalExperienceId,
          status,
          ...(hint && { hint }),
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          success: result.exitCode === 0,
          detectedRequirements: {
            projectType: requirements.projectType,
            detectedTools: requirements.detectedTools,
            baseImage: requirements.baseImage,
            envVarsInjected: Object.keys(envVars),
            skillRepos: requirements.skillRepos.map((r) => `${r.name} (${r.gitRepo})`),
          },
        } satisfies RunProjectResult;
      } catch (err: unknown) {
        if (err instanceof Error) {
          if (
            err.message.startsWith('AGENT_NOT_FOUND') ||
            err.message.startsWith('OUTSIDE_ALLOWED_PATH') ||
            err.message.startsWith('EXPERIENCE_NOT_FOUND')
          ) {
            return { error: err.message };
          }
        }
        return { error: String(err) };
      }
    },
  });
}
