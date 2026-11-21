# Host-Agnostic `DurableHabitat` & `HabitatHost` Demo

Demonstrates multiplexing SQLite-backed `DurableHabitat` instances on a single Node HTTP server via `HabitatHost` (`@earendil-works/pi-durable` + `@leocavalcante/pi-a2a/durable`), serving `/.well-known/agent-card.json` and A2A 1.0 `SendMessage` JSON-RPC.

```bash
pnpm tsx examples/durable-habitat/host.ts
```
