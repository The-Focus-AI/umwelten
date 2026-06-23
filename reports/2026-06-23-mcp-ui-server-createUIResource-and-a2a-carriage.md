# mcp-ui `createUIResource` + A2A carriage — research (issue #195, ADR 0005 slice B)

**Date:** 2026-06-23
**Scope:** Let a habitat tool emit a single mcp-ui **UI resource** (`@mcp-ui/server` `createUIResource`) and carry it to the user over the existing **A2A** surface as a renderable, display-only message part. Modalities in scope: **rawHtml** and **externalUrl**; **remoteDom deferred (detect-and-reject)**.

---

## Executive summary (6 bullets)

- **Pin `@mcp-ui/server@^6.1.0`** (latest 6.x). It is ESM-only, ships its own `.d.ts`, and is light — only two runtime deps (`@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`), both already in the tree transitively. No DOM/React/browser deps; safe server-side.
- **`createUIResource({ uri, content, encoding })` returns an MCP `EmbeddedResource`** — `{ type: 'resource', resource: { uri, mimeType, text | blob } }`. `uri` **must** start with `ui://` (throws otherwise). `encoding: 'text'` → `resource.text`; `encoding: 'blob'` → `resource.blob` (base64).
- **⚠ Version gotcha — mimeTypes changed between 5.x and 6.x.** The classic ecosystem semantics the issue/Focus-standard describe (rawHtml→`text/html`, externalUrl→`text/uri-list`, remoteDom→`application/vnd.mcp-ui.remote-dom+javascript; framework=…`) are **5.16.x** behavior. In the pinned **6.1.0**, `createUIResource` emits `text/html;profile=mcp-app` for **both** rawHtml and externalUrl, and the **`remoteDom` content type was removed from the core union** (only `rawHtml | externalUrl` remain). This is a decision point — see §1.4.
- **Carry it over A2A as a `DataPart`, not a `FilePart`.** `DataPart.data` holds the whole `EmbeddedResource.resource` object verbatim, so a downstream mcp-ui `AppRenderer` can reconstruct the `EmbeddedResource` by wrapping it back as `{ type: 'resource', resource: <data> }`. FilePart can't carry a `ui://` resource with inline html/text without abusing `bytes`/`uri`.
- **Tag the DataPart with metadata** so consumers can detect-and-route it without sniffing: `metadata: { mcpUi: true, outputMode: 'text/html+mcp', mimeType: <resource.mimeType> }`. Advertise the same on the agent card as an output mode `text/html+mcp` (per the Focus standard).
- **externalUrl must be absolute-public.** Reuse `toAbsoluteArtifactUrl(iframeUrl, origin)` from `packages/habitat/src/tools/artifact-tools.ts` (added in #194) to absolutize a relative `iframeUrl` against the per-request resolved public origin before calling `createUIResource`.

---

## 1. `@mcp-ui/server` `createUIResource` API

### 1.1 Signature (6.1.0)

```ts
type URI = `ui://${string}`;

type ResourceContentPayload =
  | { type: 'rawHtml';     htmlString: string }
  | { type: 'externalUrl'; iframeUrl: string };   // remoteDom NOT in this union in 6.x

interface CreateUIResourceOptions {
  uri: URI;                       // MUST start with "ui://"
  content: ResourceContentPayload;
  encoding: 'text' | 'blob';
  uiMetadata?: UIResourceMetadata;          // preferred-frame-size, initial-render-data
  metadata?: Record<string, unknown>;       // → resource._meta
  resourceProps?: UIResourceProps;
  embeddedResourceProps?: EmbeddedUIResourceProps;
  adapters?: AdaptersConfig;                // appsSdk | mcpApps (leave unset for us)
}

function createUIResource(options: CreateUIResourceOptions): UIResource;

type UIResource = {
  type: 'resource';
  resource: HTMLTextContent | Base64BlobContent;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};
```

`HTMLTextContent = { uri, mimeType, text, blob?: never, _meta? }`,
`Base64BlobContent = { uri, mimeType, blob, text?: never, _meta? }`.

### 1.2 Exact return shape — **rawHtml** (6.1.0, `encoding: 'text'`)

Verified against `package/dist/index.mjs` (`Ht = "text/html;profile=mcp-app"`):

```json
{
  "type": "resource",
  "resource": {
    "uri": "ui://habitat/my-widget",
    "mimeType": "text/html;profile=mcp-app",
    "text": "<h1>Hello</h1>"
  }
}
```

With `encoding: 'blob'`, `"text"` is replaced by `"blob": "<base64 of the htmlString>"` (UTF-8 → base64).

### 1.3 Exact return shape — **externalUrl** (6.1.0, `encoding: 'text'`)

```json
{
  "type": "resource",
  "resource": {
    "uri": "ui://habitat/dashboard",
    "mimeType": "text/html;profile=mcp-app",
    "text": "https://agent.example.com/files/artifacts/2026-...-dashboard.html"
  }
}
```

The `iframeUrl` is stored verbatim as `resource.text` (one URL string; `blob` if `encoding: 'blob'`).

> Note: in 6.x both modalities share `mimeType: "text/html;profile=mcp-app"`. The **discriminator between rawHtml and externalUrl is NOT the mimeType** — it's whether `resource.text` is HTML markup vs. a single URL. If you need a hard discriminator on the wire, set it yourself in the carrier metadata (see §2).

### 1.4 Version divergence (important — pick one)

The same call against **`@mcp-ui/server@5.16.3`** produces *different* mimeTypes (verified in `dist/index.mjs`):

| content.type | 5.16.3 mimeType | 6.1.0 mimeType |
|---|---|---|
| `rawHtml` | `text/html` | `text/html;profile=mcp-app` |
| `externalUrl` | `text/uri-list` | `text/html;profile=mcp-app` |
| `remoteDom` | `application/vnd.mcp-ui.remote-dom+javascript; framework=react` | **removed from `createUIResource` content union** |

Implications:

- The issue text and Focus standard describe the **5.x** mimeType contract (`text/html`, `text/uri-list`, `application/vnd.mcp-ui.remote-dom`). The Focus standard *pins 6.x*, so we will actually emit `text/html;profile=mcp-app`.
- **Recommendation:** pin **6.1.0** (it is what the standard says), and do **not** hard-code the mimeType — read it from `resource.mimeType` and pass it through. Most current `@mcp-ui/client` `AppRenderer` builds accept the `;profile=mcp-app` profile; the renderer keys off `type: 'resource'` + `ui://` + the resource shape, not a brittle mimeType equality. If the downstream AppRenderer turns out to require the legacy `text/html` / `text/uri-list` values, that is a one-line normalizer mapping at egress — flag it to the client-repo owner rather than downgrading the server pin.
- **remoteDom detect-and-reject:** since 6.x no longer accepts `type: 'remoteDom'` in `createUIResource`, our normalizer should reject any inbound resource whose `mimeType` starts with `application/vnd.mcp-ui.remote-dom` (the 5.x/spec mimeType) **before** it reaches the A2A carrier, with a clear "remoteDom not yet supported (ADR 0005 slice B)" error. Detect on the mimeType prefix, not on a `type` field.

### 1.5 Constraints confirmed (6.1.0 source)

- `uri` must start with `ui://` for both rawHtml and externalUrl — else `createUIResource` throws `MCP-UI SDK: URI must start with 'ui://' …`.
- `content.htmlString` must be a `string` (throws otherwise).
- `content.iframeUrl` must be a `string` (throws otherwise).
- `encoding` must be exactly `'text'` or `'blob'` (throws on anything else).
- Leave `adapters` unset. Adapters (`appsSdk`/`mcpApps`) inject host-specific `<script>` shims and *change the mimeType* (`text/html+skybridge`, etc.) — out of scope for display-only carriage.

---

## 2. How an mcp-ui resource is normally delivered, and the A2A carrier

### 2.1 Native delivery = MCP `EmbeddedResource`

`createUIResource` returns exactly an MCP tool-result **content block**: `{ type: 'resource', resource: {...} }`. In a pure MCP server you push it into the tool result's `content[]` array. The mcp-ui **client** (`@mcp-ui/client` `AppRenderer` / `UIResourceRenderer`, separate repo) scans those content blocks for `type === 'resource'` with a `ui://` uri and renders the resource in a sandboxed iframe.

A2A has **no MCP content blocks**. Its `Part` union is `TextPart | FilePart | DataPart` (`@a2a-js/sdk` `extensions-APfrw8gz.d.ts:27`). So we need a carrier Part that round-trips the `EmbeddedResource` faithfully.

### 2.2 The three A2A Part shapes (from `@a2a-js/sdk@0.3.13`)

```ts
interface TextPart { kind: "text"; text: string; metadata?: {...} }

interface FilePart {
  kind: "file";
  file: FileWithBytes | FileWithUri;   // {bytes, mimeType?, name?} | {uri, mimeType?, name?}
  metadata?: { [k: string]: unknown };
}

interface DataPart {
  kind: "data";
  data: { [k: string]: unknown };      // structured JSON object
  metadata?: { [k: string]: unknown };
}
```

### 2.3 Recommendation: **DataPart** (carry `resource` verbatim)

```ts
import { createUIResource } from "@mcp-ui/server";
import type { DataPart } from "@a2a-js/sdk";

const uiResource = createUIResource({
  uri: "ui://habitat/my-widget",
  content: { type: "rawHtml", htmlString: html },
  encoding: "text",
});

const part: DataPart = {
  kind: "data",
  data: uiResource.resource,              // { uri, mimeType, text | blob, _meta? }
  metadata: {
    mcpUi: true,                          // detect flag
    outputMode: "text/html+mcp",         // Focus-standard output mode tag
    mimeType: uiResource.resource.mimeType,
    modality: html ? "rawHtml" : "externalUrl", // optional hard discriminator
  },
};
```

**Why DataPart over FilePart:**

- `DataPart.data` is a free-form JSON **object** — a perfect fit for the `resource` object (`{ uri, mimeType, text|blob }`), preserving the `ui://` uri and inline content with zero lossy re-encoding. (A2A's JSON Schema constrains `data` to an *object*, so wrap the resource object directly — do not put a bare string/array there.)
- `FilePart` forces a false choice: `FileWithUri` (only a URL — loses inline rawHtml and the `ui://` identity) or `FileWithBytes` (base64 the html — works but obscures the resource as an opaque blob and drops the `ui://` uri, which is the renderer's primary key). Neither cleanly carries the `EmbeddedResource` semantics.
- DataPart keeps everything the mcp-ui spec considers load-bearing (`uri`, `mimeType`, `text`/`blob`) in one structured object.

**Reconstruction on the client (mcp-ui `AppRenderer`, separate repo):**

```ts
// On receiving an A2A DataPart with metadata.mcpUi === true:
const embeddedResource = { type: "resource" as const, resource: part.data };
// hand `embeddedResource` (or `embeddedResource.resource`) straight to
// <UIResourceRenderer resource={embeddedResource.resource} /> — it is byte-for-byte
// the same object createUIResource produced server-side.
```

The client detects via `part.kind === "data" && part.metadata?.mcpUi === true` (or `outputMode === "text/html+mcp"`), then re-wraps `part.data` as the MCP `EmbeddedResource` and feeds it to the renderer. No interactive callbacks are wired (display-only) — slice B does not handle `UIActionResult` postMessages back to a tool.

### 2.4 Metadata / output-mode convention

- **Per-part:** tag the DataPart with `metadata.mcpUi = true` and `metadata.outputMode = "text/html+mcp"`. This is what downstream consumers (SaaS chat, Gaia proxy, AppRenderer) key on to decide "render as mcp-ui app" vs. "show as JSON".
- **Agent card:** advertise `text/html+mcp` as an output mode so clients can discover the capability up front. In `buildAgentCard` (`packages/habitat/src/a2a-handler.ts`), extend `defaultOutputModes` from `["text/plain"]` to `["text/plain", "text/html+mcp"]` (and/or add it to the relevant `AgentSkill.outputModes`). This is the surface the Focus standard's `text/html+mcp` output mode refers to.

---

## 3. externalUrl + absolute public URLs

`externalUrl` points at a URL the **agent hosts** (e.g. a published artifact at `/files/artifacts/...`). The iframe is loaded by the *client* (SaaS chat / Gaia), so a relative path will not resolve — it must be absolute and public.

**Reuse the #194 helper.** `packages/habitat/src/tools/artifact-tools.ts` exports:

```ts
export function toAbsoluteArtifactUrl(url: string, origin: string | undefined): string
```

It returns the URL unchanged when already absolute (`^https?://`) or when no origin is supplied (local dev), and otherwise joins via WHATWG `new URL(url, origin)` (a leading-slash `/files/...` becomes origin-rooted). The normalizer should call it on `content.iframeUrl` **before** `createUIResource`:

```ts
const absolute = toAbsoluteArtifactUrl(iframeUrl, resolvePublicOrigin?.());
const res = createUIResource({
  uri,
  content: { type: "externalUrl", iframeUrl: absolute },
  encoding: "text",
});
```

The per-request public origin is already threaded into the A2A path: `HabitatAgentExecutor` holds `resolvePublicOrigin?: () => string | undefined` (`a2a-handler.ts:145`), populated by the container server from `X-Forwarded-*` / `BASE_URL` / `Host` (see `container-server.ts:387`). The mcp-ui emit path should consume the **same** resolver so externalUrl iframes resolve off-origin (SaaS, through the Gaia reverse proxy) exactly like FilePart artifact URIs do today (#194). rawHtml needs no absolutization (it's inline markup).

---

## 4. Versioning / install

- **Package:** `@mcp-ui/server`
- **Version:** `^6.1.0` (latest 6.x; matches the Focus "pins 6.x" standard).
- **Add to** `packages/habitat/package.json` `dependencies` (alphabetically near the other `@`-scoped deps), matching the existing caret style:

  ```jsonc
  "@mcp-ui/server": "^6.1.0",
  ```

- **Runtime deps it pulls in (light, server-only):**
  - `@modelcontextprotocol/sdk@^1.25.1` — **already a direct dep** of `@umwelten/habitat` (`^1.29.0`), so deduped.
  - `@modelcontextprotocol/ext-apps@^0.3.1` — small types/constants package (`RESOURCE_URI_META_KEY`, `RESOURCE_MIME_TYPE`).
  - **No** React, no DOM, no browser bundler runtime in the server entry. The client-side renderer lives in the separate `@mcp-ui/client` package — **do not** add that to habitat.
- **ESM / types:** package is `"type": "module"`, `exports.import → ./dist/index.mjs`, `exports.require → ./dist/index.cjs`, `types → ./dist/src/index.d.ts`. Habitat is already `"type": "module"` / NodeNext-style ESM, so `import { createUIResource } from "@mcp-ui/server";` works directly with bundled `.d.ts` — no `@types/*` needed.
- **Node:** habitat requires `node >=20`; mcp-ui's only Node concern is `Buffer` for base64 (present on Node 20+), so `encoding: 'blob'` is safe.
- **Peer deps:** none declared — both deps are regular `dependencies`, so nothing extra to install at the habitat level.

---

## Appendix — verification trail

- 6.1.0 unpacked from `npm pack @mcp-ui/server@6.1.0`; `createUIResource` body in `package/dist/index.mjs` (function `Lk`), default mimeType const `Ht = "text/html;profile=mcp-app"`; content union in `package/dist/src/types.d.ts` (`ResourceContentPayload` = `rawHtml | externalUrl` only).
- 5.16.3 unpacked for comparison: `index.mjs` shows `rawHtml → text/html`, `externalUrl → text/uri-list`, `remoteDom → application/vnd.mcp-ui.remote-dom+javascript; framework=${framework}`.
- A2A Part shapes from `@a2a-js/sdk@0.3.13` `dist/extensions-APfrw8gz.d.ts` (`DataPart` L621, `FilePart` L559, `Part = TextPart | FilePart | DataPart` L27).
- `toAbsoluteArtifactUrl` + `resolvePublicOrigin` threading: `packages/habitat/src/tools/artifact-tools.ts:52`, `packages/habitat/src/a2a-handler.ts:145,326–356`.
- `@mcp-ui/server@npm` versions list confirms 6.1.0 is the current latest.
