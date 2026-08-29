/**
 * Load tools from a work directory: each subdir of toolsDir with TOOL.md
 * (and optional handler.ts/handler.js) becomes one Tool.
 * Handlers must default-export a Tool from the Vercel AI SDK.
 */

import { readdir, readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import matter from 'gray-matter';
import { tool } from 'ai';
import { z } from 'zod';
import type { Tool } from 'ai';

const TOOL_MD = 'TOOL.md';
const HANDLER_TS = 'handler.ts';
const HANDLER_JS = 'handler.js';

export interface ToolDefinitionMeta {
  name: string;
  description: string;
  path: string;
  /** If set, run this script with args instead of loading a handler module. */
  type?: 'script';
  script?: string;
  /** Optional JSON Schema for parameters; used for script tools. */
  parameters?: unknown;
}

export interface ToolLoadIssue {
  name: string;
  path: string;
  message: string;
}

export interface ToolLoadOptions {
  strict?: boolean;
  onIssue?: (issue: ToolLoadIssue) => void;
}

function skipTool(
  name: string,
  path: string,
  message: string,
  options?: ToolLoadOptions,
): null {
  options?.onIssue?.({ name, path, message });
  console.warn(message);
  return null;
}

/**
 * Load a single tool from a directory that contains TOOL.md.
 * If handler.ts or handler.js exists, dynamic-import its default export.
 *   - If the export is a Tool (has .execute), use it directly.
 *   - If the export is a function (factory), call it with the context to get a Tool.
 * If type: script and script path are set, create a tool that runs the script with args.
 * @param toolDir - Path to the tool directory
 * @param context - Optional context object passed to factory-pattern handlers
 */
export async function loadToolFromPath(
  toolDir: string,
  context?: unknown,
  options?: ToolLoadOptions,
): Promise<{ name: string; tool: Tool } | null> {
  const toolMdPath = join(toolDir, TOOL_MD);
  const fallbackName = toolDir.split(/[/\\]/).filter(Boolean).pop() || 'unknown';
  let content: string;
  try {
    content = await readFile(toolMdPath, 'utf-8');
  } catch {
    return null;
  }

  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(content);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const message = `Tool at ${toolDir}: failed to parse TOOL.md: ${detail}`;
    if (options?.strict) throw new Error(message, { cause: err });
    return skipTool(fallbackName, toolDir, message, options);
  }
  const { data, content: body } = parsed;
  const name = (data.name as string)?.trim() || undefined;
  const toolName = name || fallbackName;
  const description = (data.description as string)?.trim();
  if (!description) {
    const message = `Tool at ${toolDir}: missing or invalid 'description' in TOOL.md`;
    if (options?.strict) throw new Error(message);
    return skipTool(toolName, toolDir, message, options);
  }

  const toolType = data.type as string | undefined;
  const scriptPath = data.script as string | undefined;

  // Handler module: default export must be a Tool
  const handlerTs = join(toolDir, HANDLER_TS);
  const handlerJs = join(toolDir, HANDLER_JS);
  const hasHandler = await fileExists(handlerTs) || await fileExists(handlerJs);
  const handlerPath = (await fileExists(handlerTs)) ? handlerTs : (await fileExists(handlerJs)) ? handlerJs : null;

  if (handlerPath) {
    try {
      const url = pathToFileURL(resolve(handlerPath)).href;
      const version = createHash('sha256')
        .update(await readFile(handlerPath))
        .digest('hex')
        .slice(0, 16);
      const module = await import(`${url}?v=${version}`);
      const exported = module?.default;

      if (exported && typeof (exported as Tool).execute === 'function') {
        // Direct Tool export (existing behavior)
        return { name: toolName, tool: exported as Tool };
      }

      if (typeof exported === 'function') {
        // Factory pattern: handler exports (context) => Tool
        const toolInstance = exported(context);
        if (!toolInstance || typeof (toolInstance as Tool).execute !== 'function') {
          const message = `Tool at ${toolDir}: factory function did not return a Tool (missing execute)`;
          if (options?.strict) throw new Error(message);
          return skipTool(toolName, toolDir, message, options);
        }
        return { name: toolName, tool: toolInstance as Tool };
      }

      const message = `Tool at ${toolDir}: handler default export is not a Tool or factory function`;
      if (options?.strict) throw new Error(message);
      return skipTool(toolName, toolDir, message, options);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (options?.strict) {
        throw new Error(`Tool at ${toolDir}: failed to load handler: ${detail}`, {
          cause: err,
        });
      }
      return skipTool(
        toolName,
        toolDir,
        `Tool at ${toolDir}: failed to load handler: ${detail}`,
        options,
      );
    }
  }

  if (toolType === 'script' && scriptPath) {
    const scriptFullPath = resolve(toolDir, scriptPath);
    const scriptTool = tool({
      description,
      inputSchema: z.object({
        args: z.string().optional().describe('Arguments to pass to the script (e.g. JSON or space-separated)'),
      }),
      execute: async ({ args }) => {
        return new Promise((resolvePromise, reject) => {
          const child = spawn(process.execPath, [scriptFullPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false,
          });
          if (args) child.stdin?.write(args);
          child.stdin?.end();
          let stdout = '';
          let stderr = '';
          child.stdout?.on('data', (chunk) => { stdout += chunk; });
          child.stderr?.on('data', (chunk) => { stderr += chunk; });
          child.on('close', (code) => {
            if (code !== 0) {
              reject(new Error(stderr || `Script exited with code ${code}`));
            } else {
              resolvePromise({ stdout, stderr });
            }
          });
          child.on('error', reject);
        });
      },
    });
    return { name: toolName, tool: scriptTool };
  }

  if (options?.strict) {
    throw new Error(`Tool at ${toolDir}: TOOL.md has no handler or script`);
  }
  return skipTool(
    toolName,
    toolDir,
    `Tool at ${toolDir}: TOOL.md has no handler or script`,
    options,
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load all tools from a directory: each subdirectory that contains TOOL.md
 * (and optional handler.ts/handler.js or type: script) becomes one tool.
 * @param workDir - Absolute path to the work directory
 * @param toolsDirRelative - Path to tools dir relative to workDir (e.g. "./tools")
 * @param context - Optional context object passed to factory-pattern handlers
 */
export async function loadToolsFromDirectory(
  workDir: string,
  toolsDirRelative: string = 'tools',
  context?: unknown,
  options?: ToolLoadOptions,
): Promise<Record<string, Tool>> {
  const toolsDir = resolve(workDir, toolsDirRelative);
  const result: Record<string, Tool> = {};
  let entries;
  try {
    entries = await readdir(toolsDir, { withFileTypes: true });
  } catch {
    // Directory does not exist or not readable
    return result;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const toolDir = join(toolsDir, entry.name);
    const loaded = await loadToolFromPath(toolDir, context, options);
    if (loaded) result[loaded.name] = loaded.tool;
  }
  return result;
}
