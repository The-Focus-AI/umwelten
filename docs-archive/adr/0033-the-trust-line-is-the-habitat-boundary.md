# 0033 — The trust line is the habitat boundary

Status: **Accepted — partially implemented**
Date: 2026-08-23

Implementation note (2026-08-29): Foreign components mount in sandboxed
iframes and communicate mount status/height through a source-filtered beacon.
The host still assumes rather than enforces that a projection is cross-origin;
same-origin and redirect validation remains required before this ADR is fully
implemented.

> Pinned in the same grilling session as ADR 0031 — interfaces and internals
> compose on the substrate.

A habitat's own components — shipped or authored by its own agent at runtime —
run at **full trust** in its own UI: same page, same services. The agent
already runs arbitrary code in the container, so its components add no
authority it does not have.

A component from **another habitat** never runs naked in the host page. It
mounts behind an iframe from day one, with the wire action vocabulary
(ADR 0032 — components project onto the wire as UI resources) as its only
channel. Language-level control cannot contain untrusted code (the paper's
§6.3), so the boundary is structural, not policy.

The line therefore sits where every other trust line in the system already
sits — the habitat boundary (per-habitat vaults, secret scoping, container
isolation) — not at the authorship boundary. Interception (deferred from
substrate v1) is the future hardening *within* a habitat, if it is ever
needed; it does not replace the iframe at the boundary.
