/**
 * The Exchange's Client surface (ADR 0026), as an assembly — #409.
 *
 * Mycel mounts the same host-agnostic Shell every habitat serves
 * (`@umwelten/substrate/serve`, the serving contract), contributing only its
 * own manifest: components that are strictly READ-ONLY over endpoints that
 * already exist — health and the models catalogue. Nothing here moves money
 * or changes configuration; the no-HTTP-admin decision (`command.ts` — the
 * operator CLI is the only admin surface) stands untouched.
 *
 * Dependency posture: `@umwelten/substrate` is dependency-free, and only
 * THIS module imports it — the exchange code paths that dispatch and meter
 * (`dispatch.ts`, `buyer/`, `metering/`) do not, and must not.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { transform } from "esbuild";
import {
  createShellHandler,
  type ShellManifestEntry,
} from "@umwelten/substrate/serve";

const ENTRIES: ShellManifestEntry[] = [
  { id: "health", url: "./components/health.js" },
  { id: "models", url: "./components/models.js" },
  { id: "catalogue-stats", url: "./components/catalogue-stats.js" },
];

export interface ClientSurfaceOptions {
  /**
   * Directory of agent-authored components — the self-assembly loop (#410).
   * The mycel-owning agent's `create_component` writes plain-ESM modules
   * here; the contract scans them per manifest request with mtime versions,
   * so creations, edits, and removals land live on a running dev Exchange.
   * The evolved components are read-only by construction: this manifest
   * declares no provider entries, so no `shell:tools` (or any mutating
   * service) exists for them to inject — all they can do is fetch the
   * Exchange's public read endpoints.
   */
  componentsDir?: string;
}

export function createClientSurfaceHandler(
  options: ClientSurfaceOptions = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return createShellHandler({
    entries: ENTRIES,
    componentsDir: join(dirname(fileURLToPath(import.meta.url)), "components"),
    customComponentsDir: options.componentsDir,
    transpile: async (source) =>
      (await transform(source, { loader: "ts", format: "esm", target: "es2022" }))
        .code,
  });
}
