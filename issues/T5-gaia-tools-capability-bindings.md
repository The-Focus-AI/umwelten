# T5: Gaia Tools for Capability Bindings

> Parent PRD: [Habitat Credential Catalog & Permissions Model](../../docs/architecture/habitat-permissions-prd.md)

## What to build

Gaia tools that let operators bind and unbind capabilities to habitats. Extend `create_habitat` to accept an optional `capabilities` parameter. These tools use T4's CapabilityResolver to validate bindings and T4's buildSeedFiles to persist them.

**New Gaia tools:**

- `create_habitat` — extended with optional `capabilities` parameter: an array of `{ capability, credential }` objects. Validates each binding against the credential catalog. Creates the habitat entry with the bindings in config, seeds the volume with resolved secrets.

- `bind_capability` — binds a capability to a habitat using a specific credential. Takes `habitatId`, `capability` (e.g., "quickbooks:read"), `credential` (e.g., "accounting-bot-read-key"). Validates the credential exists and grants the capability. Adds to habitat config. Re-seeds volume if the habitat is not running.

- `unbind_capability` — removes a capability binding from a habitat. Takes `habitatId` and `capability`. Removes from habitat config. Re-seeds volume if not running.

- `list_habitat_capabilities` — shows all capabilities bound to a habitat with the credential name and status for each.

**Backward compatibility:**
Existing habitats that only have `secretBindings` (no capabilities) continue to work. The `secretsToolSet` is NOT restored to Gaia-managed containers — secrets remain read-only from the master vault.

## Acceptance criteria

- [ ] `create_habitat` accepts `capabilities: [{ capability, credential }]` parameter
- [ ] `create_habitat` validates each binding against the catalog before creating
- [ ] `bind_capability` adds a valid binding and re-seeds volume
- [ ] `bind_capability` rejects bindings where credential doesn't exist or doesn't grant the capability
- [ ] `unbind_capability` removes a binding and re-seeds volume
- [ ] `list_habitat_capabilities` shows all bindings with credential status
- [ ] Starting a habitat with capabilities produces `secrets.json` containing resolved credential values
- [ ] Existing habitats without capabilities are unaffected
- [ ] Tools are accessible via Gaia chat (tested with `ask_habitat` or direct MCP calls)
- [ ] Unit tests: create with capabilities, bind, unbind, list, validation failures

## Blocked by

- T4 (CapabilityResolver + buildSeedFiles integration must exist)
