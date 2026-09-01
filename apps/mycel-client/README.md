# Mycel client

The public Mycel site is an independent Vite application. It deliberately has
its own `pnpm-workspace.yaml`, lockfile, and `node_modules`; it is not a member
of Umwelten's root workspace. The Exchange runtime serves only its compiled
`dist/` output and does not depend on Clerk, Vite, or other client packages.

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

The Mycel container builds this app in an isolated Docker stage and copies only
`dist/` into the runtime image.
