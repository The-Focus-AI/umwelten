# T4: Capability Bindings — HabitatConfig + buildSeedFiles Resolution

> Parent PRD: [Habitat Credential Catalog & Permissions Model](../../docs/architecture/habitat-permissions-prd.md)

## What to build

Extend `HabitatConfig` with a `capabilities` field that declaratively binds capabilities to specific credential names. Extend `buildSeedFiles` in the Gaia seed flow to resolve those bindings into actual secret values from the master vault when writing `secrets.json` for a habitat container.

**Type extension to `HabitatConfig`:**
```typescript
capabilities?: CapabilityBinding[];
// where CapabilityBinding = { capability: string; credential: string }
```

Example config entry:
```json
{
  "capabilities": [
    { "capability": "github:read", "credential": "org-readonly-key" },
    { "capability": "quickbooks:read", "credential": "accounting-bot-read-key" }
  ]
}
```

**New module `CapabilityResolver`:**
Given a list of capability bindings and the credential catalog + master vault, resolves to the env var names and values that should be injected into the habitat. Validates that all requested capabilities are satisfiable (credential exists, is active).

**Modified `buildSeedFiles`:**
After writing `config.json` and `secrets.json`, if the habitat config has capabilities, resolve each binding to the credential's env var name and value from the master vault, and include them in `secrets.json`. Credentials with `refreshTokenExpiry` in the past are flagged as warnings.

This slice is purely the resolution logic + seed file integration. No Gaia tool changes yet (T5), no UI changes (T6).

## Acceptance criteria

- [ ] `HabitatConfig` type includes optional `capabilities: CapabilityBinding[]`
- [ ] `CapabilityResolver.resolve()` takes bindings + catalog + vault, returns `{ envVars: Record<string,string>, warnings: string[] }`
- [ ] Resolver rejects bindings where the credential doesn't exist in the catalog
- [ ] Resolver warns when a credential has status "expired" or refreshTokenExpiry in the past
- [ ] `buildSeedFiles` includes resolved capability secrets in `secrets.json`
- [ ] `secrets.json` produced by buildSeedFiles contains both direct secretBindings AND capability-resolved values
- [ ] Existing habitats without `capabilities` field are unaffected (backward compat)
- [ ] Unit tests: resolver with valid bindings, missing credential, expired credential, overlapping capabilities
- [ ] Unit tests: buildSeedFiles with capabilities produces correct secrets.json

## Blocked by

- T2 (credential catalog must exist to resolve against)
