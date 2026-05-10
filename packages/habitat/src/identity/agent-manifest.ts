/**
 * agent-manifest.json — declarative surface for `kind: "mcp-agent"` agents.
 *
 * Lives at the root of the agent's repo (`/data/agents/<id>/repo/agent-manifest.json`).
 * Tells the host habitat how to mount the agent's:
 *   - public UI directory (static files served on /agents/<id>/...)
 *   - MCP / OAuth surface (an `@umwelten/server/mcp-serve` configuration)
 *   - extra public routes (e.g. ["/oauth/*", "/.well-known/*"])
 *
 * The actual mcp-serve wiring is the runtime's job; this module is just the
 * parser + validator + a strongly-typed view of the on-disk file.
 *
 * Schema is permissive: unknown keys are preserved. Required fields are name
 * and (when publicMcp is true) publicAuth.upstreamProvider + registerTools.
 */

import { readFile } from "node:fs/promises";
import { join, isAbsolute, resolve } from "node:path";
import { z } from "zod";

const ManifestAuthSchema = z.object({
  kind: z.literal("oauth-server"),
  /**
   * Path (relative to the agent repo root) of a JS module exporting an
   * UpstreamOAuthProvider as `default` or `provider`.
   */
  upstreamProvider: z.string(),
  /**
   * Path (relative to the agent repo root) of a JS module exporting an
   * McpToolRegistrar as `default` or `registerTools`.
   */
  registerTools: z.string(),
  /** Backing store for OAuth state. Two implementations are supported today. */
  store: z
    .union([
      z.object({ driver: z.literal("sqlite"), path: z.string() }),
      z.object({ driver: z.literal("neon"), envRef: z.string() }),
    ])
    .optional(),
});

const ManifestSchema = z
  .object({
    /** Display name. */
    name: z.string(),
    /** Free-form short description. */
    description: z.string().optional(),
    /** Repo-relative directory whose contents are served as the public UI. */
    publicUiDir: z.string().optional(),
    /** Whether to expose an MCP endpoint at /agents/<id>/mcp. */
    publicMcp: z.boolean().default(false),
    /** OAuth Authorization Server config (required when publicMcp is true). */
    publicAuth: ManifestAuthSchema.optional(),
    /**
     * Extra public routes the agent owns. Globs are accepted as marker
     * strings; the host treats them as a hint rather than a true matcher.
     */
    publicRoutes: z.array(z.string()).default([]),
    /** Optional explicit version pin, mirrored into the served metadata. */
    version: z.string().optional(),
  })
  .passthrough();

export type AgentManifest = z.infer<typeof ManifestSchema>;

export interface AgentManifestLoadResult {
  manifest: AgentManifest;
  /** Absolute path on disk where the manifest was loaded from. */
  path: string;
}

export class AgentManifestError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AgentManifestError";
  }
}

/** Parse a manifest object (already-decoded JSON) and validate it. */
export function parseAgentManifest(raw: unknown): AgentManifest {
  const result = ManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new AgentManifestError(
      `agent-manifest.json failed validation: ${result.error.issues
        .map(i => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`,
    );
  }
  const m = result.data;
  if (m.publicMcp && !m.publicAuth) {
    throw new AgentManifestError(
      "publicMcp is true but publicAuth is missing — provide an oauth-server config.",
    );
  }
  return m;
}

/** Read and parse agent-manifest.json from a directory (the agent's repo root). */
export async function loadAgentManifest(
  repoDir: string,
  fileName = "agent-manifest.json",
): Promise<AgentManifestLoadResult | null> {
  const path = isAbsolute(fileName) ? fileName : join(repoDir, fileName);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw new AgentManifestError(`Failed to read ${path}: ${err.message}`, err);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw new AgentManifestError(`Invalid JSON in ${path}: ${err.message}`, err);
  }

  const manifest = parseAgentManifest(parsed);
  return { manifest, path };
}

/**
 * Resolve a manifest-relative path to an absolute one.
 * Used by the host when mounting the public UI dir or loading the
 * upstreamProvider / registerTools modules.
 */
export function resolveManifestPath(repoDir: string, relPath: string): string {
  return isAbsolute(relPath) ? relPath : resolve(repoDir, relPath);
}
