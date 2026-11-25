/**
 * Pluggable Pi Durable extensions for isolated coding-session evaluations.
 *
 * Always starts from Pi's default `CodingTools` (`read`, `write`, `edit`, `bash`)
 * scoped to the isolated checkout via `createRepoScopeExtension`, plus our
 * `beforeProviderRequest` thinking-effort injector. Optional built-in and custom
 * extension modules layer cleanly on top.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path, { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import type { Api as PiApi, Model as PiModel } from "@earendil-works/pi-ai";
import {
  defineExtension,
  defineTool,
  GenerationTask,
  hook,
  ToolTask,
  type Extension,
} from "@earendil-works/pi-durable";
import { createCodemodeExtension } from "@earendil-works/pi-durable/codemode";
import { createToolSearchExtension } from "@earendil-works/pi-durable/tool-search";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { int, obj, opt, str } from "@earendil-works/pi-schema";
import { createRepoScopeExtension } from "@umwelten/habitat";
import {
  canonicalizeThinkingEffort,
  extractStepCostUsd,
  resolveThinkingStreamOptions,
  type ModelSpec,
  type ResolvedPiInvocationTarget,
} from "@umwelten/pi";
import type {
  CodingExtensionContext,
  CodingSessionEvent,
  CodingTaskSpec,
} from "./types.js";

const execFileAsync = promisify(execFile);

export const BUILTIN_CODING_EXTENSIONS = [
  "pi-default",
  "search-tools",
  "tool-search",
  "codemode",
  "verify-on-yield",
] as const;

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  ".pytest_cache",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMergeInto(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = deepMergeInto(out[k] as Record<string, unknown>, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const normCandidate = resolve(candidatePath);
  const normRoot = resolve(rootPath);
  return (
    normCandidate === normRoot || normCandidate.startsWith(`${normRoot}${sep}`)
  );
}

async function walkWorkspaceFiles(
  rootDir: string,
  subDir: string = rootDir,
): Promise<string[]> {
  const entries = await fs.readdir(subDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const abs = path.join(subDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkWorkspaceFiles(rootDir, abs)));
    } else if (entry.isFile()) {
      files.push(path.relative(rootDir, abs).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

/**
 * Injects provider-specific thinking/extraBody knobs (`ollama`, `mlx`, local servers,
 * custom `extraBody`, and Google `@off` zero-budget thinking) into every `GenerationTask`
 * request body without stripping `max_tokens`.
 */
export function createProviderPayloadExtension(
  spec: ModelSpec,
  target: ResolvedPiInvocationTarget,
): Extension {
  const thinking = resolveThinkingStreamOptions(
    target.piModel,
    spec.provider,
    spec.reasoningEffort,
  );
  const canonicalRequested = canonicalizeThinkingEffort(spec.reasoningEffort);
  const patch = deepMergeInto(
    target.extraBody ?? {},
    thinking.extraPayloadPatch,
  );
  const hasPatch = Object.keys(patch).length > 0;
  const forceGoogleOff =
    target.piModel.api === "google-generative-ai" &&
    canonicalRequested === "off";

  return defineExtension({
    name: "umwelten.coding-eval.provider-payload",
    hooks: [
      hook(GenerationTask, {
        beforeProviderRequest({ model, payload }) {
          if (!isPlainObject(payload)) return undefined;
          let next: Record<string, unknown> = payload;
          let changed = false;

          if (hasPatch) {
            next = deepMergeInto(next, patch);
            changed = true;
          }

          if (forceGoogleOff && model.api === "google-generative-ai") {
            const genCfg = isPlainObject(next.generationConfig)
              ? next.generationConfig
              : {};
            next = {
              ...next,
              generationConfig: {
                ...genCfg,
                thinkingConfig: { thinkingBudget: 0 },
              },
            };
            changed = true;
          }

          return changed ? { payload: next } : undefined;
        },
      }),
    ],
  });
}

/**
 * Repo-scoped read-only `find_files` and `grep_files` tools for fast code navigation.
 */
export function createSearchToolsExtension(workspaceDir: string): Extension {
  const root = resolve(workspaceDir);

  const findFilesTool = defineTool({
    name: "find_files",
    description:
      "List files in the repository workspace, optionally filtered by substring or glob pattern (e.g. '*.ts' or 'src/').",
    parameters: obj({
      pattern: opt(
        str({
          description:
            "Optional substring or glob pattern (* and ? supported) matched against relative file paths.",
        }),
      ),
      maxResults: opt(
        int({
          minimum: 1,
          maximum: 500,
          description: "Maximum paths to return (default 100).",
        }),
      ),
    }),
    async execute(args) {
      const files = await walkWorkspaceFiles(root);
      const maxResults = Math.min(Math.max(args.maxResults ?? 100, 1), 500);
      let matched = files;
      if (args.pattern && args.pattern.trim()) {
        const pat = args.pattern.trim();
        if (pat.includes("*") || pat.includes("?")) {
          const escaped = pat
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".");
          const re = new RegExp(escaped, "i");
          matched = files.filter((f) => re.test(f));
        } else {
          const lower = pat.toLowerCase();
          matched = files.filter((f) => f.toLowerCase().includes(lower));
        }
      }
      const slice = matched.slice(0, maxResults);
      const text =
        slice.length > 0
          ? slice.join("\n") +
            (matched.length > slice.length
              ? `\n... (${matched.length - slice.length} more files truncated)`
              : "")
          : "(no matching files)";
      return {
        output: [{ type: "text", text }],
        details: { total: matched.length, returned: slice.length },
      };
    },
  });

  const grepFilesTool = defineTool({
    name: "grep_files",
    description:
      "Search text or regular expression matches across source files inside the workspace.",
    parameters: obj({
      query: str({
        minLength: 1,
        description: "Text substring or regular expression to search for.",
      }),
      path: opt(
        str({
          description:
            "Optional relative file or directory inside the workspace to restrict search.",
        }),
      ),
      maxMatches: opt(
        int({
          minimum: 1,
          maximum: 200,
          description: "Maximum matching lines to return (default 50).",
        }),
      ),
    }),
    async execute(args) {
      const targetPath = args.path ? resolve(root, args.path) : root;
      if (!isWithinRoot(targetPath, root)) {
        return {
          isError: true,
          output: [
            {
              type: "text",
              text: `Path "${args.path}" is outside the workspace root.`,
            },
          ],
        };
      }

      const maxMatches = Math.min(Math.max(args.maxMatches ?? 50, 1), 200);
      let candidateFiles: string[];
      try {
        const stat = await fs.stat(targetPath);
        if (stat.isFile()) {
          candidateFiles = [
            path.relative(root, targetPath).split(path.sep).join("/"),
          ];
        } else {
          candidateFiles = (await walkWorkspaceFiles(root, targetPath)).map(
            (rel) =>
              path
                .relative(root, path.join(targetPath, rel))
                .split(path.sep)
                .join("/"),
          );
        }
      } catch (err) {
        return {
          isError: true,
          output: [
            {
              type: "text",
              text: err instanceof Error ? err.message : String(err),
            },
          ],
        };
      }

      let regex: RegExp;
      try {
        regex = new RegExp(args.query, "i");
      } catch {
        const escaped = args.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        regex = new RegExp(escaped, "i");
      }

      const hits: string[] = [];
      for (const rel of candidateFiles) {
        if (hits.length >= maxMatches) break;
        const abs = path.join(root, rel);
        try {
          const st = await fs.stat(abs);
          if (st.size > 512 * 1024) continue;
          const content = await fs.readFile(abs, "utf8");
          if (content.includes("\u0000")) continue;
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              hits.push(`${rel}:${i + 1}: ${lines[i].slice(0, 220)}`);
              if (hits.length >= maxMatches) break;
            }
          }
        } catch {
          // Skip unreadable files
        }
      }

      return {
        output: [
          {
            type: "text",
            text: hits.length > 0 ? hits.join("\n") : "(no matches)",
          },
        ],
        details: { matches: hits.length },
      };
    },
  });

  return defineExtension({
    name: "umwelten.coding-eval.search-tools",
    tools: [findFilesTool, grepFilesTool],
  });
}

/**
 * Self-check extension: when the model yields a final answer while visible tests
 * are still failing, automatically nudges it to inspect and fix the remaining failures.
 */
export function createVerifyOnYieldExtension(
  ctx: CodingExtensionContext,
  maxNudges: number = 2,
): Extension {
  let nudgesUsed = 0;

  return defineExtension({
    name: "umwelten.coding-eval.verify-on-yield",
    hooks: [
      hook(GenerationTask, {
        async onYield(_answer, _api) {
          if (nudgesUsed >= maxNudges) return undefined;
          try {
            await execFileAsync("sh", ["-c", ctx.task.visibleTestCommand], {
              cwd: ctx.workspaceDir,
              timeout: 20_000,
              maxBuffer: 1024 * 1024,
              env: { ...process.env, NODE_NO_WARNINGS: "1" },
            });
            return undefined;
          } catch (err) {
            nudgesUsed++;
            const execErr = err as { stdout?: string; stderr?: string; message?: string };
            const output = [execErr.stdout ?? "", execErr.stderr ?? ""]
              .filter(Boolean)
              .join("\n")
              .trim();
            const snippet = (output || execErr.message || "Command failed").slice(
              -1800,
            );
            return {
              continue:
                `Visible tests are still failing (${ctx.task.visibleTestCommand}):\n` +
                "```\n" +
                snippet +
                "\n```\n" +
                "Inspect the failures and fix the root cause before finishing.",
            };
          }
        },
      }),
    ],
  });
}

/**
 * Dynamically import a custom user-supplied `pi-durable` extension module.
 * Supports exporting `default`, `extension`, or `createExtension(ctx)`.
 */
export async function loadCustomCodingExtension(
  filePath: string,
  ctx: CodingExtensionContext,
): Promise<Extension> {
  const absPath = resolve(filePath);
  const mod = (await import(pathToFileURL(absPath).href)) as Record<
    string,
    unknown
  >;
  const candidate = mod.createExtension ?? mod.extension ?? mod.default;
  if (typeof candidate === "function") {
    const built = await (
      candidate as (c: CodingExtensionContext) => Extension | Promise<Extension>
    )(ctx);
    if (!isPlainObject(built) || typeof built.name !== "string") {
      throw new Error(
        `Custom extension factory in "${filePath}" must return a pi-durable Extension object with a string .name.`,
      );
    }
    return built as Extension;
  }
  if (isPlainObject(candidate) && typeof candidate.name === "string") {
    return candidate as unknown as Extension;
  }
  throw new Error(
    `Custom extension module "${filePath}" must export a default, extension, or createExtension(ctx) yielding a pi-durable Extension.`,
  );
}

export interface ResolvedCodingExtensionStack {
  extensions: Extension[];
  profileId: string;
  systemPromptAddendum: string;
  cleanup: () => Promise<void>;
}

const OPTIONAL_ORDER: readonly string[] = [
  "search-tools",
  "tool-search",
  "codemode",
  "verify-on-yield",
];

/**
 * Assemble the Pi Durable extension stack for one coding task run:
 * always includes `CodingTools`, `createRepoScopeExtension`, and `createProviderPayloadExtension`,
 * plus any requested built-in or custom extensions.
 */
export async function resolveCodingExtensionStack(options: {
  names?: string[];
  customPaths?: string[];
  extraExtensions?: Extension[];
  workspaceDir: string;
  task: CodingTaskSpec;
  spec: ModelSpec;
  target: ResolvedPiInvocationTarget;
}): Promise<ResolvedCodingExtensionStack> {
  const ctx: CodingExtensionContext = {
    workspaceDir: options.workspaceDir,
    task: options.task,
  };

  const requestedOptional = new Set<string>();
  for (const rawName of options.names ?? []) {
    const name = rawName.trim();
    if (!name || name === "pi-default") continue;
    if (!OPTIONAL_ORDER.includes(name)) {
      throw new Error(
        `Unknown coding extension "${name}". Valid built-ins: ${BUILTIN_CODING_EXTENSIONS.join(", ")}.`,
      );
    }
    requestedOptional.add(name);
  }

  const extensions: Extension[] = [
    CodingTools,
    createRepoScopeExtension({ ownedRoot: options.workspaceDir }),
    createProviderPayloadExtension(options.spec, options.target),
  ];

  const profileParts: string[] = ["pi-default"];
  const notes: string[] = [];
  let codemodeSandbox: CodemodeSandbox | undefined;

  for (const name of OPTIONAL_ORDER) {
    if (!requestedOptional.has(name)) continue;
    profileParts.push(name);
    if (name === "search-tools") {
      extensions.push(createSearchToolsExtension(options.workspaceDir));
      notes.push(
        "Use `find_files` and `grep_files` to inspect repository structure and references before editing.",
      );
    } else if (name === "tool-search") {
      extensions.push(createToolSearchExtension());
      notes.push("Deferred tools can be discovered with `tool_search`.");
    } else if (name === "codemode") {
      codemodeSandbox = new CodemodeSandbox();
      extensions.push(createCodemodeExtension({ sandbox: codemodeSandbox }));
      notes.push(
        "You can batch multi-file reads or analysis via `codemode` when helpful.",
      );
    } else if (name === "verify-on-yield") {
      extensions.push(createVerifyOnYieldExtension(ctx));
    }
  }

  for (const customPath of options.customPaths ?? []) {
    const trimmed = customPath.trim();
    if (!trimmed) continue;
    const loaded = await loadCustomCodingExtension(trimmed, ctx);
    extensions.push(loaded);
    const base = path.basename(trimmed).replace(/\.(ts|mts|cts|js|mjs|cjs)$/i, "");
    profileParts.push(base || loaded.name);
  }

  for (const extra of options.extraExtensions ?? []) {
    extensions.push(extra);
    if (extra.name) profileParts.push(extra.name);
  }

  return {
    extensions,
    profileId: profileParts.join("+"),
    systemPromptAddendum: notes.join(" "),
    cleanup: async () => {
      if (codemodeSandbox) {
        await codemodeSandbox.close();
      }
    },
  };
}

/**
 * Emits real-time `turn_start`, `assistant_turn`, `tool_start`, and `tool_end`
 * events from `GenerationTask` and `ToolTask` hooks during a live coding session.
 */
export function createSessionTraceExtension(
  piModel: PiModel<PiApi>,
  onEvent: (event: CodingSessionEvent) => void,
): Extension {
  let turn = 0;

  return defineExtension({
    name: "umwelten.coding-eval.session-trace",
    hooks: [
      hook(GenerationTask, {
        beforeRequest({ messages }) {
          turn += 1;
          onEvent({
            type: "turn_start",
            turn,
            messageCount: messages.length,
            timestamp: Date.now(),
          });
          return undefined;
        },
        afterResponse(message) {
          const thinkingParts: string[] = [];
          const textParts: string[] = [];
          const toolCalls: Array<{
            id: string;
            name: string;
            arguments: Record<string, unknown>;
          }> = [];

          for (const block of message.content) {
            if (block.type === "thinking" && block.thinking.trim()) {
              thinkingParts.push(block.thinking);
            } else if (block.type === "text" && block.text.trim()) {
              textParts.push(block.text);
            } else if (block.type === "toolCall") {
              toolCalls.push({
                id: block.id,
                name: block.name,
                arguments: (block.arguments ?? {}) as Record<string, unknown>,
              });
            }
          }

          onEvent({
            type: "assistant_turn",
            turn: turn || 1,
            thinking: thinkingParts.join("\n"),
            text: textParts.join("\n"),
            toolCalls,
            costUsd: Number(extractStepCostUsd(piModel, message.usage).toFixed(6)),
            tokens: {
              prompt: message.usage?.input ?? 0,
              completion: message.usage?.output ?? 0,
              cacheRead: message.usage?.cacheRead ?? 0,
              cacheWrite: message.usage?.cacheWrite ?? 0,
              reasoning: message.usage?.reasoning ?? 0,
              total: message.usage?.totalTokens ?? 0,
            },
            stopReason: message.stopReason,
            timestamp: Date.now(),
          });
        },
      }),
      hook(ToolTask, {
        beforeTool(call) {
          onEvent({
            type: "tool_start",
            callId: call.id,
            name: call.name,
            arguments: (call.arguments ?? {}) as Record<string, unknown>,
            timestamp: Date.now(),
          });
          return undefined;
        },
        afterTool(call, result) {
          const textBlocks = Array.isArray(result.output)
            ? result.output
                .filter(
                  (b): b is Extract<(typeof result.output)[number], { type: "text" }> =>
                    b.type === "text",
                )
                .map((b) => b.text)
                .join("\n")
            : "";
          onEvent({
            type: "tool_end",
            callId: call.id,
            name: call.name,
            isError: Boolean(result.isError),
            outputPreview: textBlocks.slice(0, 2000),
            timestamp: Date.now(),
          });
          return undefined;
        },
      }),
    ],
  });
}
