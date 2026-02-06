/**
 * Jeeves file tools: read_file, write_file, list_directory.
 * Paths are sandboxed to the Jeeves work directory and any configured agent project paths.
 * Without agentId, paths are relative to the work directory.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, normalize, relative, join, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tool } from 'ai';
import { z } from 'zod';
import type { JeevesConfig } from '../config.js';
import { loadConfig, getWorkDir, getSessionsDir, getAgentById, getFileAllowedRoots } from '../config.js';

const execFileAsync = promisify(execFile);

const pathSchema = z.object({
  path: z.string().describe('File or directory path (relative to work dir, or to agent project if agentId is set)'),
  agentId: z
    .string()
    .optional()
    .describe('Optional agent id or name; if set, path is relative to that agent project. If omitted, path is relative to the Jeeves work directory.'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Optional line offset (0-based) to start reading from. If not provided, reads from the beginning.'),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Optional maximum number of lines to read. If not provided, reads to the end of the file.'),
});

/**
 * Resolve path for file tools. When no agentId, leading "/" is treated as the work dir (chroot-style)
 * so "/" = work dir, "/repos" = work dir/repos. Real absolute paths under an allowed root are still
 * accepted (e.g. full filePath from markify).
 */
function resolvePath(
  rawPath: string,
  agentId: string | undefined,
  config: JeevesConfig,
  allowedRoots: string[]
): string {
  const workDir = getWorkDir();

  if (agentId) {
    const agent = getAgentById(config, agentId);
    if (!agent) {
      throw new Error(`AGENT_NOT_FOUND: ${agentId}`);
    }
    return resolve(agent.projectPath, rawPath);
  }

  // Leading "/" (but not "//") = virtual root = work dir (so "/repos" → workDir/repos)
  if (rawPath.startsWith('/') && !rawPath.startsWith('//')) {
    const asAbsolute = normalize(resolve(rawPath));
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

  // Other absolute paths (e.g. Windows C:\, or full host path)
  if (rawPath.startsWith('\\') || (process.platform === 'win32' && /^[A-Za-z]:/.test(rawPath))) {
    return normalize(resolve(rawPath));
  }

  return resolve(workDir, rawPath);
}

function ensureAllowed(resolved: string, allowedRoots: string[]): void {
  const normalized = normalize(resolved);
  
  // Check against allowed roots (work dir, sessions dir, and agent projects)
  for (const root of allowedRoots) {
    const rootNorm = normalize(root);
    const rel = relative(rootNorm, normalized);
    if (rel && !rel.startsWith('..') && !rel.startsWith('/')) {
      return;
    }
    if (normalized === rootNorm) return;
  }
  throw new Error('OUTSIDE_ALLOWED_PATH: path is not under the Jeeves work directory, sessions directory, or any configured agent project');
}

export function createReadFileTool() {
  return tool({
    description: 'Read the contents of a file. Without agentId, path is relative to the Jeeves work directory. With agentId, path is relative to that agent project. Use offset and limit to read portions of large files (e.g., offset: 0, limit: 100 to read first 100 lines).',
    inputSchema: pathSchema,
    execute: async ({ path: rawPath, agentId, offset, limit }) => {
      const config = await loadConfig();
      const roots = getFileAllowedRoots(config);
      try {
        const resolved = resolvePath(rawPath, agentId, config, roots);
        ensureAllowed(resolved, roots);
        const fullContent = await readFile(resolved, 'utf-8');
        console.log(`[JEEVES] Read file: ${resolved} (${fullContent.length} bytes)`);
        
        // If offset or limit is specified, slice the content by lines
        if (offset !== undefined || limit !== undefined) {
          const lines = fullContent.split('\n');
          const totalLines = lines.length;
          const startLine = offset ?? 0;
          const endLine = limit !== undefined ? startLine + limit : totalLines;
          const slicedLines = lines.slice(startLine, endLine);
          const slicedContent = slicedLines.join('\n');
          
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
        const resolved = resolvePath(rawPath, agentId, config, roots);
        ensureAllowed(resolved, roots);
        await mkdir(resolve(resolved, '..'), { recursive: true });
        await writeFile(resolved, content, 'utf-8');
        console.log(`[JEEVES] Wrote file: ${resolved} (${content.length} bytes)`);
        return { path: resolved, written: true };
      } catch (err: unknown) {
        if (err instanceof Error) {
          if (err.message.startsWith('AGENT_NOT_FOUND')) return { error: err.message };
          if (err.message.startsWith('OUTSIDE_ALLOWED_PATH')) return { error: err.message };
          if ('code' in err && err.code === 'EACCES') return { error: 'PERMISSION_DENIED', path: rawPath };
        }
        console.error(`[JEEVES] Error writing file ${rawPath}:`, err);
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
        const resolved = resolvePath(rawPath, agentId, config, roots);
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

const ripgrepSchema = z.object({
  pattern: z.string().describe('The search pattern (regex supported by ripgrep)'),
  path: z.string().describe('File or directory path to search in (relative to work dir, or to agent project if agentId is set)'),
  agentId: z
    .string()
    .optional()
    .describe('Optional agent id or name; if set, path is relative to that agent project. If omitted, path is relative to the Jeeves work directory.'),
  caseSensitive: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether the search should be case-sensitive (default: false)'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .default(100)
    .describe('Maximum number of results to return (default: 100, max: 1000)'),
  fileType: z
    .string()
    .optional()
    .describe('Optional file type filter (e.g., "ts", "js", "md"). Searches only files with this extension.'),
});

export function createRipgrepTool() {
  return tool({
    description: 'Search for a pattern in files using ripgrep (rg). Fast and efficient text search across files. Supports regex patterns. Without agentId, path is relative to the Jeeves work directory; with agentId, path is relative to that agent project.',
    inputSchema: ripgrepSchema,
    execute: async ({ pattern, path: rawPath, agentId, caseSensitive = false, maxResults = 100, fileType }) => {
      const config = await loadConfig();
      const roots = getFileAllowedRoots(config);
      try {
        const resolved = resolvePath(rawPath, agentId, config, roots);
        ensureAllowed(resolved, roots);
        
        // Build ripgrep arguments (safe - no shell injection)
        const args: string[] = [];
        
        // Pattern (passed directly, no shell escaping needed with execFile)
        args.push(pattern);
        
        // Path
        args.push(resolved);
        
        // Case sensitivity
        if (!caseSensitive) {
          args.push('--ignore-case');
        }
        
        // File type filter
        if (fileType) {
          args.push('--type', fileType);
        }
        
        // Limit results
        args.push('--max-count', String(maxResults));
        
        // Output format: file:line:match
        args.push('--with-filename', '--line-number', '--no-heading');
        
        // Color disabled for parsing
        args.push('--color', 'never');
        
        try {
          const { stdout, stderr } = await execFileAsync('rg', args, {
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
            timeout: 30000, // 30 second timeout
          });
          
          if (stderr && !stdout) {
            // ripgrep returns exit code 1 when no matches found, but stderr might have info
            return {
              pattern,
              path: resolved,
              matches: [],
              message: 'No matches found',
            };
          }
          
          // Parse ripgrep output: file:line:match
          const lines = stdout.trim().split('\n').filter(Boolean);
          const matches = lines.map((line) => {
            // Format: filepath:line:match
            const match = line.match(/^(.+?):(\d+):(.+)$/);
            if (match) {
              const [, filePath, lineNum, content] = match;
              return {
                file: filePath,
                line: parseInt(lineNum, 10),
                content: content.trim(),
              };
            }
            // Fallback if format doesn't match
            return {
              file: resolved,
              line: 0,
              content: line,
            };
          });
          
          return {
            pattern,
            path: resolved,
            matches,
            count: matches.length,
            truncated: matches.length >= maxResults,
          };
        } catch (execErr: any) {
          // ripgrep exits with code 1 when no matches found - this is normal
          if (execErr.code === 1) {
            return {
              pattern,
              path: resolved,
              matches: [],
              message: 'No matches found',
            };
          }
          
          // Check if ripgrep is not installed
          if (execErr.message?.includes('rg: command not found') || execErr.message?.includes('rg: not found')) {
            return {
              error: 'RIPGREP_NOT_INSTALLED',
              message: 'ripgrep (rg) is not installed. Install it with: brew install ripgrep (macOS) or apt-get install ripgrep (Linux)',
            };
          }
          
          throw execErr;
        }
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
