# Mycel's Client Surface — and how it evolves using itself

The Exchange hostname has two deliberately separate surfaces:

- `https://mycel.thefocus.ai/` is the separately built customer application in
  `apps/mycel-client`. It reads the public `/v1/models` catalogue and uses
  Clerk for customer sign-up and sign-in. Its Clerk application is Mycel's own
  user-pool boundary, following STD-009; Clerk identity does not enter the
  Exchange runtime package.
- `/shell/` is the operational Exchange view. It serves the same host-agnostic
  Shell every habitat serves (`@umwelten/substrate/serve`), with components
  that are strictly read-only over endpoints that already exist. The built-in
  roster is `health` (store reachability), `models` (the catalogue, priced at
  the cheapest eligible Offer), and `catalogue-stats` (the at-a-glance summary
  — itself grown through the loop below, then promoted).

Two decisions bound everything here (ADR 0026, #409):

- **Read-only.** Nothing on this surface moves money or changes
  configuration. Admin stays on the operator CLI (`mycel …`), deliberately —
  see `packages/mycel/src/command.ts` for why there is no HTTP admin API.
  The constraint holds _by construction_: the mycel manifest declares no
  provider entries, so no `shell:tools` (or any mutating service) exists for
  a component to inject. All a component can do is `fetch` the Exchange's
  public reads (`/health`, `/v1/models`).
- **Zero deps on the exchange paths.** `@umwelten/substrate` (itself
  dependency-free) is imported only by `client-surface/serve.ts`; dispatch
  and metering code never touch it.

## Customer application boundary

`apps/mycel-client` is intentionally outside the root `packages/*` workspace.
It owns a nested `pnpm-workspace.yaml`, lockfile, and `node_modules`. The Mycel
container builds that project in a separate Docker stage and copies only its
compiled `dist/` files into `/app/landing`; neither Clerk nor Vite is installed
in the Exchange runtime.

The browser receives only `VITE_CLERK_PUBLISHABLE_KEY`. A Clerk secret key must
never enter the client build. Production uses Mycel's own production Clerk
instance and custom subdomain; see
[STD-009](https://standards.thefocus.ai/STD-009-authentication.html) and
[GDE-002](https://standards.thefocus.ai/gde-002.html).

Build the customer application independently:

```bash
pnpm --dir apps/mycel-client install --frozen-lockfile
pnpm --dir apps/mycel-client build
```

## The self-assembly loop (#410)

Mycel front-end development is a conversation with the agent that owns the
mycel surface. The moving parts:

1. **A dev Exchange with a components directory.** The `--components-dir`
   flag (or `MYCEL_COMPONENTS_DIR`) points a running Exchange at a directory
   of agent-authored components, served live under the standard contract —
   scanned per manifest request, versioned by mtime, hot-reloaded by the
   shell's 2-second poll:

   ```bash
   dotenvx run -- pnpm run cli mycel serve --ephemeral \
     --components-dir ~/mycel-agent/components
   # → http://localhost:7438/shell/
   ```

2. **The mycel-owning agent.** Any habitat whose work directory carries the
   mycel surface. Its `create_component` tool writes plain-ESM modules to
   `workDir/components/` — the same directory the dev Exchange serves:

   ```bash
   dotenvx run -- pnpm run cli habitat local --work-dir ~/mycel-agent
   ```

3. **The conversation.** Ask for a view in chat — _"add a card showing how
   many models are on offer and the cheapest completion price"_. The agent
   writes `components/catalogue-stats.js`; within a poll the card is on the
   open shell page, no rebuild, no reload. Ask for a change; the edit
   hot-replaces the card. A broken edit **rolls back visibly**: the previous
   version keeps rendering while the shell status line names the failure
   (`custom:catalogue-stats: SyntaxError …`); the next good edit recovers.

The loop is exercised end-to-end (minus the LLM choosing to call the tool)
by `packages/mycel/src/client-surface/self-assembly.integration.test.ts` —
a real Exchange, a real Chromium, all four legs: grow, hot-replace, broken
edit, recover.

## Promotion: dev instance → deployed surface

Agent-authored components are a dev-instance affordance. The deployed
Exchange (its own VM, ADR 0030) serves the repo, so promotion is a normal
change:

1. Copy the module from the dev directory into
   `packages/mycel/src/client-surface/components/<name>.js` — verbatim; the
   contract is identical, so no edits are needed beyond a header comment.
2. Add its row to `ENTRIES` in
   `packages/mycel/src/client-surface/serve.ts` (this also changes its id
   from `custom:<name>` to `<name>`).
3. Update the manifest expectation in `serve.test.ts`, run the client-surface
   tests, open a PR.
4. Deploy mycel as usual (`deploy/mycel/README.md`).

`catalogue-stats` is this path exercised once: grown as
`custom:catalogue-stats` on a dev Exchange, promoted with steps 1–3, its
header recording the provenance.

## What to check after touching this surface

```bash
pnpm --dir apps/mycel-client build
npx vitest run packages/mycel/src/client-surface/serve.test.ts
PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium \
  npx vitest run --config vitest.integration.config.ts packages/mycel/src/client-surface/
```

And the read-only rule when reviewing an evolved component: it may `fetch`
GET endpoints and render; anything that would POST, hold a credential, or
reveal a Supplier does not get promoted.
