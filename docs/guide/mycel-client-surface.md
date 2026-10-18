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

- **Read-only `/shell/`.** Nothing on the operational surface moves money or
  changes configuration. The trusted `/account/` assembly has authenticated
  customer and admin APIs; it does not load evolved components.
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

## Admin supplier catalogue

Sign in at `/account/` with a Clerk session whose **signed** `metadata.role`
is `admin` (copied from Clerk public metadata by the configured session claim).
Client owners and members are not exchange admins. The catalogue card is
available even before customer onboarding; every catalogue API checks the
verified role independently of the browser.

1. Select an existing supplier, or expand **Connect a vendor**. OpenAI, Groq,
   and Together presets have fixed endpoint/key-variable bindings. Their keys
   must already be installed on the server as `OPENAI_API_KEY`, `GROQ_API_KEY`,
   or `TOGETHER_API_KEY`. No credential value or supplier publisher hash is
   exposed to the browser. Register other endpoints through the operator CLI
   first; the web API accepts neither arbitrary URLs nor environment names.
2. **Add model** using its exact upstream ID, or pick one from the supplier's
   list. Authorize billable test requests, then **Check what this model can
   do**. The server calls chat, embeddings, decisions, speech-to-text, image
   generation, and video generation, in that order, with fixed small fixtures.
   Requests do not follow redirects. Each call waits at most 30 seconds and
   reads at most 10 MB. Speech-to-text must return text and a positive measured
   duration. Decisions must return the decisions contract. The form lists every
   result. Price fields appear only on passes, prefilled from the stored offer
   when that operation was already priced, otherwise wholesale 0 and retail
   $0.10 in / $0.40 out per million units. STT uses seconds in and tokens out:
   $100/million seconds is $0.0001/second. The API stores nonnegative integer
   micro-dollars and requires the operation's exact `OPERATION_UNITS`.
   **Leave out** drops a pass from this save. Other rows have no prices and
   cannot be saved.
3. **Save offer** writes the passes still on the form and whether the offer is
   enabled. It does not call the vendor. A new offer, an offer that was not
   admin-managed, or a check that finds an operation the stored offer did not
   have, is stored disabled until this save. A check that only confirms or
   removes operations leaves that flag as it was. **Edit / verify** on an
   admin-managed offer opens its prices with no probe. **Check again** runs
   the full check and replaces the rows. A vendor offer that is not
   admin-managed opens the check first. An agent supplier is not edited here.
   If the credential is rejected before any pass, or any operation returns no
   result, the stored offer is left unchanged and the form shows those results
   without prices. A credential rejection after a pass records the earlier
   passes and does not send the rest.
4. Use **Disable offer** or **Disable supplier** to withdraw supply, and
   **Refresh availability** to see dispatch eligibility or the blocking reason.

**Publication ownership:** Checking a vendor model records the passes and takes
admin ownership of that supplier/model pair. Saving sets prices and the enable
flag without a new probe. The pair survives both total CLI/agent republishes
and NeonStore restarts, including prices, verification time and disablement.
Other models remain publisher-owned. Admin vendor offers do not
require a `--watch` process and remain published until disabled. There is no
automatic transfer back to publisher ownership in this version. Normal vendor
publications still expire, and dial-in agents still require a live connection.

**Limits:** Eligibility is not continuous vendor health. The displayed timestamp
records endpoint-contract verification, not model quality or an uptime promise.
The generic fixtures may reject vendor-specific APIs or models requiring other
parameters. Chat verifies plain, non-streaming chat only; tool calling,
streaming, vision, reasoning, and structured output are not inferred. Saving
an offer replaces that model's capabilities with the passed operations still
on the form. A refusal or a missing result is not stored as proof the model
lacks the operation. Video verification requires immediate usable media, not just an
asynchronous vendor job ID. Agent model capabilities and per-offer controls
remain agent/CLI-owned; this card shows their availability and can disable a
whole supplier. Use NeonStore for durability; ephemeral MemoryStore deliberately
loses all data when the process exits.

For a **local simulated preview**, run:

```bash
pnpm exec tsx packages/mycel/src/testing/catalogue-preview.ts
```

It uses port 7439 (or `PORT`), a memory store, demo identity and simulated probes;
it never contacts a vendor. Open `/account/`, append `?role=member` or
`?role=anonymous` to review unauthorized UI, and use a model ID containing
`fail` to exercise verification failure. This fixture is not imported by the
production entrypoint. In an orb, start it as a supervised portal service.

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
