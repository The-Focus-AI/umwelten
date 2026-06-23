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
