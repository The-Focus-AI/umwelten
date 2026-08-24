/**
 * Serve the Shell (substrate serving contract) from a habitat container —
 * ADR 0031, #400.
 *
 * The shell page and boot script are static assets shipped by
 * @umwelten/substrate (`shell/`), so every host serves the identical shell;
 * what a host contributes is its manifest and its components. The substrate
 * runtime itself is TypeScript, transpiled to browser ESM per-file on the
 * way out (esbuild.transform, mtime-cached) — module structure and relative
 * imports survive, so no bundling and no build step sit anywhere in the
 * loading path. Component modules are served raw: they are plain ESM by
 * contract.
 *
 * Everything here is host-posture-agnostic: `resolveShellRequest` is a pure
 * async map from a URL path to a response, and `createShellHandler` is the
 * thin (req, res) glue — mountable on the container server or on a bare
 * node http server (which is how the smoke test proves the shell binds to
 * the contract, not to habitat internals).
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { transform } from "esbuild";

export interface ShellManifestEntry {
  id: string;
  url: string;
  config?: unknown;
  disabled?: boolean;
  /**
   * Change stamp: when a host changes an entry's version, the shell
   * hot-reloads that entry (the self-assembly loop's signal). Custom
   * components use the file's mtime.
   */
  version?: number;
}

export interface ShellServeOptions {
  /** Manifest entries. Default: the built-in components. */
  entries?: ShellManifestEntry[];
  /** Root of the @umwelten/substrate package. Default: resolved from here. */
  substrateRoot?: string;
  /** Directory of this host's built-in component modules (plain ESM). */
  componentsDir?: string;
  /**
   * Directory of host-authored components (the habitat's
   * workDir/components — what create_component writes). Scanned per
   * manifest request: each *.js file becomes an entry `custom:<name>`
   * at `./custom/<name>.js`, versioned by mtime, so the shell picks up
   * creations, edits, and removals live.
   */
  customComponentsDir?: string;
  /** URL prefix the shell is mounted at. Default "/shell". */
  prefix?: string;
}

export interface ShellResponse {
  status: number;
  contentType: string;
  body: string | Buffer;
  /** Redirect target (status 30x). */
  location?: string;
}

const DEFAULT_ENTRIES: ShellManifestEntry[] = [
  { id: "status", url: "./components/status.js" },
  { id: "conversation", url: "./components/conversation.js" },
  { id: "tools", url: "./components/tools.js" },
  { id: "chat", url: "./components/chat.js" },
  { id: "quick-prompts", url: "./components/quick-prompts.js" },
  { id: "secrets", url: "./components/secrets.js" },
  { id: "sessions", url: "./components/sessions.js" },
];

/** A served file name: single flat segment, .js only. */
const SAFE_MODULE = /^[a-zA-Z0-9_-]+\.js$/;

function defaultSubstrateRoot(): string {
  // Resolves to <root>/src/index.ts via the package's exports map (the map
  // is ESM-only, so import.meta.resolve rather than require.resolve).
  const entry = fileURLToPath(import.meta.resolve("@umwelten/substrate"));
  return resolve(dirname(entry), "..");
}

function defaultComponentsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "components");
}

/** Scan the host-authored components dir into manifest entries. */
async function scanCustomComponents(
  dir: string,
): Promise<ShellManifestEntry[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => SAFE_MODULE.test(n));
  } catch {
    return []; // no components dir yet — nothing custom
  }
  const entries: ShellManifestEntry[] = [];
  for (const name of names.sort()) {
    try {
      const s = await stat(join(dir, name));
      entries.push({
        id: `custom:${name.replace(/\.js$/, "")}`,
        url: `./custom/${name}`,
        version: Math.floor(s.mtimeMs),
      });
    } catch {
      // raced with a delete — skip
    }
  }
  return entries;
}

/** Transpile cache: absolute path → { mtimeMs, code }. */
const transpiled = new Map<string, { mtimeMs: number; code: string }>();

async function transpileTs(absPath: string): Promise<string> {
  const s = await stat(absPath);
  const cached = transpiled.get(absPath);
  if (cached && cached.mtimeMs === s.mtimeMs) return cached.code;
  const source = await readFile(absPath, "utf8");
  const out = await transform(source, {
    loader: "ts",
    format: "esm",
    target: "es2022",
  });
  transpiled.set(absPath, { mtimeMs: s.mtimeMs, code: out.code });
  return out.code;
}

const JS = "application/javascript; charset=utf-8";
const HTML = "text/html; charset=utf-8";
const JSON_TYPE = "application/json; charset=utf-8";

/**
 * Map a request path (no query) onto the serving contract. Returns
 * undefined for paths outside the shell prefix; a 404 ShellResponse for
 * paths inside it that name nothing.
 */
export async function resolveShellRequest(
  path: string,
  options?: ShellServeOptions,
): Promise<ShellResponse | undefined> {
  const prefix = options?.prefix ?? "/shell";
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return undefined;
  // Canonicalize the bare prefix to a trailing slash, so the page's
  // relative URLs (./shell.js, ./manifest.json) resolve under the prefix
  // rather than beside it.
  if (path === prefix) {
    return {
      status: 302,
      contentType: "text/plain; charset=utf-8",
      body: "",
      location: `${prefix}/`,
    };
  }
  const rel = path.slice(prefix.length + 1);

  const substrateRoot = options?.substrateRoot ?? defaultSubstrateRoot();
  const shellDir = join(substrateRoot, "shell");

  const notFound: ShellResponse = {
    status: 404,
    contentType: JSON_TYPE,
    body: JSON.stringify({ error: "Not found", path }),
  };

  try {
    if (rel === "" || rel === "index.html") {
      return {
        status: 200,
        contentType: HTML,
        body: await readFile(join(shellDir, "index.html")),
      };
    }
    if (rel === "shell.js") {
      return {
        status: 200,
        contentType: JS,
        body: await readFile(join(shellDir, "shell.js")),
      };
    }
    if (rel === "manifest.json") {
      const entries = [...(options?.entries ?? DEFAULT_ENTRIES)];
      if (options?.customComponentsDir) {
        entries.push(...(await scanCustomComponents(options.customComponentsDir)));
      }
      return {
        status: 200,
        contentType: JSON_TYPE,
        body: JSON.stringify({ entries }, null, 2),
      };
    }
    if (rel.startsWith("substrate/")) {
      const name = rel.slice("substrate/".length);
      if (!SAFE_MODULE.test(name)) return notFound;
      const tsPath = join(
        substrateRoot,
        "src",
        name.replace(/\.js$/, ".ts"),
      );
      return { status: 200, contentType: JS, body: await transpileTs(tsPath) };
    }
    if (rel.startsWith("components/")) {
      const name = rel.slice("components/".length);
      if (!SAFE_MODULE.test(name)) return notFound;
      const dir = options?.componentsDir ?? defaultComponentsDir();
      return {
        status: 200,
        contentType: JS,
        body: await readFile(join(dir, name)),
      };
    }
    if (rel.startsWith("custom/")) {
      const name = rel.slice("custom/".length);
      if (!SAFE_MODULE.test(name) || !options?.customComponentsDir)
        return notFound;
      return {
        status: 200,
        contentType: JS,
        body: await readFile(join(options.customComponentsDir, name)),
      };
    }
  } catch {
    return notFound;
  }
  return notFound;
}

/**
 * (req, res) glue over resolveShellRequest. Returns true when the request
 * was inside the shell prefix and has been answered.
 */
export function createShellHandler(
  options?: ShellServeOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const answer = await resolveShellRequest(path, options);
    if (!answer) return false;
    res.writeHead(answer.status, {
      "Content-Type": answer.contentType,
      "Cache-Control": "no-cache",
      ...(answer.location ? { Location: answer.location } : {}),
    });
    res.end(answer.body);
    return true;
  };
}
