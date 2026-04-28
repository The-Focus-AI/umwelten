/**
 * Sandboxed filesystem tool factories.
 *
 * Each factory takes a list of allowed roots and returns a Vercel AI SDK Tool.
 * Operations are restricted to paths under those roots via `resolveSandboxPath` +
 * `ensureAllowed`. Habitat's `createFileTools` is a thin agent-aware wrapper
 * over these.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { resolveSandboxPath, ensureAllowed, OUTSIDE_ALLOWED_PATH } from './path-sandbox.js';

const execFileAsync = promisify(execFile);

const readSchema = z.object({
  path: z.string().describe('File path (relative to the workspace root, or absolute under an allowed root)'),
  offset: z.number().int().min(0).optional().describe('Optional 0-based line offset to start reading from'),
  limit: z.number().int().min(1).optional().describe('Optional maximum number of lines to read'),
});

const writeSchema = z.object({
  path: z.string().describe('File path to write (parent directories are created automatically)'),
  content: z.string().describe('Content to write'),
});

const mkdirSchema = z.object({
  path: z.string().describe('Directory path to create (created recursively, like `mkdir -p`)'),
});

const listSchema = z.object({
  path: z.string().describe('Directory path to list (use "." for the workspace root)'),
});

const ripgrepSchema = z.object({
  pattern: z.string().describe('Search pattern (regex supported by ripgrep)'),
  path: z.string().describe('File or directory path to search in'),
  caseSensitive: z.boolean().optional().default(false).describe('Case-sensitive search (default: false)'),
  maxResults: z.number().int().min(1).max(1000).optional().default(100).describe('Max results (default: 100)'),
  fileType: z.string().optional().describe('File type filter (e.g., "ts", "js", "md")'),
});

function classify(err: unknown, rawPath: string) {
  if (err instanceof Error) {
    if (err.message.startsWith(OUTSIDE_ALLOWED_PATH)) return { error: err.message };
    if ('code' in err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { error: 'FILE_NOT_FOUND', path: rawPath };
      if (code === 'EACCES') return { error: 'PERMISSION_DENIED', path: rawPath };
      if (code === 'ENOTDIR') return { error: 'NOT_A_DIRECTORY', path: rawPath };
    }
  }
  return { error: String(err) };
}

export function createReadTool(roots: string[]): Tool {
  return tool({
    description:
      'Read the contents of a file. Path is relative to the workspace root. Use offset/limit to read portions of large files.',
    inputSchema: readSchema,
    execute: async ({ path: rawPath, offset, limit }) => {
      try {
        const resolved = resolveSandboxPath(rawPath, roots);
        ensureAllowed(resolved, roots);
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
      } catch (err) {
        return classify(err, rawPath);
      }
    },
  });
}

export function createWriteTool(roots: string[]): Tool {
  return tool({
    description:
      'Write content to a file. Creates parent directories if needed. Path is relative to the workspace root.',
    inputSchema: writeSchema,
    execute: async ({ path: rawPath, content }) => {
      try {
        const resolved = resolveSandboxPath(rawPath, roots);
        ensureAllowed(resolved, roots);
        await mkdir(resolve(resolved, '..'), { recursive: true });
        await writeFile(resolved, content, 'utf-8');
        return { path: resolved, written: true };
      } catch (err) {
        return classify(err, rawPath);
      }
    },
  });
}

export function createMkdirTool(roots: string[]): Tool {
  return tool({
    description: 'Create a directory (and any missing parent directories). Path is relative to the workspace root.',
    inputSchema: mkdirSchema,
    execute: async ({ path: rawPath }) => {
      try {
        const resolved = resolveSandboxPath(rawPath, roots);
        ensureAllowed(resolved, roots);
        await mkdir(resolved, { recursive: true });
        return { path: resolved, created: true };
      } catch (err) {
        return classify(err, rawPath);
      }
    },
  });
}

export function createListDirectoryTool(roots: string[]): Tool {
  return tool({
    description: 'List directory entries (files and subdirectories). Path is relative to the workspace root.',
    inputSchema: listSchema,
    execute: async ({ path: rawPath }) => {
      try {
        const resolved = resolveSandboxPath(rawPath, roots);
        ensureAllowed(resolved, roots);
        const entries = await readdir(resolved, { withFileTypes: true });
        const list = entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
        return { path: resolved, entries: list };
      } catch (err) {
        return classify(err, rawPath);
      }
    },
  });
}

export function createRipgrepTool(roots: string[]): Tool {
  return tool({
    description: 'Search for a pattern in files using ripgrep. Fast text search with regex support.',
    inputSchema: ripgrepSchema,
    execute: async ({ pattern, path: rawPath, caseSensitive = false, maxResults = 100, fileType }) => {
      try {
        const resolved = resolveSandboxPath(rawPath, roots);
        ensureAllowed(resolved, roots);

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
      } catch (err) {
        return classify(err, rawPath);
      }
    },
  });
}

/**
 * Convenience: build the standard fs tool record (read, write, create_directory,
 * list_directory, ripgrep) parameterized on a sandbox root list.
 */
export function createFsTools(roots: string[]): Record<string, Tool> {
  return {
    read: createReadTool(roots),
    write: createWriteTool(roots),
    create_directory: createMkdirTool(roots),
    list_directory: createListDirectoryTool(roots),
    ripgrep: createRipgrepTool(roots),
  };
}
