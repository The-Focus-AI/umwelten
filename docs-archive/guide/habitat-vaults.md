# Setting up a habitat's vault

Every habitat declares what it needs and owns a vault that supplies it.
Nothing is shared, nothing is inherited, nothing is inferred.

See [ADR 0009 — per-habitat vaults](../adr/0009-per-habitat-vaults.md) for why
it works this way, and #283 / #284 / #285 for the migration sequence.

## The two files

Both live at the root of the habitat's **Owned repo** — the one repo it can
write to. Gaia reads them from GitHub without cloning, so they must be on the
default branch (or a ref you name).

**`habitat.json`** — what this habitat *is* and what it needs:

```json
{
  "name": "UpperHand AI",
  "provider": "google",
  "model": "gemini-3-flash-preview",
  "secretBindings": ["GOOGLE_GENERATIVE_AI_API_KEY"],
  "mounts": [
    { "id": "upperhand-ae", "gitRemote": "https://github.com/The-Focus-AI/upperhand-ae.git" }
  ]
}
```

**`fnox.toml`** — where those values come from:

```toml
#:schema https://fnox.jdx.dev/schema.json

if_missing = "error"

[providers.onepass]
type = "1password"
vault = "UpperHand"

[secrets.GOOGLE_GENERATIVE_AI_API_KEY]
provider = "onepass"
value = "GOOGLE_GENERATIVE_AI_API_KEY"
```

Every name in `secretBindings` must have a `[secrets.NAME]` block. A binding
the vault cannot supply **fails the start** — see [Why it refuses to
start](#why-it-refuses-to-start).

## Setting one up

**1. Create the 1Password vault.** One per habitat, named for it. Put each
item in it under the name the habitat uses as its env var.

```bash
op vault create UpperHand
op item create --vault UpperHand --category=password \
  --title=GOOGLE_GENERATIVE_AI_API_KEY "password=<value>"
```

**2. Commit both files** to the habitat's repo.

**3. Apply and ask.**

```
apply_habitat_declaration id=upperhand gitUrl=https://github.com/The-Focus-AI/client-upperhand.git
```

There is no separate start step — asking a dormant habitat wakes it. If it is
already running, rebuild so the new declaration reaches the container.

**4. Check it.** `secret_status` shows, per habitat, what it declares, whether
that resolves, and which vault it resolves against. Every line under `Vaults:`
should read *its own vault*.

## Migrating an existing habitat

For a habitat still on the shared master vault:

```
plan_vault_migration id=<habitat>
```

It emits the `fnox.toml` that habitat needs, based on what it currently
declares. It writes nothing — the repo is the source of truth, and that is also
what makes the migration revertible: **delete `fnox.toml`, re-apply, and it
goes back to the master vault.**

The plan contains references, never values, so it is safe to review and commit.

If it flags a binding the master vault cannot satisfy today, that habitat is
already misconfigured. Migrating does not cause that — it reveals it, because
afterwards the habitat refuses to start instead of starting without the value.

## The rules worth knowing

**Names are local.** `DATABASE_URL` in one habitat's vault and in another's are
different items that happen to share a name. This is the whole point: the flat
master vault was one namespace where the key doubled as the env var name, so
two habitats could never hold different values for the same name.

**Habitats never call fnox.** Gaia holds the service account, resolves each
habitat's `fnox.toml` on the host, and injects the values. No container ever
holds a credential that could open a vault — which matters because containers
run agent tools against untrusted input, where a prompt injection could
otherwise enumerate and dump it.

**Profiles work.** fnox profile blocks let one habitat carry separate dev and
prod values.

**Per-user tokens are not vault secrets.** A habitat that runs its own OAuth
(the Twitter habitat, for instance) mints and rotates tokens into its own
store as `NAME:<sub>`. Those are habitat-owned, never declared, and survive
re-seeding and migration untouched. Do not put them in `fnox.toml`.

## Why it refuses to start

A declared binding the vault cannot supply fails the habitat's start with the
name of what is missing.

That is deliberate, and it is worth stating plainly because the alternative
looks friendlier and is much worse. Before this, an unsatisfiable binding was
silently dropped from the container's secrets file. The habitat started. Its
health check passed — health does not call a model. It then failed on the first
real question with a bare `<NAME> environment variable is required`, several
rebuilds away from the cause.

A habitat that cannot be configured should not run.
