/**
 * Serve the Shell from a habitat container — ADR 0031, #400.
 *
 * The serving contract itself is host-agnostic and lives with the assets it
 * serves, in `@umwelten/substrate/serve` (the Mycel Exchange mounts the same
 * module, #409). What this wrapper contributes is the habitat posture: the
 * built-in component roster, the habitat components directory, and esbuild
 * as the injected transpiler. The public API here is unchanged — container
 * server, tools, and tests keep importing from this module.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import {
  createShellHandler as createContractHandler,
  listShellComponents as listContractComponents,
  resolveShellRequest as resolveContractRequest,
  type ShellManifestEntry,
  type ShellServeOptions,
  type ShellResponse,
} from "@umwelten/substrate/serve";

export {
  registerShellResources,
  type ShellManifestEntry,
  type ShellServeOptions,
  type ShellResponse,
} from "@umwelten/substrate/serve";

const DEFAULT_ENTRIES: ShellManifestEntry[] = [
  // The stock layout (ADR 0034). `provides` here means "mounts everywhere,
  // projects nowhere": solo pages stay single-component (the layout no-ops
  // without shell chrome) and no ui://shell/layout resource is published.
  { id: "layout", url: "./components/layout.js", provides: true },
  { id: "status", url: "./components/status.js" },
  { id: "conversation", url: "./components/conversation.js", provides: true },
  { id: "tools", url: "./components/tools.js", provides: true },
  { id: "chat", url: "./components/chat.js" },
  { id: "quick-prompts", url: "./components/quick-prompts.js" },
  { id: "secrets", url: "./components/secrets.js" },
  { id: "sessions", url: "./components/sessions.js" },
];

function defaultComponentsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "components");
}

async function transpileTs(source: string): Promise<string> {
  const out = await transform(source, {
    loader: "ts",
    format: "esm",
    target: "es2022",
  });
  return out.code;
}

/**
 * A custom layout replaces the stock one (ADR 0034): whenever the agent has
 * authored `layout.js`, the built-in entry goes disabled — and comes back
 * the moment the custom one is removed.
 */
function customLayoutWins(
  entries: ShellManifestEntry[],
): ShellManifestEntry[] {
  if (!entries.some((e) => e.id === "custom:layout")) return entries;
  return entries.map((e) =>
    e.id === "layout" ? { ...e, disabled: true } : e,
  );
}

/** The habitat defaults, layered under whatever the caller passed. */
function withHabitatDefaults(options?: ShellServeOptions): ShellServeOptions {
  return {
    entries: DEFAULT_ENTRIES,
    componentsDir: defaultComponentsDir(),
    transpile: transpileTs,
    transformEntries: customLayoutWins,
    ...options,
  };
}

/**
 * The full component roster this habitat currently serves — the habitat
 * defaults plus host-contributed and custom entries. One source of truth
 * for the manifest and for MCP resource publication (#406, ADR 0032).
 */
export async function listShellComponents(
  options?: ShellServeOptions,
): Promise<ShellManifestEntry[]> {
  return listContractComponents(withHabitatDefaults(options));
}

/**
 * Map a request path (no query) onto the serving contract, with the habitat
 * defaults applied. Returns undefined for paths outside the shell prefix.
 */
export async function resolveShellRequest(
  path: string,
  options?: ShellServeOptions,
): Promise<ShellResponse | undefined> {
  return resolveContractRequest(path, withHabitatDefaults(options));
}

/**
 * (req, res) glue over resolveShellRequest. Returns true when the request
 * was inside the shell prefix and has been answered.
 */
export function createShellHandler(
  options?: ShellServeOptions,
): ReturnType<typeof createContractHandler> {
  return createContractHandler(withHabitatDefaults(options));
}
