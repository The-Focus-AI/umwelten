# Architecture Decision Records

| # | Decision |
|---|---|
| [0001](0001-project-pi-session-trees-as-explorations.md) | Project Pi session trees as Explorations |
| [0002](0002-session-search-shells-out-to-ripgrep.md) | Session search shells out to ripgrep |
| [0003](0003-per-user-a2a-identity.md) | Per-user A2A identity |
| [0004](0004-gaia-github-app.md) | Gaia as a GitHub App |
| [0005](0005-ui-resources-over-a2a-and-mcp.md) | UI resources over A2A and MCP |
| [0006](0006-owned-and-mounted-repos.md) | Owned and mounted repos |
| [0007](0007-a2a-tasks-as-the-wake-contract.md) | A2A Tasks as the wake contract |
| [0008](0008-fleet-topology.md) | Fleet topology |
| [0009](0009-per-habitat-vaults.md) | One vault per habitat, resolved by Gaia |
| [0010](0010-turn-fanout-in-core-not-a-package.md) | Turn fan-out in core, not a package |
| [0012](0012-closed-membership-token-marketplace.md) | Closed-membership token marketplace |
| [0013](0013-charge-is-independent-of-cost.md) | Charge is independent of Cost |
| [0014](0014-exchange-never-authenticates-end-users.md) | The Exchange never authenticates End Users |
| [0015](0015-capabilities-are-probed-through-the-serving-path.md) | Capabilities are probed through the serving path |
| [0016](0016-supplier-agent-serves-by-default.md) | Supplier agent serves by default |
| [0017](0017-the-exchange-meters-at-its-own-boundary.md) | The Exchange meters at its own boundary |
| [0018](0018-one-task-substrate-two-protocol-projections.md) | One task substrate, projected to both A2A and MCP |
| [0019](0019-mrtr-state-splits-by-mode.md) | MRTR elicitation state splits by mode |
| [0020](0020-client-identity-is-hosted-per-product.md) | OAuth client identity is hosted per product |
| [0021](0021-headroom-sampling-policy.md) | Headroom is sampled to a fixed policy, published with the numbers |
| [0022](0022-when-a-probe-goes-stale.md) | A probe goes stale when the serving path moves, and our own code counts |
| [0023](0023-suppliers-dial-in.md) | Machine Suppliers dial in; the Exchange never dials a machine |
| [0024](0024-suppliers-are-paid-from-a-balance.md) | A Supplier is paid from a Balance, like everyone else |
| [0025](0025-the-exchange-bears-its-own-supply-failures.md) | The Exchange bears the cost of its own supply failures |
| [0026](0026-mycel-hosts-its-own-client-surface.md) | Mycel hosts its own Client surface |
| [0027](0027-dispatch-filters-on-resource-properties-and-scores-on-more-than-price.md) | Dispatch filters on resource properties, and scores on more than price |
| [0028](0028-a-client-may-be-postpaid-to-a-limit.md) | A Client may be postpaid, to a limit it was given |
| [0029](0029-mycel-sells-as-principal.md) | Mycel sells as principal, and warrants Guarantees on contract |
| [0030](0030-mycel-runs-on-its-own-vm-with-its-own-identity.md) | Mycel runs on its own VM, with its own GCP identity |
| [0031](0031-interfaces-and-internals-compose-on-the-substrate.md) | Interfaces and habitat internals compose on `@umwelten/substrate` |
| [0032](0032-components-project-onto-the-wire-as-ui-resources.md) | Components project onto the wire as UI resources |
| [0033](0033-the-trust-line-is-the-habitat-boundary.md) | The trust line is the habitat boundary |

0011 is unused — see below.

## Adding one

**Take the next number after the highest in this table, and add your row in the
same commit as the ADR.** Not "the next number after the ADRs I happen to have
open" — check the table.

That instruction exists because it was ignored. Two work streams ran in parallel
in July 2026 and both numbered from 0006, producing *five* colliding pairs
(0006–0010) that nobody noticed for days: git merges them cleanly because the
filenames differ, and no tooling checks. Meanwhile "per ADR 0009" appeared in
tickets, commit messages and code comments, meaning two different documents
depending on who wrote it.

The Exchange series was renumbered to 0012–0017 to resolve it. 0011 was left
unused rather than reshuffling the block again — a gap is cheap, another
renumber is not.

Cite ADRs by number **and slug** in prose (`ADR 0009 — per-habitat vaults`).
A bare number is exactly what made the collision hard to see.
