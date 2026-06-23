# Public-origin URLs for habitat artifacts + A2A FilePart semantics

> **Issue #194.** Habitat agents emit artifact/asset links as relative `/files/artifacts/…`
> paths. These resolve only when the consumer already sits at the habitat's own origin —
> they break from the SaaS chat surface and through the Gaia reverse proxy. We need to mint
> **absolute, public-origin** URLs *at emit time*, and the public origin must be threaded
> into the agent run context, because the publish path runs mid-stream with **no inbound
> HTTP request** to read forwarding headers from.
>
> **TL;DR.** Re-use `getPublicBaseUrl` (it already powers the agent-card self-describe at
> `container-server.ts:435`), but you cannot call it from the artifact path — there's no
> `req` there. Capture the public origin on the *most recent inbound request* (the A2A POST
> / chat request that started the run) and stash it in the run context, then have
> `publish_artifact` join `meta.url` against it. Ship absolute `FilePart.file.uri`. Add a
> **defensive consumer-side base-join** against the AgentCard origin, because (a) the spec
> does **not** forbid relative URIs and (b) **Gaia's proxy does not set `X-Forwarded-*`**,
> so a naive `getPublicBaseUrl(req)` returns the *internal docker host* behind Gaia.

---

## 1. Public-origin resolution behind reverse proxies

### 1.1 What `getPublicBaseUrl` does today

`packages/protocols/src/mcp-serve/public-url.ts` (`getPublicBaseUrl(req)`) derives an origin
in strict precedence:

1. **`X-Forwarded-Proto` + (`X-Forwarded-Host` ?? `Host`)** — if a forwarded proto is
   present and *some* host is known, return `${proto}://${host}`. `firstHeader()` takes the
   first comma-split token and trims (handles `proto1, proto2` proxy chains).
2. **`process.env.BASE_URL`** — explicit env override, trailing slash trimmed.
3. **`Host` header alone** — proto inferred: `http` for `localhost`/`127.0.0.1`/`[::1]`,
   else `https`.
4. **`http://localhost:8080`** — last-ditch fallback.

It **always trusts `X-Forwarded-*` when present** — there is no allow-list of trusted proxy
IPs, no check that the request actually arrived via a known intermediary. That is fine on
**Fly.io**, where the Fly edge *replaces* any client-supplied `X-Forwarded-Proto`/`Host`
(the comment at `public-url.ts:2-4` says exactly this), but it is a **host-header-spoofing
sink** in any topology where an untrusted client can reach the Node server directly with a
forged `X-Forwarded-Host`.

This is the canonical "host header injection" footgun: an attacker who can hit the origin
directly sets `X-Forwarded-Host: evil.example`, and every absolute URL we mint (artifact
links, OAuth redirects, agent-card `url`) now points at their host — the classic
password-reset-poisoning / cache-poisoning / stored-open-redirect vector. The fix is the
standard one: **only trust forwarded headers from a known, trusted intermediary, and ensure
that intermediary overwrites (not appends) the inbound header.** Fly does this for us; Gaia
does **not** (see §1.3). See the security write-ups in *Sources*.

### 1.2 Threading the origin into the run context (the actual #194 work)

The artifact publish path (`tools/artifact-tools.ts:160`) builds `url = /files/artifacts/${file}`
with **no `req` in scope** — it runs deep inside a streaming model turn. So `getPublicBaseUrl`
cannot be called there. Two seams already prove the pattern we should mirror:

- `container-server.ts:435` — the `/.well-known/agent-card.json` handler overrides the
  card's cached `http://localhost:PORT` `url` with `getPublicBaseUrl(req)` ("self-describe
  with the PUBLIC url" — #170). This is request-scoped, so it has `req`.
- `a2a-handler.ts:64-115` / `:332` — `buildAgentCard` bakes a **fixed internal** `baseUrl`
  (`http://localhost:${actualPort}`) at construction time, *because* it has no request. The
  agent card's `url` is then patched per-request at `:438`.

The artifact path is the same shape as `buildAgentCard`: no request, needs the public origin.
**Recommended approach:** capture `getPublicBaseUrl(req)` at the *entry* of the inbound
request that starts the run (the A2A POST handler, the chat HTTP handler) and pass it down
through the `ChannelBridge` → run context → `ArtifactToolsContext`. Concretely, add
`getPublicBaseUrl?(): string | undefined` to `ArtifactToolsContext` (next to the existing
`getWorkDir()` / `getSessionId?()`), populated from the request-captured origin. Then:

```ts
const base = ctx.getPublicBaseUrl?.();              // captured at request entry
const relPath = `/files/artifacts/${artifactFilename}`;
const url = base ? new URL(relPath, base).href : relPath;   // absolute when known
```

Keep `meta.url` storing the **relative** path on disk (it is origin-independent and survives
origin changes / redeploys); compute the absolute URL at emit time and at A2A-artifact build
time (`a2a-handler.ts:313-323`). Do **not** persist the absolute origin into `.meta.json` —
that re-introduces a stale-origin bug across redeploys.

> **Open design question to flag:** the A2A executor's `metaToA2AArtifact` (`a2a-handler.ts:313`)
> also runs in `onDone`, *after* the inbound request object is out of scope. It must read the
> same captured origin from the executor/bridge context, not from a (non-existent) `req`.

### 1.3 The umwelten proxy chain — **critical finding**

Two different fronting topologies, with **different** forwarded-header behavior:

| Path | Sets `X-Forwarded-Proto`/`-Host`? | Result of `getPublicBaseUrl(req)` |
|------|-----------------------------------|-----------------------------------|
| **Fly.io edge** (single habitat) | **Yes** — edge replaces them | Correct public origin ✅ |
| **Caddy → habitat** (`*.habitats.thefocus.ai`) | Yes, if `reverse_proxy` config forwards them (Caddy sets them by default) | Correct, **if** Caddy passes them ✅ |
| **Gaia internal proxy** (`tools/gaia/proxy.ts`) | **No** — see below | **Internal docker host** ❌ |

`gaia/proxy.ts:35-46` builds the upstream request with `{ ...req.headers, host:
`${childHost}:${CHILD_INTERNAL_PORT}`, authorization: Bearer … }`. It **overwrites `Host`**
with the internal docker service name (e.g. `gaia-<id>:8080`) and **adds no `X-Forwarded-*`
headers**. So a habitat behind Gaia that calls `getPublicBaseUrl(req)` will:

- see no `X-Forwarded-Proto` → skip branch 1,
- fall to `BASE_URL` (if the container env sets it) → **this is the only reliable signal
  inside a Gaia child**, else
- fall to the rewritten `Host` (`gaia-<id>:8080`) → mints `http://gaia-<id>:8080/files/…`,
  which is useless to any external consumer.

**Implications for #194:**
1. For Gaia-managed habitats, **set `BASE_URL`** in each child container's env to its
   external origin (the per-habitat `*.habitats.thefocus.ai` hostname). `getPublicBaseUrl`
   already prefers `BASE_URL` over a bare `Host`. This is the cleanest knob and is consistent
   with how Fly secrets/env inject config (see *flyio* report §4). The Gaia registry seeds
   `config.json`/`secrets.json` into named volumes; `BASE_URL` should be seeded the same way.
2. Optionally, have `gaia/proxy.ts` inject `X-Forwarded-Host`/`X-Forwarded-Proto` from the
   *external* Gaia origin before forwarding (so children behind Gaia behave like children
   behind Fly). This is a small, contained change and makes the whole fleet uniform — but it
   means Gaia becomes a trusted header-setter and must **strip any client-supplied
   `X-Forwarded-*`** first (it currently spreads `...req.headers` verbatim, which would *pass
   a spoofed value straight through* — fix that regardless).

> Topology background is already covered — don't re-derive it: Gaia drives the host Docker
> daemon, children bind `127.0.0.1` on ports 7440–7499, reached only via the Gaia reverse
> proxy (see `reports/2026-06-18-gaia-deployment-and-habitat-orchestration.md`). Fly edge
> header handling + `fly secrets`/`[env]` injection (see
> `reports/2026-06-18-flyio-habitat-container-deploy.md` §4).

---

## 2. A2A `FilePart` URI semantics

### 2.1 What `@a2a-js/sdk@0.3.13` actually types (installed version)

From `@a2a-js/sdk@0.3.13` (`packages/habitat/package.json` → `^0.3.13`), the type is a
discriminated union — `FilePart.file` is `FileWithBytes | FileWithUri`:

```ts
interface FilePart { file: FileWithBytes | FileWithUri; kind: "file"; metadata?: {…}; }
interface FileWithBytes { bytes: string; mimeType?: string; name?: string; }  // base64
interface FileWithUri  { uri: string;   mimeType?: string; name?: string; }  // "A URL pointing to the file's content."
```

`uri` is **just `string`** — no format/absoluteness constraint at the type level, no
validator. The doc-comment calls it "A URL pointing to the file's content."

### 2.2 What the protocol spec says — **relative is NOT a hard violation**

The official A2A spec (a2a-protocol.org v0.3.0) describes `FileWithUri.uri` as a URL to the
file's content and gives only a **size heuristic** for choosing bytes vs uri ("small →
`file_with_bytes`; large → read directly from `file_with_uri`"). It **does not normatively
require an absolute URI**, does not define relative-URI resolution, and does not say what
base a consumer resolves against.

**Finding that affects the approach:** shipping a relative `uri` is therefore **not a clean
spec violation — it is underspecified and fragile.** The spec gives no contract for *what
origin* a relative `uri` resolves against, so each consumer is free to guess (or fail). That
is precisely why the SaaS chat and the A2A client mishandle today's `/files/artifacts/…`.
The correct fix is still to emit **absolute** URIs (unambiguous, self-contained, what every
consumer can fetch), but we should **not** describe relative URIs as "illegal" in commit
messages / ADRs — describe them as "underspecified; resolution is consumer-dependent, so we
mint absolute."

### 2.3 `FileWithUri` vs `FileWithBytes`

For habitat artifacts that already live on disk and are served at a stable public URL,
**`FileWithUri` is correct** (avoids base64-bloating every A2A message with potentially
large images/PDFs; matches the spec's "large file" guidance). `FileWithBytes` would only be
warranted for tiny inline assets or when no reachable public origin exists. Keep
`metaToA2AArtifact` on `FileWithUri`; just make the `uri` absolute.

---

## 3. Defensive consumer-side base-join (WHATWG URL)

Even after we mint absolute URIs, the consumer should **not assume** every `FilePart.uri`
it ever receives is absolute (other agents, older habitat versions, the relative URIs we
ship today, §2.2). Today **no consumer does any join**: `a2a/client.ts:178-181` reads
`a.parts?.[0]?.file?.uri` and passes it straight through. Add a defensive join against the
AgentCard origin (the card's `url`/`provider.url` — `a2a-handler.ts:438,442` advertise both).

Use the WHATWG `URL` constructor with the card origin as base:

```ts
function resolveArtifactUri(uri: string, agentOrigin: string): string {
  try { return new URL(uri, agentOrigin).href; }  // absolute uri ignores base; relative is joined
  catch { return uri; }
}
```

**WHATWG gotchas to encode in this helper / its tests:**

- **Already-absolute `uri` wins.** `new URL("https://x/y", base)` ignores `base` entirely —
  safe to always pass our minted absolute URIs through this function.
- **Leading slash = origin-rooted, path replaced.** `new URL("/files/a.png",
  "https://h.example/agent/sub")` → `https://h.example/files/a.png` (the base **path** is
  discarded; only scheme+host+port survive). This is exactly what we want for
  `/files/artifacts/…`, but only if `agentOrigin` carries the right host — pass the card
  **origin**, not a deep path.
- **No leading slash = relative to base directory.** `new URL("a.png",
  "https://h.example/agent")` → `https://h.example/a.png` (note: the last path segment
  `agent` is treated as a file and dropped). Surprising; our paths are slash-rooted so this
  won't bite, but document it so nobody "fixes" the leading slash away.
- **`new URL` throws on an invalid/empty base when `uri` is relative** — hence the
  `try/catch` returning the raw `uri` rather than crashing the whole A2A response parse.
- Resolve against the card's `provider.url` (human-facing origin) or `url` minus the `/a2a`
  suffix — both are the same origin in our cards, so either works; prefer the bare origin.

---

## Executive summary

- **Re-use `getPublicBaseUrl`, but the artifact path has no `req`.** Capture the public
  origin at the inbound request entry (A2A POST / chat handler) and thread it through the run
  context into `ArtifactToolsContext.getPublicBaseUrl()`; join `meta.url` with `new URL(rel,
  base)` at emit time and in `metaToA2AArtifact`. Mirror the existing agent-card pattern at
  `container-server.ts:435`. Keep `.meta.json` storing the **relative** path (origin-stable).
- **Gaia's proxy breaks `getPublicBaseUrl` — top priority.** `tools/gaia/proxy.ts` sets no
  `X-Forwarded-*` and overwrites `Host` with the internal docker name, so a Gaia child would
  mint `http://gaia-<id>:8080/files/…`. Fix by **setting `BASE_URL`** per child container
  (seeded into its volume like config/secrets), and/or having Gaia inject external
  `X-Forwarded-*` (after stripping client-supplied ones).
- **Relative `FilePart.uri` is underspecified, not a spec violation.** The A2A spec
  (`@a2a-js/sdk@0.3.13`) types `uri` as a plain `string` with no absoluteness rule and gives
  only a size heuristic for bytes-vs-uri. Frame the change as "mint absolute because
  relative resolution is consumer-dependent," not as "fixing an illegal value."
- **Keep `FileWithUri` (not `FileWithBytes`).** Artifacts are on-disk and served at a stable
  public URL; uri avoids base64-bloating A2A messages and matches the spec's large-file
  guidance.
- **Add a defensive consumer-side base-join** in `a2a/client.ts` (currently passes
  `file.uri` through untouched). Use `new URL(uri, agentCardOrigin)` in a try/catch:
  absolute URIs pass through unchanged, leading-slash paths re-root onto the card origin,
  invalid bases fall back to the raw uri.

### Findings that change the implementation approach

1. **`getPublicBaseUrl` trusts `X-Forwarded-*` unconditionally (no proxy allow-list).** Safe
   behind Fly (edge overwrites the headers) but a host-header-spoofing sink if any untrusted
   client can reach a habitat origin directly. Gaia currently spreads `...req.headers`
   verbatim, so it would *forward a spoofed `X-Forwarded-Host` straight through* — strip
   client-supplied `X-Forwarded-*` at the Gaia proxy regardless of which fix we pick.
2. **Behind Gaia, `getPublicBaseUrl(req)` returns the internal docker host, not the public
   origin** (proxy sets no forwarding headers + rewrites `Host`). The publish path must lean
   on `BASE_URL` (or a Gaia-injected `X-Forwarded-*`) for Gaia-managed habitats, otherwise
   absolute URLs will be wrong precisely in the topology #194 cares about.
3. **Relative `FilePart.uri` is spec-valid-but-undefined**, so the consumer-side base-join is
   not optional polish — it's the correctness guarantee for any artifact uri that isn't
   already absolute (today's habitats, third-party agents, mixed versions).

## Sources

- [Understanding X-Forwarded-Host: Security & Best Practices (Requestly)](https://requestly.com/blog/x-forwarded-host/)
- [X-Forwarded-Host is always trusted / used in url_for — rails/rails#29893](https://github.com/rails/rails/issues/29893)
- [IP Spoofing via HTTP Headers (OWASP)](https://owasp.org/www-community/pages/attacks/ip_spoofing_via_http_headers)
- [Spoofing of X-Forwarded-Host during HTTPS redirect — ingress-nginx#13158](https://github.com/kubernetes/ingress-nginx/issues/13158)
- [Understanding the X-Forwarded-For HTTP Header — Security Risks & Best Practices (DevSec)](https://devsec-blog.com/2025/04/understanding-the-x-forwarded-for-http-header-security-risks-and-best-practices/)
- [Agent2Agent (A2A) Protocol Official Specification v0.3.0](https://a2a-protocol.org/v0.3.0/specification/)
- [A2A specification.md (a2aproject/A2A)](https://github.com/a2aproject/A2A/blob/main/docs/specification.md)
- [URL — WHATWG URL Standard / MDN `URL()` constructor](https://developer.mozilla.org/en-US/docs/Web/API/URL/URL)
