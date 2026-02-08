/**
 * Habitat file tools: read_file, write_file, list_directory, ripgrep.
 * Paths are sandboxed to the habitat's allowed roots (work dir, sessions dir, agent projects).
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, normalize, relative, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tool } from 'ai';
import { z } from 'zod';
import type { Tool } from 'ai';
import type { HabitatConfig, AgentEntry } from '../types.js';

const execFileAsync = promisify(execFile);

/** Interface for the habitat context that file tools need. */
export interface FileToolsContext {
  getWorkDir(): string;
  getSessionsDir(): string;
  getConfig(): HabitatConfig;
  getAgent(idOrName: string): AgentEntry | undefined;
  getAllowedRoots(): string[];
}

const pathSchema = z.object({
  path: z.string().describe('File or directory path (relative to work dir, or to agent project if agentId is set)'),
  agentId: z
    .string()
    .optional()
    .describe('Optional agent id or name; if set, path is relative to that agent project.'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Optional line offset (0-based) to start reading from.'),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Optional maximum number of lines to read.'),
});

/**
 * Resolve path for file tools. Leading "/" is treated as the work dir (chroot-style).
 */
function resolvePath(
  rawPath: string,
  agentId: string | undefined,
  ctx: FileToolsContext
): string {
  const workDir = ctx.getWorkDir();

  if (agentId) {
    const agent = ctx.getAgent(agentId);
    if (!agent) throw new Error(`AGENT_NOT_FOUND: ${agentId}`);
    return resolve(agent.projectPath, rawPath);
  }

  // Leading "/" (but not "//") = virtual root = work dir
  if (rawPath.startsWith('/') && !rawPath.startsWith('//')) {
    const asAbsolute = normalize(resolve(rawPath));
    const allowedRoots = ctx.getAllowedRoots();
    for (const root of allowedRoots) {
      const rootNorm = normalize(root);
      const rel = relative(rootNorm, asAbsolute);
      if (rel === '' || (!rel.startsWith('..') && rel !== '..')) {
        return asAbsolute;
      }
    }
    const underWork = rawPath.slice(1) || '.';
    return resolve(workDir, underWork);
  }

  if (rawPath.startsWith('\\') || (process.platform === 'win32' && /^[A-Za-z]:/.test(rawPath))) {
    return normalize(resolve(rawPath));
  }

  return resolve(workDir, rawPath);
}

function ensureAllowed(resolved: string, allowedRoots: string[]): void {
  const normalized = normalize(resolved);

  for (const root of allowedRoots) {
    const rootNorm = normalize(root);
    const rel = relative(rootNorm, normalized);
    if (rel && !rel.startsWith('..') && !rel.startsWith('/')) return;
    if (normalized === rootNorm) return;
  }
  throw new Error('OUTSIDE_ALLOWED_PATH: path is not under the work directory, sessions directory, or any configured agent project');
}

/**
 * Create all file tools for a habitat.
 */
export function createFileTools(ctx: FileToolsContext): Record<string, Tool> {
  const readFileTool = tool({
    description: 'Read the contents of a file. Without agentId, path is relative to the work directory. With agentId, path is relative to that agent project. Use offset and limit to read portions of large files.',
    inputSchema: pathSchema,
    execute: async ({ path: rawPath, agentId, offset, limit }) => {
      const allowedRoots = ctx.getAllowedRoots();
      try {
        const resolved = resolvePath(rawPath, agentId, ctx);
        ensureAllowed(resolved, allowedRoots);
        const fullContent = await readFile(resolved, 'utf-8');

        if (offset !== undefined || limit !== undefined) {
          const lines = fullContent.split('\n');
          const totalLines = lines.length;
          const startLine = offset ?? 0;
          const endLine = limit !== undefined ? startLine + limit : totalLines;
          const slicedContent = lines.slice(startLine, endLine).join('\n');
          return {
            path: resolved,
            content: slicedContent,
            totalLines,
            startLine,
            endLine: Math.min(endLine, totalLines),
            hasMore: endLine < totalLines,
          };
        }

        return { path: resolved, content: fullContent };
      } catch (err: unknown) {
        if (err instanceof Error) {
          if (err.message.startsWith('AGENT_NOT_FOUND')) return { error: err.message };
          if (err.message.startsWith('OUTSIDE_ALLOWED_PATH')) return { error: err.message };
          if ('code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') return { error: 'FILE_NOT_FOUND', path: rawPath };
          if ('code' in err && (err as NodeJS.ErrnoException).code === 'EACCES') return { error: 'PERMISSION_DENIED', path: rawPath };
        }
        return { error: String(err) };
      }
    },
  });

  const writeFileSchema = z.object({
    path: z.string().describe('File path to write'),
    content: z.string().describe('Content to write'),
    agentId: z.string().optional().describe('Optional agent id; path is relative to that agent project'),
  });

  const writeFileTool = tool({
    description: 'Write content to a file. Creates parent directories if needed. Without agentId, path is relative to the work directory.',
    inputSchema: writeFileSchema,
    execute: async ({ path: rawPath, content, agentId }) => {
      const allowedRoots = ctx.getAllowedRoots();
      try {
        const resolved = resolvePath(rawPath, agentId, ctx);
        ensureAllowed(resolved, allowedRoots);
        await mkdir(resolve(resolved, '..'), { recursive: true });
        await writeFile(resolved, content, 'utf-8');
        return { path: resolved, written: true };
      } catch (err: unknown) {
        if (err instanceof Error) {
          if (err.message.startsWith('AGENT_NOT_FOUND')) return { error: err.message };
          if (err.message.startsWith('OUTSIDE_ALLOWED_PATH')) return { error: err.message };
          if ('code' in err && (err as NodeJS.ErrnoException).code === 'EACCES') return { error: 'PERMISSION_DENIED', path: rawPath };
        }
        return { error: String(err) };
      }
    },
  });

  const listDirectoryTool = tool({
    description: 'List directory entries (files and subdirectories). Without agentId, path is relative to the work directory (use "." to list it).',
    inputSchema: pathSchema,
    execute: async ({ path: rawPath, agentId }) => {
      const allowedRoots = ctx.getAllowedRoots();
      try {
        const resolved = resolvePath(rawPath, agentId, ctx);
        ensureAllowed(resolved, allowedRoots);
        const entries = await readdir(resolved, { withFileTypes: true });
        const list = entries.map(e => ({ name: e.name, isDir: e.isDirectory() }));
        return { path: resolved, entries: list };
      } catch (err: unknown) {
        if (err instanceof Error) {
          if (err.message.startsWith('AGENT_NOT_FOUND')) return { error: err.message };
          if (err.message.startsWith('OUTSIDE_ALLOWED_PATH')) return { error: err.message };
          if ('code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') return { error: 'FILE_NOT_FOUND', path: rawPath };
          if ('code' in err && (err as NodeJS.ErrnoException).code === 'EACCES') return { error: 'PERMISSION_DENIED', path: rawPath };
          if ('code' in err && (err as NodeJS.ErrnoException).code === 'ENOTDIR') return { error: 'NOT_A_DIRECTORY', path: rawPath };
        }
        return { error: String(err) };
      }
    },
  });

  const ripgrepSchema = z.object({
    pattern: z.string().describe('The search pattern (regex supported by ripgrep)'),
    path: z.string().describe('File or directory path to search in'),
    agentId: z.string().optional().describe('Optional agent id'),
    caseSensitive: z.boolean().optional().default(false).describe('Case-sensitive search (default: false)'),
    maxResults: z.number().int().min(1).max(1000).optional().default(100).describe('Max results (default: 100)'),
    fileType: z.string().optional().describe('File type filter (e.g., "ts", "js", "md")'),
  });

  const ripgrepTool = tool({
    description: 'Search for a pattern in files using ripgrep. Fast text search with regex support.',
    inputSchema: ripgrepSchema,
    execute: async ({ pattern, path: rawPath, agentId, caseSensitive = false, maxResults = 100, fileType }) => {
      const allowedRoots = ctx.getAllowedRoots();
      try {
        const resolved = resolvePath(rawPath, agentId, ctx);
        ensureAllowed(resolved, allowedRoots);

        const args: string[] = [pattern, resolved];
        if (!caseSensitive) args.push('--ignore-case');
        if (fileType) args.push('--type', fileType);
        args.push('--max-count', String(maxResults));
        args.push('--with-filename', '--line-number', '--no-heading');
        args.push('--color', 'never');

        try {
          const { stdout, stderr } = await execFileAsync('rg', args, {
            maxBuffer: 10 * 1024 * 1024,
            timeout: 30000,
          });

          if (stderr && !stdout) {
            return { pattern, path: resolved, matches: [], message: 'No matches found' };
          }

          const lines = stdout.trim().split('\n').filter(Boolean);
          const matches = lines.map((line) => {
            const match = line.match(/^(.+?):(\d+):(.+)$/);
            if (match) {
              const [, filePath, lineNum, content] = match;
              return { file: filePath, line: parseInt(lineNum, 10), content: content.trim() };
            }
            return { file: resolved, line: 0, content: line };
          });

          return { pattern, path: resolved, matches, count: matches.length, truncated: matches.length >= maxResults };
        } catch (execErr: any) {
          if (execErr.code === 1) {
            return { pattern, path: resolved, matches: [], message: 'No matches found' };
          }
          if (execErr.message?.includes('rg: command not found') || execErr.message?.includes('rg: not found')) {
            return { error: 'RIPGREP_NOT_INSTALLED', message: 'ripgrep (rg) is not installed.' };
          }
          throw execErr;
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          if (err.message.startsWith('AGENT_NOT_FOUND')) return { error: err.message };
          if (err.message.startsWith('OUTSIDE_ALLOWED_PATH')) return { error: err.message };
          if ('code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') return { error: 'FILE_NOT_FOUND', path: rawPath };
          if ('code' in err && (err as NodeJS.ErrnoException).code === 'EACCES') return { error: 'PERMISSION_DENIED', path: rawPath };
        }
        return { error: String(err) };
      }
    },
  });

  return {
    read_file: readFileTool,
    write_file: writeFileTool,
    list_directory: listDirectoryTool,
    ripgrep: ripgrepTool,
  };
}
