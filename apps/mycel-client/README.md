# Mycel browser assets

The public Mycel landing page and the trusted Clerk provider are built in this
independent Vite workspace. It deliberately has its own `pnpm-workspace.yaml`,
lockfile, and `node_modules`; it is not a member of Umwelten's root workspace.
The Exchange runtime serves only its compiled `dist/` output and does not
depend on Clerk, Vite, or other client packages.

```bash
cd apps/mycel-client
cp .env.example .env.local
pnpm install
pnpm dev
```

Set `VITE_CLERK_PUBLISHABLE_KEY` to the browser-safe key for **Mycel's own**
Clerk application. Never place a Clerk secret key in this project. Production
must use a production Clerk instance on Mycel's subdomain, following
[STD-009](https://standards.thefocus.ai/STD-009-authentication.html) and
[GDE-002](https://standards.thefocus.ai/gde-002.html): no shared application,
satellite domain, Organization-based client isolation, root-domain instance,
or proxied Clerk DNS records.

The Mycel container builds these assets in an isolated Docker stage and copies
only `dist/` into the runtime image. `/` is the public landing page. `/account/`
is not a second Vite application: it is a trusted `@umwelten/substrate` Shell
assembly whose layout, customer API provider, and account panels live under
`packages/mycel/src/client-surface/components`. Its authentication provider is
the one browser entry built here because Clerk remains isolated from the root
workspace. Everything is same-origin, so session tokens never cross frontend
services.

The account manifest contains three trusted providers—authentication, layout,
and customer state—plus independently mounted overview, Applications,
playground, funding, administrator grant, ledger, usage, and team components.
It does not mount the agent-authored custom components directory. That trust
split lets the account assembly mutate its same-origin `/api/customer` control
plane while `/shell/` custom components remain provider-free and read-only.

The playground uses the same Substrate conversation renderer as Habitat chat,
but retains Exchange semantics: the customer selects an owned Application and
a live catalogue model, then the server invokes the normal buyer pipeline as a
stable playground End User. No Application credential is returned or stored in
the browser. Manual grants appear only when the verified Clerk session carries
`metadata.role: "admin"` and remain append-only ledger entries. The role comes
from Clerk public metadata via the configured session token claim; Client
ownership and Clerk Organization roles do not confer it.

The server, not a browser component, binds the verified Clerk subject to a
Client and scopes every mutation. The browser never receives a Clerk secret key
and Mycel does not use Clerk Organizations as Client isolation. Runtime token
verification is configured separately with `MYCEL_CLERK_ISSUER` and
`MYCEL_CLERK_AUTHORIZED_PARTIES` on the Exchange.

## Agent discovery

The independent build also publishes three unhashed, no-cache contracts for
coding agents and API tooling:

- `/llms.txt` is the concise discovery document.
- `/llms-full.txt` explains concepts, model selection, request behavior,
  failure classes, and the Substrate trust boundary.
- `/openapi.json` describes the public model catalogue and chat-completions API.

These files point agents to the dynamic `/v1/models` source of truth. Examples
must not imply that the first catalogue entry is preferred: model ids are
sorted lexicographically, availability changes with live Suppliers, and the
calling product—not Mycel—owns its quality/cost/privacy selection policy.

## Provider activation

The UI renders funding as unavailable until the server reports all Stripe
settings configured. Start with Stripe test mode. Configure its API key and the
signing secret for `POST /api/customer/stripe/webhook` in the runtime secret
manager, then set `MYCEL_PUBLIC_ORIGIN`. A successful browser redirect does not
credit the account; only the verified, idempotent webhook does.

Moving Clerk to production is an operator rollout, not a code switch:

1. Create Mycel's production Clerk instance and production domain per STD-009.
2. Configure its sign-in methods and exact `https://mycel.thefocus.ai` origin.
3. Replace the browser `pk_test_*` key with `pk_live_*` and replace the issuer.
4. Remove `MYCEL_ALLOW_DEVELOPMENT_CLERK`; `deploy.sh` then refuses regression
   to a development instance.
