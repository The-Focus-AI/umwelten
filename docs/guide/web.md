---
title: Web interface
description: startWebServer — the HTTP peer to Discord/Telegram. Gaia, building your own app, generative UI.
---

# Web interface

Umwelten's web layer is **`startWebServer`** ([`packages/habitat/src/web/server.ts`](@umwelten/habitat/web/server.ts)) — the HTTP peer to the Discord and Telegram adapters. It drives the same `ChannelBridge` ([`@umwelten/habitat/bridge/channel-bridge.ts`](@umwelten/habitat/bridge/channel-bridge.ts)) that every other channel uses, so CLI, Telegram, Discord, and web all share one habitat, one session store, and one transcript format.

Two production consumers ship with the repo:

- **Gaia** ([`packages/habitat/src/gaia-server.ts`](@umwelten/habitat/gaia-server.ts)) — the built-in habitat manager UI served by `umwelten habitat web` / `mise run habitat-web`.
- **umwelten-web-demo** ([`examples/umwelten-web-demo/`](../../examples/umwelten-web-demo/)) — a minimal React + `useChat` reference app for building your own.

## Protocol

`POST /api/chat` streams the [Vercel AI SDK UI Message Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) over SSE with the `x-vercel-ai-ui-message-stream: v1` header. Frames:

```
data: {"type":"start","messageId":"..."}
data: {"type":"text-start","id":"..."}
data: {"type":"text-delta","id":"...","delta":"Hello"}
data: {"type":"text-end","id":"..."}
data: {"type":"tool-input-available","toolCallId":"...","toolName":"current_time","input":{}}
data: {"type":"tool-output-available","toolCallId":"...","output":"..."}
data: {"type":"finish"}
data: [DONE]
```

Any React frontend using `@ai-sdk/react`'s `useChat` connects with no glue code. Gaia keeps an older `event:`-prefixed SSE format for its existing UI; that's handled by the `gaiaRoutes()` route pack ([`packages/habitat/src/gaia-routes.ts`](@umwelten/habitat/gaia-routes.ts)) — custom routes win over defaults, so Gaia overrides `/api/chat` without touching the framework.

## Build your own web app

Minimal server:

```ts
import { Habitat } from 'umwelten';
import { startWebServer } from 'umwelten/ui/web';
import { timeToolSet } from 'umwelten/habitat/tool-sets';

const habitat = await Habitat.create({
  workDir: './my-habitat',
  registerCustomTools: (h) => {
    for (const [name, tool] of Object.entries(timeToolSet.createTools())) {
      h.addTool(name, tool);
    }
  },
});

await startWebServer({
  habitat,
  auth: 'dev',             // or a custom AuthProvider
  staticRoot: './public',  // built SPA
  port: 3000,
});
```

Minimal React client:

```tsx
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

export function Chat() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  // render messages[].parts — text + tool-call + tool-result
}
```

## Default routes

`startWebServer` mounts these out of the box (all under auth):

| Route | Purpose |
|---|---|
| `GET  /api/me` | Authenticated user context (`{ userId, displayName?, provider? }`) |
| `GET  /api/habitat` | Habitat summary (model, agents, tools, skills, stimulus preview) |
| `GET  /api/sessions` | List sessions |
| `GET  /api/sessions/:id` | Session summary (message counts, tokens, cost) |
| `GET  /api/sessions/:id/messages` | Full transcript with tool calls inline |
| `GET  /api/sessions/:id/beats` | Conversation beats |
| `GET  /api/usage` | Per-user token/cost rollup, grouped by provider |
| `POST /api/chat` | AI SDK UI Message Stream (overridable via `routes`) |

Add your own via `routes: RouteHandler[]`:

```ts
await startWebServer({
  habitat,
  auth: 'dev',
  routes: [
    {
      method: 'GET',
      path: '/api/hello/:name',
      async handle(ctx, params) {
        ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
        ctx.res.end(JSON.stringify({ hello: params.name, user: ctx.user.userId }));
      },
    },
  ],
});
```

First match wins, so custom routes override defaults on path+method collisions.

## Auth

`auth: 'dev'` uses [`devAuth`](@umwelten/habitat/web/auth/dev-auth.ts) — pins every request to `userId = 'dev'`, no login. For real auth, pass an `AuthProvider`:

```ts
interface AuthProvider {
  name: string;
  authenticate(req): Promise<UserContext | null>;
  handleAuthRoute?(req, res): Promise<boolean>; // /auth/login, /auth/callback, etc.
}
```

The resolved `userId` flows through `ChannelBridge` onto `Interaction.userId`, which [`buildUserProviderOptions`](@umwelten/core/cognition/provider-options.ts) injects into OpenRouter's `user` field and Anthropic's `metadata.userId` for provider-side attribution. It's also stamped onto session `meta.json`, so `/api/sessions` and `/api/usage` filter correctly per user.

## Generative UI

Structured UI (cards, tables, forms, charts) flows through a `renderUi` tool that passes a [json-render](https://json-render.dev) Spec through the tool-call channel. The client renders it with `@json-render/react`.

```ts
import { makeRenderUiTool, renderUiInstructions } from 'umwelten/stimulus/tools/ui-tools';

habitat.addTool('renderUi', makeRenderUiTool({ catalog })); // catalog optional
```

Each tool call becomes a `tool-input-available` frame whose `input` is the Spec `{ root, elements }`. On the client:

```tsx
import { Renderer } from '@json-render/react';

function ToolCallCard({ part }) {
  if (part.type === 'tool-renderUi' && part.state === 'input-available') {
    return <Renderer spec={part.input} catalog={catalog} />;
  }
  // fall back for other tools
}
```

## Gaia

`umwelten habitat web` (or `mise run habitat-web`) starts Gaia — a thin wrapper over `startWebServer` that mounts the default routes plus Gaia's legacy `/api/chat` (event-SSE) and `/api/command` routes, serves [`examples/gaia-ui/`](../../examples/gaia-ui/) as the SPA, and uses dev auth. Rebuilt to share the `packages/habitat/src/web/` plumbing — no separate codepath.

See [Habitat interfaces](habitat-interfaces.md) for how web fits next to REPL, Telegram, and Discord.
