/**
 * Shell execution tool for habitat containers.
 * Runs commands in the habitat work directory.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";

const execFileAsync = promisify(execFile);

export interface ExecToolsContext {
  getWorkDir(): string;
  /** Optional project directory (git clone). Commands default here when set. */
  getProjectDir?(): string | undefined;
  /**
   * Optional: returns the read-only agent (if any) whose root contains the path.
   * When set, bash refuses to run with cwd inside a read-only agent unless the
   * caller passes `allowMutation: false`.
   */
  findReadOnlyAgentForPath?(absPath: string): { agentId: string; root: string } | undefined;
}

export function createExecTools(ctx: ExecToolsContext): Record<string, Tool> {
  const bashTool = tool({
    description:
      "Execute a shell command in the habitat work directory. Use for installing packages, running scripts, checking system state, or any task that needs shell access.",
    inputSchema: z.object({
      command: z.string().describe("Shell command to execute"),
      cwd: z
        .string()
        .optional()
        .describe("Working directory (default: habitat work dir)"),
      timeout: z
        .number()
        .optional()
        .describe("Timeout in milliseconds (default: 120000)"),
      readOnly: z
        .boolean()
        .optional()
        .describe(
          "When true, asserts the command does not mutate the cwd. Required if cwd falls inside a read-only agent.",
        ),
    }),
    execute: async ({ command, cwd, timeout, readOnly }) => {
      const workDir = ctx.getWorkDir();
      const projectDir = ctx.getProjectDir?.();
      const defaultCwd = projectDir ?? workDir;
      const execCwd = cwd ? (cwd.startsWith("/") ? cwd : `${defaultCwd}/${cwd}`) : defaultCwd;
      const timeoutMs = timeout ?? 120000;

      // Read-mode policy: refuse to run inside a read-only agent unless the
      // caller explicitly asserts the command is non-mutating.
      const ro = ctx.findReadOnlyAgentForPath?.(execCwd);
      if (ro && !readOnly) {
        return {
          stdout: "",
          stderr: "",
          exitCode: 126,
          error: `READ_ONLY_AGENT: cwd "${execCwd}" is inside read-only agent "${ro.agentId}" (${ro.root}). Pass readOnly:true if the command does not mutate state.`,
        };
      }

      try {
        const { stdout, stderr } = await execFileAsync(
          "/bin/sh",
          ["-c", command],
          {
            cwd: execCwd,
            timeout: timeoutMs,
            maxBuffer: 4 * 1024 * 1024, // 4MB
            env: process.env,
          },
        );

        return {
          stdout: stdout || "",
          stderr: stderr || "",
          exitCode: 0,
        };
      } catch (err: any) {
        // Detect timeout (killed by signal)
        if (err.killed) {
          return {
            stdout: err.stdout || "",
            stderr: err.stderr || "",
            exitCode: 124,
            error: `Command timed out after ${timeoutMs}ms`,
          };
        }
        if (err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          return {
            stdout: err.stdout || "",
            stderr: err.stderr || "",
            exitCode: 1,
            error: "Output exceeded buffer limit (4MB)",
          };
        }
        return {
          stdout: err.stdout || "",
          stderr: err.stderr || "",
          exitCode: typeof err.code === "number" ? err.code : (err.status ?? 1),
          error: err.message,
        };
      }
    },
  });

  return { bash: bashTool };
}
