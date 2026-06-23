/**
 * UI resources (mcp-ui) over the habitat surface — ADR 0005 slice B (#195).
 *
 * A tool/agent emits a single canonical **UI resource** (an mcp-ui
 * `createUIResource`). The runtime — not the tool author — decides how it
 * travels. This module owns:
 *
 *   1. the canonical emit shape (`buildHabitatUIResource`) — wraps
 *      `@mcp-ui/server`, validates the `ui://` id, absolutizes an externalUrl,
 *      and rejects remoteDom (deferred in v1);
 *   2. the transport-agnostic **normalizer** (`uiResourceToA2APart`) — the
 *      single point that maps a UI resource onto a protocol representation
 *      (the A2A direction here; the MCP direction lands in slice C, #196);
 *   3. a per-turn filesystem buffer (`publishUIResource` / `drainUIResources`)
 *      mirroring the artifact side-channel, so a tool can emit a resource that
 *      the A2A executor collects at the end of the turn.
 *
 * Carrier choice: a UI resource rides A2A as a **DataPart** tagged
 * `outputMode: "text/html+mcp"` — the resource object drops into `data`
 * verbatim, and a downstream mcp-ui `AppRenderer` reconstructs the
 * EmbeddedResource as `{ type: "resource", resource: part.data }`.
 */

import { createUIResource } from "@mcp-ui/server";
import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DataPart } from "@a2a-js/sdk";
import { toAbsoluteArtifactUrl } from "./tools/artifact-tools.js";

/** A2A output mode advertised on the agent card when UI resources are emitted. */
export const UI_OUTPUT_MODE = "text/html+mcp";

/** mcp-ui remote-dom mime prefix — detected and rejected in v1 (ADR 0005). */
const REMOTE_DOM_MIME_PREFIX = "application/vnd.mcp-ui.remote-dom";

const UI_DIR = "ui-resources";

/**
 * The mcp-ui EmbeddedResource payload (the `resource` of `createUIResource`).
 * `text` (rawHtml / the external URL) or base64 `blob`, plus the `ui://` uri
 * and mimeType. Carried verbatim across transports.
 */
export interface HabitatUIResource {
  uri: string;
  mimeType: string;
  text?: string;
  blob?: string;
  [k: string]: unknown;
}

export interface BuildUIResourceInput {
  /** Resource identity — MUST start with `ui://`. */
  uri: string;
  /** rawHtml modality: inline HTML rendered in a sandboxed iframe. */
  html?: string;
  /** externalUrl modality: a URL the agent hosts, absolutized via `origin`. */
  externalUrl?: string;
  /** Public origin used to absolutize a relative externalUrl (#194). */
  origin?: string;
}

/**
 * Build a canonical UI resource. Exactly one of `html` / `externalUrl` must be
 * set (rawHtml or externalUrl). remoteDom is rejected. Throws on a bad `ui://`
 * id or wrong arity so a tool surfaces a clear error rather than emitting junk.
 */
export function buildHabitatUIResource(
  input: BuildUIResourceInput,
): HabitatUIResource {
  const { uri } = input;
  if (typeof uri !== "string" || !uri.startsWith("ui://")) {
    throw new Error(
      `UI resource uri must start with "ui://" (got ${JSON.stringify(uri)})`,
    );
  }
  // Validated above — narrow to the template-literal type createUIResource wants.
  const uiUri = uri as `ui://${string}`;
  const hasHtml = typeof input.html === "string";
  const hasUrl = typeof input.externalUrl === "string";
  if (hasHtml === hasUrl) {
    throw new Error(
      "Provide exactly one of { html, externalUrl } — rawHtml or externalUrl. " +
        "remoteDom is not supported in v1 (ADR 0005).",
    );
  }

  const built = hasHtml
    ? createUIResource({
        uri: uiUri,
        content: { type: "rawHtml", htmlString: input.html as string },
        encoding: "text",
      })
    : createUIResource({
        uri: uiUri,
        content: {
          type: "externalUrl",
          // Absolutize so the iframe URL resolves off-origin (#194).
          iframeUrl: toAbsoluteArtifactUrl(
            input.externalUrl as string,
            input.origin,
          ),
        },
        encoding: "text",
      });

  const resource = built.resource as HabitatUIResource;
  if (
    typeof resource.mimeType === "string" &&
    resource.mimeType.startsWith(REMOTE_DOM_MIME_PREFIX)
  ) {
    throw new Error("remoteDom UI resources are not supported in v1 (ADR 0005).");
  }
  return resource;
}

/**
 * Normalizer: map a UI resource onto its A2A representation (a DataPart).
 * The single, transport-specific egress point — keep A2A and (future) MCP
 * derivations here so they never drift.
 */
export function uiResourceToA2APart(resource: HabitatUIResource): DataPart {
  return {
    kind: "data",
    data: resource as Record<string, unknown>,
    metadata: {
      mcpUi: true,
      outputMode: UI_OUTPUT_MODE,
      mimeType: resource.mimeType,
    },
  };
}

/** An MCP `EmbeddedResource` content block — the tool-result content type. */
export interface McpEmbeddedResource {
  type: "resource";
  resource: HabitatUIResource;
}

/**
 * Normalizer (MCP direction): map a UI resource onto an MCP `EmbeddedResource`
 * content block (ADR 0005 slice C, #196). Same source resource as the A2A
 * DataPart so the two transports can never drift.
 */
export function uiResourceToMcpContent(
  resource: HabitatUIResource,
): McpEmbeddedResource {
  return { type: "resource", resource };
}

// ── Tool-result carrier ────────────────────────────────────────────────
//
// A tool signals "my result contains UI resources" by attaching them under a
// reserved key. The MCP bridge extracts them into EmbeddedResource content
// blocks instead of flattening the whole result to text. Generic — any tool
// (including slice D's interactive tools) can opt in.

/** Reserved key carrying UI resources on a tool result. */
export const UI_RESOURCE_RESULT_KEY = "_uiResources";

/** Attach UI resources to a tool result object for the MCP bridge to extract. */
export function withUIResources<T extends Record<string, unknown>>(
  result: T,
  resources: HabitatUIResource[],
): T & { [UI_RESOURCE_RESULT_KEY]: HabitatUIResource[] } {
  return { ...result, [UI_RESOURCE_RESULT_KEY]: resources };
}

/** Read UI resources carried on a tool result (empty if none / wrong shape). */
export function extractUIResources(result: unknown): HabitatUIResource[] {
  if (!result || typeof result !== "object") return [];
  const carried = (result as Record<string, unknown>)[UI_RESOURCE_RESULT_KEY];
  if (!Array.isArray(carried)) return [];
  return carried.filter(
    (r): r is HabitatUIResource =>
      !!r &&
      typeof r === "object" &&
      typeof (r as HabitatUIResource).uri === "string",
  );
}

/** Return a copy of the tool result with the UI-resource carrier removed. */
export function stripUIResources(result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }
  if (!(UI_RESOURCE_RESULT_KEY in (result as Record<string, unknown>))) {
    return result;
  }
  const { [UI_RESOURCE_RESULT_KEY]: _omit, ...rest } = result as Record<
    string,
    unknown
  >;
  return rest;
}

// ── Per-turn filesystem buffer (mirrors the artifact side-channel) ──────

/** Append a UI resource to the per-turn buffer under {workDir}/ui-resources. */
export async function publishUIResource(
  workDir: string,
  resource: HabitatUIResource,
): Promise<void> {
  const dir = join(workDir, UI_DIR);
  await mkdir(dir, { recursive: true });
  // Sortable, collision-free name: ISO-ish stamp + uuid.
  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.json`;
  await writeFile(join(dir, name), JSON.stringify(resource), "utf-8");
}

/**
 * Read and **remove** all buffered UI resources for this turn (oldest first).
 * UI resources are ephemeral per turn — unlike artifacts, they are not
 * re-emitted on later turns — so draining clears them.
 */
export async function drainUIResources(
  workDir: string,
): Promise<HabitatUIResource[]> {
  const dir = join(workDir, UI_DIR);
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out: HabitatUIResource[] = [];
  for (const f of files) {
    const full = join(dir, f);
    try {
      out.push(JSON.parse(await readFile(full, "utf-8")));
    } catch {
      // skip malformed
    }
    await rm(full, { force: true });
  }
  return out;
}
