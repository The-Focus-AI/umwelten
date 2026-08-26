# Shell & Substrate Testing Playbook

How to test the composable UI system — `@umwelten/substrate` (ADR 0031), the
shell serving contract, the habitat panels, wire projection (ADR 0032), foreign
mounting (ADR 0033), and the Gaia fleet view. Two halves: the **automated
pyramid** you run before merging, and the **live platform checklist** you walk
after a deploy to `gaia.habitats.thefocus.ai`.

Related: `docs/architecture/substrate-2026-08.md` (the decision log this
program was built from), `packages/substrate/shell/SERVING-CONTRACT.md` (the
contract the unit tests pin), ADRs 0031–0033.

## The automated pyramid

Five layers, cheapest first. Every layer runs from the repo root.

| Layer | What it proves | Command | Needs |
| --- | --- | --- | --- |
| 1. Substrate laws | Recovery ordering, drain hoisting, inertia, isolation, loader generations (the paper's §5 invariants) | `npx vitest run packages/substrate` | nothing — pure, ~1s |
| 2. Serving contract | Every path in SERVING-CONTRACT.md resolves; transpilation strips TS; traversal refused; host entries + custom dir + solo pages | `npx vitest run packages/habitat/src/shell/serve-shell.test.ts` | nothing |
| 3. Browser smokes | Real Chromium boots the shell against a stubbed `/mcp`: boot, chat round-trip, self-assembly (custom component arrives/updates/departs), quick prompts, solo pages, unmount cascade | `npx vitest run --config vitest.integration.config.ts packages/habitat/src/shell/shell-smoke.integration.test.ts` | Chromium (see below) |
| 4. Wire projection + foreign mounting | A stock MCP SDK client reads `ui://shell/*` resources; a second origin mounts them in a sandboxed iframe with the beacon protocol | `npx vitest run --config vitest.integration.config.ts packages/habitat/src/shell/mcp-resources.integration.test.ts packages/habitat/src/shell/foreign-mount.integration.test.ts` | Chromium |
| 5. Fleet composition | Orchestrator shell lists a two-child fleet, mounts both children's status cards as foreign sub-components, reconciles a stop | `npx vitest run --config vitest.integration.config.ts packages/habitat/src/shell/fleet.integration.test.ts` | Chromium |
| 6. Mycel client surface | The Exchange serves the same contract (#409): manifest of read-only components, traversal refusal, and — in the browser test — health/models cards rendering a live seeded Exchange | unit: `npx vitest run packages/mycel/src/client-surface/serve.test.ts` · browser: `npx vitest run --config vitest.integration.config.ts packages/mycel/src/client-surface/` | Chromium (browser test only) |

Run the whole shell integration surface at once:

```bash
PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium \
  npx vitest run --config vitest.integration.config.ts packages/habitat/src/shell/
```

None of these touch an LLM or need API keys — the `/mcp` endpoints in the
browser tests are stubs. They live under the integration config only because
they launch a real browser.

Before opening a PR, also run the standard gates:

```bash
pnpm test:run   # full unit suite (~4s) — includes layers 1–2
pnpm lint       # must be 0 errors (warnings are pre-existing; errors fail CI)
```

### Chromium

The tests launch `playwright-core` with an explicit executable:

- In this repo's remote/CI environment: `PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium`
- On a dev machine with Playwright installed normally: leave it unset
  (`chromium.launch()` finds the default install), or point it at any Chromium.

Do **not** run `playwright install` in the remote environment — the browser is
pre-installed.

## Post-deploy platform checklist

A push to `main` triggers `.github/workflows/deploy-gaia.yml` on the
self-hosted runner; `redeploy.sh` rebuilds images and cycles the running
habitats. Allow a few minutes. Then walk this list against
`https://gaia.habitats.thefocus.ai`.

**0. Deploy landed.** The manifest is the cheapest fingerprint of a new build:

```bash
curl -s https://gaia.habitats.thefocus.ai/shell/manifest.json | jq '.entries[].id'
```

Expect the built-ins (`layout`, `status`, `conversation`, `tools`, `chat`,
`quick-prompts`, `secrets`, `sessions`) **plus `habitats`** (Gaia's
host-contributed fleet entry), plus any `custom:*` components previously
created on this habitat. The page should boot into the rail arrangement
(ADR 0034): status and quick-prompts in the collapsible left rail, secrets
and sessions in the admin cluster at its bottom, everything else in main. If you're verifying a specific change, poll for a
distinctive string from the diff rather than eyeballing.

**1. Entry + auth.** Open `https://gaia.habitats.thefocus.ai/?token=<GAIA_API_KEY>`.

- `/` must 302 to `/shell/`.
- Use **one** key — the `GAIA_API_KEY` env var may hold a comma-separated
  list; each element is a valid key on its own, but the whole comma-joined
  string is not. (The shell's token handling tolerates a pasted comma list by
  taking the first element, but don't rely on it.)
- The token persists to localStorage (`habitat-token`), so subsequent visits
  work without the query param.
- **Hard-refresh** (Cmd-Shift-R) after a deploy — component modules are
  cached by the browser and a stale `shell.js`/component can mask or invent a
  bug.

**2. Status card.** Shows name, model, tool count within ~15s. If the network
blips it should show a stale marker while keeping the last data — a card that
blanks to "error" on a transient fetch failure is a regression.

**3. Chat round-trip.** Send a message; streamed response renders in the
conversation panel. This exercises token auth, SSE parsing, and the
conversation service in one move.

**4. Self-assembly.** In chat, ask the agent to build a panel:

> create a component that shows the current time, updating every second

`create_component` writes `workDir/components/<name>.js`; the manifest picks
it up with an mtime version; the shell polls every 2s and the new card should
appear **without a reload**. Then ask for a change to the same component — the
card should hot-reload (loader sees the version bump). Ask to remove it — the
card should leave. This is the loop the whole program exists for; if any leg
fails, that's a headline bug.

**5. Panels.** Secrets: add a throwaway secret, see it listed (name only —
values are write-only), remove it. Note the panel is the **habitat's own**
secrets store; the fleet master vault is separate and reachable only through
the `list_secrets`/`secret_status` Gaia tools in chat. Sessions: the list
shows real message counts (a column of "0 msgs" is a regression).

**6. Wire projection.** `https://gaia.habitats.thefocus.ai/shell/solo/status/`
renders the status card alone (plus its providers). And from any stock MCP
client pointed at `https://gaia.habitats.thefocus.ai/mcp` with the bearer
token: `resources/list` includes `ui://shell/<id>` entries, and
`resources/read` on one returns a `text/uri-list` pointing at the solo page.

```bash
dotenvx run -- pnpm run cli mcp connect --url https://gaia.habitats.thefocus.ai/mcp
```

**7. Fleet view.** The `habitats` panel lists the registry with status dots
and start/stop buttons. Every *running* habitat with a public URL also gets a
live status card mounted beside the list — a foreign iframe on the child's own
origin. Stop a habitat: its card leaves on the next refresh (~20s). Start it:
the card returns once the container is healthy.

## What is deliberately not automated

Known seams — cover them by hand when a change touches them, and promote to
automated tests when they stabilize:

- **A live LLM choosing to call `create_component`.** The browser smokes stub
  the tool result; step 4 above is the only end-to-end exercise of a real
  model authoring a component. Model/prompt regressions surface only there.
- **Cross-origin auth for foreign mounts.** The fleet test runs children with
  open auth. On the platform, child tokens ride the registry's public URL
  (`?token=`) — verify a child card actually renders data, not a 401, when
  touching auth or the registry.
- **Per-user connect flows** (`/api/secrets` token delivery, #189) and the
  other legacy routes queued for the #415 audit. Don't delete or "clean up"
  routes as part of shell work — #415 requires a consumer audit first.
- **Deploy pipeline itself.** `redeploy.sh` is exercised only by real deploys;
  a broken deploy shows up as step 0 never landing.

## Flakes and false alarms

- **502/503 during the deploy window** — the runner is cycling containers;
  wait and retry rather than diagnosing.
- **Stale browser cache after deploy** — hard-refresh before believing a UI
  bug (step 1).
- **Comma-joined token pastes** — one key, not the list (step 1).
- **Browser-test timing** — the smokes poll (`expect.poll`) instead of
  one-shot asserts; if you add a test, follow that pattern, and settle
  declarations before disposing contexts in substrate tests. A one-shot read
  of an async card is the most common source of a red that isn't real.
- **Failed dynamic import retries** — ESM caches failures by URL; the loader
  spends a generation per attempt so retries get fresh URLs. If a component
  "won't come back" after a bad edit, check the version actually bumped
  (mtime) rather than suspecting the loader.
