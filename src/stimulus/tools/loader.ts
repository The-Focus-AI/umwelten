/**
 * Load tools from a work directory: each subdir of toolsDir with TOOL.md
 * (and optional handler.ts/handler.js) becomes one Tool.
 * Handlers must default-export a Tool from the Vercel AI SDK.
 */

import { readdir, readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
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

/**
 * Load a single tool from a directory that contains TOOL.md.
 * If handler.ts or handler.js exists, dynamic-import its default export (must be a Tool).
 * If type: script and script path are set, create a tool that runs the script with args.
 */
export async function loadToolFromPath(toolDir: string): Promise<{ name: string; tool: Tool } | null> {
  const toolMdPath = join(toolDir, TOOL_MD);
  let content: string;
  try {
    content = await readFile(toolMdPath, 'utf-8');
  } catch {
    return null;
  }

  const { data, content: body } = matter(content);
  const name = (data.name as string)?.trim() || undefined;
  const description = (data.description as string)?.trim();
  if (!description) {
    console.warn(`Tool at ${toolDir}: missing or invalid 'description' in TOOL.md`);
    return null;
  }

  const toolName = name || toolDir.split(/[/\\]/).filter(Boolean).pop() || 'unknown';
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
      const module = await import(url);
      const toolInstance = module?.default;
      if (!toolInstance || typeof (toolInstance as Tool).execute !== 'function') {
        console.warn(`Tool at ${toolDir}: handler default export is not a Tool (missing execute)`);
        return null;
      }
      return { name: toolName, tool: toolInstance as Tool };
    } catch (err) {
      console.warn(`Tool at ${toolDir}: failed to load handler:`, err instanceof Error ? err.message : err);
      return null;
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

  return null;
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
 */
export async function loadToolsFromDirectory(
  workDir: string,
  toolsDirRelative: string = 'tools'
): Promise<Record<string, Tool>> {
  const toolsDir = resolve(workDir, toolsDirRelative);
  const result: Record<string, Tool> = {};
  try {
    const entries = await readdir(toolsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const toolDir = join(toolsDir, entry.name);
      const loaded = await loadToolFromPath(toolDir);
      if (loaded) result[loaded.name] = loaded.tool;
    }
  } catch {
    // Directory does not exist or not readable
  }
  return result;
}
