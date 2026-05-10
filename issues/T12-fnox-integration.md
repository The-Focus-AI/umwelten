# T12: fnox Integration for Gaia's Own Secrets

> Parent PRD: [Habitat Credential Catalog & Permissions Model](../../docs/architecture/habitat-permissions-prd.md)

## What to build

Integrate fnox as Gaia's secret resolution layer, following the pattern documented in the standards repo's `best-practices/security.md`. Gaia resolves its master vault secrets via fnox at container start, with no plaintext secrets baked into the image.

**`fnox.toml` in Gaia data dir:**
A template/default `fnox.toml` generated on first Gaia boot (if not already present). Declares the secrets Gaia needs: `GOOGLE_GENERATIVE_AI_API_KEY`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_ID`, provider API keys. Each mapped to a provider backend (1Password, age, GCP Secret Manager — whichever the operator configures).

**Bootstrap token:**
Gaia reads a bootstrap token from the environment at container start (e.g., `OP_SERVICE_ACCOUNT_TOKEN` for 1Password, or an age key path). This token is the only secret that needs to be passed to the Gaia container — everything else is resolved by fnox.

**Container entrypoint:**
The Gaia Docker image entrypoint wraps the serve command: `fnox exec -- pnpm serve`. fnox resolves all declared secrets before starting the process.

**Development fallback:**
For local development without fnox installed (e.g., running via `tsx`), Gaia falls back to reading from `.env` or environment variables directly. The fnox layer is a production optimization, not a hard requirement.

## Acceptance criteria

- [ ] `fnox.toml` template is written to Gaia data dir on first boot if not present
- [ ] Gaia resolves secrets via `fnox exec --` when fnox is available and `fnox.toml` exists
- [ ] Bootstrap token is read from environment (not hardcoded)
- [ ] Gaia falls back to `.env` / process.env when fnox is not installed (dev mode)
- [ ] Habitats never call fnox — Gaia is the sole broker
- [ ] fnox is NOT bundled into the habitat Docker image
- [ ] Documentation: README or onboarding describes how to configure fnox for Gaia
- [ ] Unit test: Gaia secret resolution with fnox available, without fnox, with missing bootstrap token

## Blocked by

- T2 (Gaia's data dir structure must be in place for fnox.toml location)
