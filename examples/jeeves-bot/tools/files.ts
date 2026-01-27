/**
 * Jeeves file tools: read_file, write_file, list_directory.
 * Paths are sandboxed to the Jeeves work directory and any configured agent project paths.
 * Without agentId, paths are relative to the work directory.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, normalize, relative } from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';
import type { JeevesConfig } from '../config.js';
import { loadConfig, getWorkDir, getAgentById, getFileAllowedRoots } from '../config.js';

const pathSchema = z.object({
  path: z.string().describe('File or directory path (relative to work dir, or to agent project if agentId is set)'),
  agentId: z
    .string()
    .optional()
    .describe('Optional agent id or name; if set, path is relative to that agent project. If omitted, path is relative to the Jeeves work directory.'),
});

function resolvePath(
  rawPath: string,
  agentId: string | undefined,
  config: JeevesConfig
): string {
  if (agentId) {
    const agent = getAgentById(config, agentId);
    if (!agent) {
      throw new Error(`AGENT_NOT_FOUND: ${agentId}`);
    }
    return resolve(agent.projectPath, rawPath);
  }
  return resolve(getWorkDir(), rawPath);
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

export function createReadFileTool() {
  return tool({
    description: 'Read the contents of a file. Without agentId, path is relative to the Jeeves work directory. With agentId, path is relative to that agent project.',
    inputSchema: pathSchema,
    execute: async ({ path: rawPath, agentId }) => {
      const config = await loadConfig();
      const roots = getFileAllowedRoots(config);
      try {
        const resolved = resolvePath(rawPath, agentId, config);
        ensureAllowed(resolved, roots);
        const content = await readFile(resolved, 'utf-8');
        return { path: resolved, content };
      } catch (err: unknown) {
        if (err instanceof Error) {
          if (err.message.startsWith('AGENT_NOT_FOUND')) return { error: err.message };
          if (err.message.startsWith('OUTSIDE_ALLOWED_PATH')) return { error: err.message };
          if ('code' in err && err.code === 'ENOENT') return { error: 'FILE_NOT_FOUND', path: rawPath };
          if ('code' in err && err.code === 'EACCES') return { error: 'PERMISSION_DENIED', path: rawPath };
        }
        return { error: String(err) };
      }
    },
  });
}

const writeFileSchema = z.object({
  path: z.string().describe('File path to write'),
  content: z.string().describe('Content to write'),
  agentId: z.string().optional().describe('Optional agent id; path is relative to that agent project'),
});

export function createWriteFileTool() {
  return tool({
    description: 'Write content to a file. Creates parent directories if needed. Without agentId, path is relative to the Jeeves work directory; with agentId, relative to that agent project.',
    inputSchema: writeFileSchema,
    execute: async ({ path: rawPath, content, agentId }) => {
      const config = await loadConfig();
      const roots = getFileAllowedRoots(config);
      try {
        const resolved = resolvePath(rawPath, agentId, config);
        ensureAllowed(resolved, roots);
        await mkdir(resolve(resolved, '..'), { recursive: true });
        await writeFile(resolved, content, 'utf-8');
        return { path: resolved, written: true };
      } catch (err: unknown) {
        if (err instanceof Error) {
          if (err.message.startsWith('AGENT_NOT_FOUND')) return { error: err.message };
          if (err.message.startsWith('OUTSIDE_ALLOWED_PATH')) return { error: err.message };
          if ('code' in err && err.code === 'EACCES') return { error: 'PERMISSION_DENIED', path: rawPath };
        }
        return { error: String(err) };
      }
    },
  });
}

export function createListDirectoryTool() {
  return tool({
    description: 'List directory entries (files and subdirectories). Without agentId, path is relative to the Jeeves work directory (use "." to list the work dir); with agentId, path is relative to that agent project.',
    inputSchema: pathSchema,
    execute: async ({ path: rawPath, agentId }) => {
      const config = await loadConfig();
      const roots = getFileAllowedRoots(config);
      try {
        const resolved = resolvePath(rawPath, agentId, config);
        ensureAllowed(resolved, roots);
        const entries = await readdir(resolved, { withFileTypes: true });
        const list = entries.map(e => ({ name: e.name, isDir: e.isDirectory() }));
        return { path: resolved, entries: list };
      } catch (err: unknown) {
        if (err instanceof Error) {
          if (err.message.startsWith('AGENT_NOT_FOUND')) return { error: err.message };
          if (err.message.startsWith('OUTSIDE_ALLOWED_PATH')) return { error: err.message };
          if ('code' in err && err.code === 'ENOENT') return { error: 'FILE_NOT_FOUND', path: rawPath };
          if ('code' in err && err.code === 'EACCES') return { error: 'PERMISSION_DENIED', path: rawPath };
          if ('code' in err && err.code === 'ENOTDIR') return { error: 'NOT_A_DIRECTORY', path: rawPath };
        }
        return { error: String(err) };
      }
    },
  });
}
