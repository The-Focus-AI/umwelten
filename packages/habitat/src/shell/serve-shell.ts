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
  /**
   * A provider component supplies services and renders nothing (the
   * conversation and tools providers). Solo pages mount every provider
   * plus the one requested panel, so the panel's declarations resolve.
   */
  provides?: boolean;
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
  { id: "conversation", url: "./components/conversation.js", provides: true },
  { id: "tools", url: "./components/tools.js", provides: true },
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

/**
 * The full component roster a host currently serves: the built-in (or
 * host-supplied) entries plus the scanned custom components. One source of
 * truth for the manifest and for MCP resource publication (#406,
 * ADR 0032 — components project onto the wire as UI resources).
 */
export async function listShellComponents(
  options?: ShellServeOptions,
): Promise<ShellManifestEntry[]> {
  const entries = [...(options?.entries ?? DEFAULT_ENTRIES)];
  if (options?.customComponentsDir) {
    entries.push(...(await scanCustomComponents(options.customComponentsDir)));
  }
  return entries;
}

/** Solo-page ids: builtin ids plus custom:<name>. Anything else is a 404. */
const SAFE_SOLO_ID = /^[a-zA-Z0-9:_-]+$/;

/**
 * Register every panel as a ui://shell/<id> MCP resource whose read returns
 * the mcp-ui external-URL projection: the component's solo page under
 * `publicBase`. Providers and disabled entries are skipped — they render
 * nothing. The registrar is typed structurally so tests can hand it a stock
 * McpServer without importing container internals.
 */
export function registerShellResources(
  mcpServer: {
    registerResource(
      name: string,
      uri: string,
      config: { title?: string; description?: string; mimeType?: string },
      read: () => Promise<{
        contents: { uri: string; mimeType: string; text: string }[];
      }>,
    ): unknown;
  },
  components: ShellManifestEntry[],
  publicBase: string,
  serverName: string,
): void {
  for (const component of components) {
    if (component.provides || component.disabled) continue;
    const soloUrl = `${publicBase}/shell/solo/${encodeURIComponent(component.id)}/`;
    const uri = `ui://shell/${component.id}`;
    mcpServer.registerResource(
      `shell-${component.id}`,
      uri,
      {
        title: component.id,
        description: `Shell component "${component.id}" of ${serverName} — read returns its mountable page URL`,
        mimeType: "text/uri-list",
      },
      async () => ({
        contents: [{ uri, mimeType: "text/uri-list", text: soloUrl }],
      }),
    );
  }
}

/**
 * A solo page hosts exactly one component — the mountable projection behind
 * a `ui://shell/<id>` resource (ADR 0032): a peer's foreign-mount host
 * iframes this URL (#407). Providers (entries marked `provides`) mount too,
 * so the target's declarations resolve; everything else stays out.
 */
function soloPage(id: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${id}</title>
<style>
  :root {
    --bg: #101410; --panel: #181e18; --line: #2a332a;
    --ink: #d8e0d8; --muted: #8a968a; --accent: #7fb069; --error: #c8664a;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  main#region { display: grid; gap: 1rem; padding: 1rem; align-items: start; }
  #solo-status { padding: 0.4rem 1rem; color: var(--muted); font-size: 0.8rem; }
  .shell-card { background: var(--panel); border: 1px solid var(--line);
    border-radius: 6px; padding: 1rem 1.2rem; }
  .shell-card h2 { margin: 0 0 0.6rem; font-size: 0.8rem; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); }
  .shell-card dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 0.2rem 0.8rem; }
  .shell-card dt { color: var(--muted); }
  .shell-card dd { margin: 0; }
</style>
</head>
<body>
  <main id="region"></main>
  <div id="solo-status">assembling…</div>
  <script type="module">
    import { createContext, serviceKey, Loader } from "../../substrate/index.js";
    const base = new URL("../../", import.meta.url);
    const target = ${JSON.stringify(id)};
    const root = createContext();
    root.provide(serviceKey("shell:region"), document.getElementById("region"));
    root.provide(serviceKey("shell:base"), base);
    const loader = new Loader(root, {
      importModule: (url, g) =>
        import(new URL(url + (url.includes("?") ? "&" : "?") + "v=" + g, base).href),
    });
    const versions = new Map();
    const status = document.getElementById("solo-status");
    async function sync() {
      try {
        const res = await fetch(new URL("manifest.json", base));
        if (!res.ok) throw new Error("manifest: HTTP " + res.status);
        const manifest = await res.json();
        const entries = (manifest.entries ?? []).filter(
          (e) => e.provides || e.id === target,
        );
        await loader.apply(entries);
        for (const e of entries) {
          const prev = versions.get(e.id);
          versions.set(e.id, e.version);
          if (prev !== undefined && e.version !== undefined && e.version !== prev) {
            await loader.reload(e.id);
          }
        }
        const t = loader.entries().find((e) => e.id === target);
        status.textContent = !t
          ? "no component " + target + " on this host"
          : t.error
            ? String(t.error)
            : t.fiber?.active
              ? ""
              : "waiting for services…";
        beacon(t);
      } catch (err) {
        status.textContent = err.message;
        beacon(undefined, err.message);
      }
    }
    // Status beacon for a foreign-mount host (#407): when this page runs in
    // an iframe, tell the parent how the mount is going and how tall the
    // content is. Carries no data beyond mount state; targetOrigin "*" is
    // fine for that, and the parent filters by iframe source.
    function beacon(entry, failure) {
      if (window.parent === window) return;
      window.parent.postMessage(
        {
          type: "shell:solo",
          target,
          active: entry?.fiber?.active === true,
          error: failure ?? (entry?.error ? String(entry.error) : undefined),
          height: document.documentElement.scrollHeight,
        },
        "*",
      );
    }
    async function loop() { await sync(); setTimeout(loop, 2000); }
    loop();
    window.__shell = { root, loader };
  </script>
</body>
</html>
`;
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
      return {
        status: 200,
        contentType: JSON_TYPE,
        body: JSON.stringify(
          { entries: await listShellComponents(options) },
          null,
          2,
        ),
      };
    }
    if (rel.startsWith("solo/")) {
      const parts = rel.split("/");
      const id = decodeURIComponent(parts[1] ?? "");
      if (!SAFE_SOLO_ID.test(id)) return notFound;
      // Canonicalize to a trailing slash so the page's ../../ resolves.
      if (parts.length === 2) {
        return {
          status: 302,
          contentType: "text/plain; charset=utf-8",
          body: "",
          location: `${prefix}/solo/${parts[1]}/`,
        };
      }
      if (parts.length === 3 && (parts[2] === "" || parts[2] === "index.html")) {
        return { status: 200, contentType: HTML, body: soloPage(id) };
      }
      return notFound;
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
