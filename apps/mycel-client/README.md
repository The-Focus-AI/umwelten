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

After Clerk signs a person in, the client sends the short-lived session token to
Mycel's same-origin `/api/customer` control plane. The server, not this browser
app, binds the verified Clerk subject to a Client and scopes all Applications
and usage. It can create and rotate one-time Application credentials, but never
receives a Clerk secret key. Runtime token verification is configured separately
with `MYCEL_CLERK_ISSUER` and `MYCEL_CLERK_AUTHORIZED_PARTIES` on the Exchange.
