/**
 * Sandboxed-cwd bash tool.
 *
 * SECURITY NOTE: path-based sandboxing does NOT contain a shell. A bash command
 * can `cd ..`, write outside the workspace, `curl` the internet, install packages,
 * delete files, and so on. This tool only sets the bash process's `cwd` to the
 * workspace root. It is convenient for trusted local agents — for true isolation
 * use Habitat's Dagger-backed `run_project` tool instead.
 */

import { execFile } from 'node:child_process';
import { tool, type Tool } from 'ai';
import { z } from 'zod';

const bashSchema = z.object({
  command: z.string().describe('Bash command to execute. Runs with cwd set to the workspace root.'),
});

export interface BashToolOptions {
  /** Workspace root used as the bash process cwd. */
  cwd: string;
  /** Timeout in ms (default: 30_000). */
  timeoutMs?: number;
  /** Extra environment variables (merged on top of process.env). */
  env?: Record<string, string>;
  /** Maximum stdout/stderr buffer (default: 10 MB). */
  maxBuffer?: number;
}

export function createBashTool(opts: BashToolOptions): Tool {
  const { cwd, timeoutMs = 30_000, env, maxBuffer = 10 * 1024 * 1024 } = opts;
  return tool({
    description:
      'Execute a bash command. The shell starts in the workspace root. Returns stdout, stderr, and exitCode. ' +
      'Note: this is a convenience tool — bash commands are NOT confined to the workspace. Use only with trusted models and workspaces.',
    inputSchema: bashSchema,
    execute: async ({ command }) => {
      return await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolvePromise) => {
        execFile(
          'bash',
          ['-c', command],
          {
            cwd,
            timeout: timeoutMs,
            maxBuffer,
            env: env ? { ...process.env, ...env } : process.env,
          },
          (err, stdout, stderr) => {
            const exitCode =
              err && typeof (err as NodeJS.ErrnoException).code === 'number'
                ? ((err as NodeJS.ErrnoException).code as unknown as number)
                : err
                  ? 1
                  : 0;
            resolvePromise({
              stdout: stdout?.toString() ?? '',
              stderr: stderr?.toString() ?? (err ? String(err.message ?? err) : ''),
              exitCode,
            });
          }
        );
      });
    },
  });
}
