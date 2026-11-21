# `@umwelten/habitat`

Host-agnostic `DurableHabitat` and multi-Habitat `HabitatHost` built on `@earendil-works/pi-durable` (`Storage` + optional `ExecutionEnv`) with:
- Owned read/write vs. Mounted read-only repository guards (`createRepoScopeExtension`)
- Durable cron schedules (`createCronScheduleExtension`)
- Post-turn `Annotation` fan-out (`createTurnFanoutExtension`)
- `ui://` MCP-UI resource publication (`createUiResourcesExtension`)
- A2A 1.0 JSON-RPC + Agent Card serving (`@leocavalcante/pi-a2a/durable`)

See [`examples/durable-habitat/host.ts`](../../examples/durable-habitat/host.ts).
