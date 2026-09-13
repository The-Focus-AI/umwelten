/**
 * The Exchange's Client surface (ADR 0026), as an assembly — #409.
 *
 * Mycel mounts the same host-agnostic Shell every habitat serves
 * (`@umwelten/substrate/serve`, the serving contract), contributing only its
 * own read-only operational manifest for health and the models catalogue.
 * The separate, trusted account manifest authenticates customers and admins;
 * only it can request account and catalogue mutations. Evolved components
 * never enter that assembly.
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

const ACCOUNT_ENTRIES: ShellManifestEntry[] = [
  {
    id: "account-authentication",
    url: "/assets/account-authentication.js",
    provides: true,
  },
  {
    id: "account-layout",
    url: "./components/account-layout.js",
    provides: true,
  },
  {
    id: "account-customer",
    url: "./components/account-customer.js",
    provides: true,
  },
  { id: "account-overview", url: "./components/account-overview.js" },
  { id: "account-catalogue", url: "./components/account-catalogue.js" },
  {
    id: "account-applications",
    url: "./components/account-applications.js",
  },
  { id: "account-playground", url: "./components/account-playground.js" },
  { id: "account-funding", url: "./components/account-funding.js" },
  {
    id: "account-admin-grant",
    url: "./components/account-admin-grant.js",
  },
  {
    id: "account-supplier-connections",
    url: "./components/account-supplier-connections.js",
  },
  { id: "account-ledger", url: "./components/account-ledger.js" },
  { id: "account-usage", url: "./components/account-usage.js" },
  { id: "account-team", url: "./components/account-team.js" },
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
      (
        await transform(source, {
          loader: "ts",
          format: "esm",
          target: "es2022",
        })
      ).code,
  });
}

/**
 * The trusted customer assembly. Unlike the agent-authored `/shell/` roster,
 * this fixed manifest deliberately includes authentication and mutation
 * providers; no custom component directory is mounted into this trust realm.
 */
export function createAccountSurfaceHandler(options?: {
  authenticationUrl?: string;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const entries = ACCOUNT_ENTRIES.map((entry) =>
    entry.id === "account-authentication" && options?.authenticationUrl
      ? { ...entry, url: options.authenticationUrl }
      : entry,
  );
  return createShellHandler({
    prefix: "/account",
    entries,
    componentsDir: join(dirname(fileURLToPath(import.meta.url)), "components"),
    transpile: async (source) =>
      (
        await transform(source, {
          loader: "ts",
          format: "esm",
          target: "es2022",
        })
      ).code,
  });
}
