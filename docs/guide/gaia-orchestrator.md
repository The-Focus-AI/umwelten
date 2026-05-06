# Setting Up Gaia and Habitats

Gaia is the **orchestrator** for multiple habitat containers. Instead of running each habitat independently, Gaia gives you a single dashboard to create, configure, start, stop, and talk to all your habitats. It manages Docker containers, isolates secrets, and provides a unified gateway with its own AI chat.

```
┌──────────────────────────────────────────────────┐
│  Gaia Orchestrator (port 7420)                   │
│  ┌────────────────────────────────────────────┐  │
│  │ Dashboard UI + Gaia Chat                   │  │
│  │ Registry (registry.json)                   │  │
│  │ Master Secrets (secrets.json)              │  │
│  │ Docker Manager (docker CLI)                │  │
│  │ A2A Client → discovers + queries habitats  │  │
│  │ Reverse Proxy → containers                 │  │
│  └────────────────────────────────────────────┘  │
│                    │                              │
│   Docker network: gaia-net                       │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│   │habitat-1 │  │habitat-2 │  │habitat-3 │      │
│   │ :8080    │  │ :8080    │  │ :8080    │      │
│   │ A2A+MCP  │  │ A2A+MCP  │  │ A2A+MCP  │      │
│   │ /data    │  │ /data    │  │ /data    │      │
│   └──────────┘  └──────────┘  └──────────┘      │
└──────────────────────────────────────────────────┘
```

**What you'll learn:**

1. How to start the Gaia orchestrator
2. Adding secrets to the master vault
3. Building the habitat Docker image
4. Creating and configuring habitats
5. Starting, stopping, and rebuilding containers
6. Talking to Gaia and to individual habitats
7. How secret isolation works
8. How the port scheme works
9. Using A2A to discover and query habitats
10. Troubleshooting common issues

**Prerequisites:**

- Node.js 20+, pnpm
- Docker installed and running
- At least one LLM API key (Google, OpenRouter, etc.)
- The umwelten repo cloned and dependencies installed

---

## Part 1: Starting Gaia

### Install dependencies

```bash
git clone https://github.com/The-Focus-AI/umwelten.git
cd umwelten
pnpm install
```

### Launch the orchestrator

Gaia needs an LLM provider and model for its own chat. Without these, the dashboard still works for managing habitats, but you can't talk to Gaia.

```bash
# With Gaia chat enabled (recommended)
dotenvx run -- pnpm run cli habitat gaia \
  --provider google \
  --model gemini-3-flash-preview

# Without chat (management only)
dotenvx run -- pnpm run cli habitat gaia
```

You should see:

```
[gaia] Orchestrator at http://0.0.0.0:7420
[gaia]   /api/habitats  — habitat management
[gaia]   /api/secrets   — master secret vault
[gaia]   /api/chat      — Gaia chat (google/gemini-3-flash-preview)
[gaia]   /              — Dashboard UI
[gaia]   /health        — Health check
[gaia] Data: /path/to/gaia-data
[gaia] Habitats: 0
```

Open **http://localhost:7420** in your browser. You'll see the Gaia dashboard with four tabs: **Chat**, **Habitats**, **Secrets**, and **Create**.

### CLI options

| Option | Default | Description |
|--------|---------|-------------|
| `--port <port>` | `7420` | HTTP port for the orchestrator |
| `--data-dir <path>` | `./gaia-data` | Where registry, secrets, and habitat data live |
| `-p, --provider <name>` | — | LLM provider for Gaia's own chat |
| `-m, --model <name>` | — | Model for Gaia's own chat |

### Data directory layout

When Gaia starts, it creates a `gaia-data/` directory:

```
gaia-data/
  registry.json              # All habitat definitions + status
  secrets.json               # Master secret vault (mode 0600)
  habitats/
    jeeves-bot/              # Per-habitat data (only used for seed files)
      config.json            # HabitatConfig
      secrets.json           # FILTERED secrets (only what this habitat needs)
```

Each habitat container gets its own **named Docker volume** (`gaia-<id>-data`) mounted at `/data`. The `gaia-data/habitats/<id>/` directory is only used to prepare seed files that get written into the volume.

---

## Part 2: Adding Secrets

Before creating habitats, add your API keys to the **master vault**. Habitats never see the master vault directly — they only receive the specific secrets you bind to them.

### Via the Dashboard UI

1. Click the **Secrets** tab
2. Enter a secret name (e.g. `GOOGLE_GENERATIVE_AI_API_KEY`) and its value
3. Click **Add Secret**
4. Repeat for any other keys you need

Common secrets you might add:

| Secret Name | Purpose |
|-------------|---------|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google Gemini models |
| `OPENROUTER_API_KEY` | OpenRouter (GPT-4o, Claude, etc.) |
| `TAVILY_API_KEY` | Web search tool |
| `DISCORD_BOT_TOKEN` | Discord bot integration |
| `TELEGRAM_BOT_TOKEN` | Telegram bot integration |

### Via the API

```bash
# Add a secret
curl -X POST http://localhost:7420/api/secrets \
  -H 'Content-Type: application/json' \
  -d '{"name": "GOOGLE_GENERATIVE_AI_API_KEY", "value": "your-key-here"}'

# List secret names (values are never exposed)
curl http://localhost:7420/api/secrets
```

### Via Gaia Chat

If you started Gaia with a provider and model, you can manage secrets conversationally:

> "Add my Google API key: AIza..."

Gaia uses its `set_secret` tool to store it in the vault.

### How secret isolation works

This is a key security feature. When you start a habitat container:

1. Gaia reads the habitat's `secretBindings` — a list of secret **names** (not values)
2. It filters the master vault to only those keys
3. It writes a `secrets.json` with only the filtered secrets into the container's Docker volume
4. The container reads `secrets.json` at startup via the existing `loadSecrets()` mechanism
5. The container also gets a unique `HABITAT_API_KEY` env var (auto-generated) for auth

A habitat that's bound to `GOOGLE_GENERATIVE_AI_API_KEY` will **never** see `OPENROUTER_API_KEY` or any other secret it wasn't explicitly granted. No `env_file` is used — containers are fully isolated.

---

## Part 3: Building the Habitat Docker Image

Before you can start containers, you need to build the habitat image. This is the shared image that all habitat containers run from.

### Via the Dashboard UI

1. Click the **Habitats** tab
2. Click **Build Image** at the top
3. Wait for the build to complete (first build takes a minute or two)

### Via the API

```bash
curl -X POST http://localhost:7420/api/docker/build
```

### Via the CLI

```bash
docker build -t habitat .
```

### Checking Docker status

```bash
curl http://localhost:7420/api/docker/status
# → {"dockerAvailable": true, "imageExists": true}
```

The dashboard also shows Docker status at the top of the Habitats tab.

---

## Part 4: Creating a Habitat

A habitat is defined by an ID (slug), a name, a model configuration, and a set of secret bindings.

### Via the Dashboard UI

1. Click the **Create** tab
2. Fill in the form:
   - **ID**: A slug like `research-bot` (lowercase, hyphens OK)
   - **Name**: A display name like "Research Bot"
   - **Git URL** (optional): A repo to clone into the container (e.g. `https://github.com/you/your-project.git`)
   - **Git Branch** (optional): Branch to check out (defaults to `main`)
   - **Provider**: The LLM provider (e.g. `google`, `openrouter`)
   - **Model**: The model name (e.g. `gemini-3-flash-preview`)
   - **Secret Bindings**: Check the boxes for which master secrets this habitat should receive
3. Click **Create Habitat**

### Via the API

```bash
curl -X POST http://localhost:7420/api/habitats \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "research-bot",
    "name": "Research Bot",
    "provider": "google",
    "model": "gemini-3-flash-preview",
    "secretBindings": ["GOOGLE_GENERATIVE_AI_API_KEY", "TAVILY_API_KEY"]
  }'
```

### Via Gaia Chat

> "Create a habitat called research-bot using Google gemini-3-flash-preview. Bind the Google API key and Tavily key."

### What happens when you create a habitat

1. A registry entry is created in `gaia-data/registry.json`
2. A unique `apiKey` is generated (prefixed with `gaia_`) for container auth
3. A data directory is created at `gaia-data/habitats/<id>/`
4. Seed files (`config.json` + filtered `secrets.json`) are written into the Docker volume

### Git-based habitats

If you provide a `gitUrl`, the container will automatically clone the repository on first boot. The entrypoint script:

1. Checks if `config.json` has a `gitUrl`
2. Clones the repo into `/data/project/` (or whatever `projectDir` is set to)
3. Runs `mise install` if the project has a `mise.toml`
4. Then starts the habitat server

This is great for deploying agents that live in their own repos with custom tools, skills, and personas.

---

## Part 5: Starting and Stopping Habitats

### Starting a habitat

Click **Start** on a habitat card, or:

```bash
curl -X POST http://localhost:7420/api/habitats/research-bot/start
# → {"started": true, "port": 7440}
```

What happens:

1. Gaia seeds the volume with fresh `config.json` and filtered `secrets.json`
2. Gaia assigns a port from the 7440-7499 range
3. Gaia runs `docker run` with:
   - The `habitat` image
   - The named volume `gaia-research-bot-data` mounted at `/data`
   - Port mapping `127.0.0.1:<port>:8080` (localhost only)
   - `HABITAT_API_KEY` env var for auth
   - Connected to the `gaia-net` Docker network
4. The container boots, provisions if needed, and starts serving

The status dot on the habitat card turns **green** when the container is running.

### Stopping a habitat

Click **Stop** on a habitat card, or:

```bash
curl -X POST http://localhost:7420/api/habitats/research-bot/stop
# → {"stopped": true}
```

This runs `docker stop` + `docker rm` on the container. The data volume is preserved — restarting the habitat picks up where it left off.

### Rebuilding a habitat

If you've rebuilt the Docker image or changed the configuration:

```bash
curl -X POST http://localhost:7420/api/habitats/research-bot/rebuild
# → {"rebuilt": true, "port": 7440}
```

This stops the container, re-seeds the volume with fresh config/secrets, and starts a new container with the updated image.

### Viewing logs

```bash
curl http://localhost:7420/api/habitats/research-bot/logs?tail=50
```

Or click **Logs** on the habitat card in the dashboard.

---

## Part 6: Talking to Habitats

Once a habitat is running, there are several ways to interact with it.

### Through the Dashboard

Click a habitat card in the **Habitats** tab to open the detail view. This shows an embedded chat panel that proxies directly to the container's `/api/chat` endpoint. Type messages and the habitat's LLM responds with streaming text, tool calls, and artifacts.

### Through Gaia Chat

You can ask Gaia to relay messages to habitats via A2A:

> "Ask research-bot to summarize recent news about AI agents"

Gaia uses its `ask_habitat` tool, which sends an A2A `message/send` request to the container and returns the response.

### Direct API access

Gaia proxies several endpoints to running containers:

| Gaia URL | Container URL | Purpose |
|----------|--------------|---------|
| `/api/habitats/:id/health` | `/health` | Health check |
| `/api/habitats/:id/chat` | `/api/chat` | LLM chat (SSE streaming) |
| `/api/habitats/:id/mcp` | `/mcp` | MCP tool access |
| `/api/habitats/:id/a2a` | `/a2a` | A2A JSON-RPC |
| `/api/habitats/:id/agent-card` | `/.well-known/agent-card.json` | Agent card |
| `/api/habitats/:id/status` | `/api/status` | Container status |
| `/api/habitats/:id/sessions` | `/api/sessions` | Session list |
| `/api/habitats/:id/artifacts` | `/api/artifacts` | Published artifacts |
| `/api/habitats/:id/files/*` | `/files/*` | File access |

All proxied requests include the container's `Authorization: Bearer <apiKey>` header automatically.

### MCP access

You can connect to a habitat's MCP endpoint through Gaia:

```bash
dotenvx run -- pnpm run cli mcp chat \
  --url http://localhost:7420/api/habitats/research-bot/mcp
```

This gives you direct tool access — all 40+ habitat tools (file operations, web search, session management, etc.) available as MCP tools.

---

## Part 7: A2A Discovery

Gaia acts as an A2A client and can discover what running habitats are capable of.

### Discovering habitats

In Gaia chat:

> "What habitats do I have running?"

Gaia uses `discover_habitats` to fetch the `/.well-known/agent-card.json` from each running container. The agent card includes:

- **Name and description** — what the habitat does
- **Skills** — what capabilities it advertises
- **Input/output modes** — what content types it accepts

### Agent cards

Each habitat container automatically generates an agent card from its config and stimulus. If a habitat has a `STIMULUS.md` persona file, the description comes from there. Skills are derived from the loaded tool sets.

Example agent card:

```json
{
  "name": "Research Bot",
  "description": "A research assistant with web search and file tools",
  "url": "http://localhost:7440",
  "version": "1.0.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": false
  },
  "skills": [
    {
      "id": "web-search",
      "name": "Web Search",
      "description": "Search the web using Tavily"
    }
  ],
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"]
}
```

### Cross-habitat queries

Gaia can aggregate information from multiple habitats:

> "Ask all my habitats what they've been working on today"

Gaia will send A2A messages to each running habitat and combine the responses.

---

## Part 8: The Port Scheme

Umwelten uses a dedicated **74xx** port block to avoid conflicts:

| Port | Service |
|------|---------|
| **7420** | Gaia orchestrator (dashboard + API) |
| **7421** | Legacy `habitat web` single-habitat UI |
| **7430** | `habitat serve` (host-side, for development) |
| **7440–7499** | Gaia-managed habitat containers (assigned sequentially) |
| **8080** | Internal container port (never exposed to host directly) |

When Gaia starts a container, it picks the next available port in the 7440-7499 range. This means you can run up to 60 habitat containers simultaneously. The containers listen on 8080 internally, but Gaia maps them to `127.0.0.1:<port>:8080` — so they're only accessible through Gaia or on localhost.

---

## Part 9: Docker Volumes

Gaia uses **named Docker volumes** instead of bind mounts for habitat data. This is more portable and avoids permission issues.

Each habitat gets a volume named `gaia-<id>-data`. Inside the container, this is mounted at `/data` and contains:

```
/data/
  config.json       # Habitat configuration (provider, model, etc.)
  secrets.json      # Filtered secrets from the master vault
  project/          # Git clone (if gitUrl was provided)
  sessions/         # Conversation transcripts
  artifacts/        # Published artifacts
  skills/           # Installed skills
  tools/            # Custom tools
```

### Seeding volumes

When Gaia writes config or secrets into a volume, it uses a one-shot Alpine container:

```bash
# This is what Gaia does internally
docker run --rm -v gaia-mybot-data:/data -i alpine:3.20 \
  sh -c "cat > /data/config.json"
```

This writes files into the volume without needing bind mounts or running as root on the host.

### Inspecting volumes

```bash
# List all gaia volumes
docker volume ls | grep gaia-

# Inspect a volume
docker volume inspect gaia-research-bot-data

# Browse files in a volume
docker run --rm -v gaia-research-bot-data:/data alpine ls -la /data/
```

### Cleaning up

Stopping a habitat does **not** delete its volume. To fully clean up:

```bash
# Remove the habitat (stops container if running)
curl -X DELETE http://localhost:7420/api/habitats/research-bot

# Then remove the volume manually if desired
docker volume rm gaia-research-bot-data
```

---

## Part 10: Complete Walkthrough

Let's put it all together with a concrete example: setting up Gaia with two habitats — a research assistant and a code helper.

### Step 1: Start Gaia

```bash
cd umwelten
dotenvx run -- pnpm run cli habitat gaia \
  --provider google \
  --model gemini-3-flash-preview
```

### Step 2: Add secrets

Open http://localhost:7420 and click **Secrets**. Add:

- `GOOGLE_GENERATIVE_AI_API_KEY` — your Google key
- `TAVILY_API_KEY` — your Tavily key (for web search)

### Step 3: Build the image

Click **Habitats** tab, then **Build Image**. Wait for it to finish.

### Step 4: Create the research habitat

Click **Create** tab:

- **ID**: `researcher`
- **Name**: Research Assistant
- **Provider**: `google`
- **Model**: `gemini-3-flash-preview`
- **Secrets**: Check `GOOGLE_GENERATIVE_AI_API_KEY` and `TAVILY_API_KEY`

Click **Create Habitat**.

### Step 5: Create the code helper habitat

Click **Create** again:

- **ID**: `coder`
- **Name**: Code Helper
- **Provider**: `google`
- **Model**: `gemini-3-flash-preview`
- **Secrets**: Check `GOOGLE_GENERATIVE_AI_API_KEY` only

Click **Create Habitat**.

### Step 6: Start both habitats

Go to the **Habitats** tab. You should see two cards with gray status dots. Click **Start** on each one. After a few seconds, both dots should turn green.

### Step 7: Verify isolation

Check that the researcher got both keys and the coder only got the Google key:

```bash
# Researcher should have both secrets
docker run --rm -v gaia-researcher-data:/data alpine cat /data/secrets.json
# → {"GOOGLE_GENERATIVE_AI_API_KEY": "...", "TAVILY_API_KEY": "..."}

# Coder should only have the Google key
docker run --rm -v gaia-coder-data:/data alpine cat /data/secrets.json
# → {"GOOGLE_GENERATIVE_AI_API_KEY": "..."}
```

### Step 8: Talk to Gaia

Click the **Chat** tab and try:

> "What habitats are running?"

Gaia will use its `list_habitats` tool and show you both habitats with their status, ports, and models.

> "Ask researcher to find the latest news about AI agents"

Gaia sends an A2A message to the researcher habitat. The researcher uses its LLM and web search tool to find information, then returns the response through Gaia.

> "Ask coder to write a Python function that sorts a list of dictionaries by a key"

Same pattern — Gaia relays to the coder habitat, which generates the code.

### Step 9: Direct chat

Click on the **researcher** card in the Habitats tab to open the detail view. You'll see an embedded chat panel where you're talking directly to the researcher's LLM — no Gaia in the middle.

### Step 10: Check health

```bash
# Gaia health
curl http://localhost:7420/health
# → {"status":"ok","role":"gaia-orchestrator","habitats":2,"secrets":2,"docker":true,"chat":true}

# Researcher health (via proxy)
curl http://localhost:7420/api/habitats/researcher/health

# Researcher agent card (via proxy)
curl http://localhost:7420/api/habitats/researcher/agent-card
```

---

## Part 11: Managing Habitats with Gaia Chat

Gaia has 14 built-in tools that let you manage everything through natural language:

### Registry management

| What to say | What Gaia does |
|-------------|----------------|
| "List my habitats" | `list_habitats` — shows all habitats with status |
| "Create a habitat called X using Google Gemini" | `create_habitat` — creates registry entry + seeds volume |
| "Remove the old-bot habitat" | `remove_habitat` — stops container + removes registry entry |

### Lifecycle

| What to say | What Gaia does |
|-------------|----------------|
| "Start researcher" | `start_habitat` — starts the container |
| "Stop coder" | `stop_habitat` — stops the container |
| "Rebuild researcher" | `rebuild_habitat` — stop + start with fresh config |
| "What's the status of researcher?" | `habitat_status` — container health + config |
| "Show me the researcher logs" | `habitat_logs` — recent container logs |

### Secrets

| What to say | What Gaia does |
|-------------|----------------|
| "Add my OpenRouter key: sk-or-..." | `set_secret` — stores in master vault |
| "What secrets do I have?" | `list_secrets` — lists names (never values) |
| "Bind the OpenRouter key to coder" | `bind_secret` — adds to habitat's secretBindings |

### Cross-habitat communication

| What to say | What Gaia does |
|-------------|----------------|
| "Ask researcher to look up X" | `ask_habitat` — sends A2A message, returns response |
| "Discover what my habitats can do" | `discover_habitats` — fetches all agent cards |

### Infrastructure

| What to say | What Gaia does |
|-------------|----------------|
| "Rebuild the Docker image" | `build_image` — runs `docker build` |

---

## Part 12: Using Git-Based Habitats

For production agents, you'll typically have the agent's persona, tools, and skills in a git repository.

### Repository structure

Your agent repo should contain:

```
my-agent/
  config.json       # HabitatConfig (provider, model, tools, etc.)
  STIMULUS.md       # Persona / system prompt
  mise.toml         # Optional: runtime dependencies
  skills/           # Optional: skill definitions
  tools/            # Optional: custom tool definitions
    my-tool/
      TOOL.md       # Tool definition
      handler.ts    # Tool implementation
```

### Creating a git-based habitat

```bash
curl -X POST http://localhost:7420/api/habitats \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "my-agent",
    "name": "My Agent",
    "gitUrl": "https://github.com/you/my-agent.git",
    "gitBranch": "main",
    "provider": "google",
    "model": "gemini-3-flash-preview",
    "secretBindings": ["GOOGLE_GENERATIVE_AI_API_KEY"]
  }'
```

Or via Gaia chat:

> "Create a habitat called my-agent from https://github.com/you/my-agent.git using Google gemini-3-flash-preview. Bind the Google key."

When the container starts, the entrypoint script clones the repo into `/data/project/`, runs `mise install` if there's a `mise.toml`, and the habitat server picks up the `STIMULUS.md` and custom tools from the project directory.

---

## Part 13: API Reference

### Health

```
GET /health
```

Returns Gaia status including habitat count, secret count, Docker availability, and chat status.

### Habitats

```
GET    /api/habitats                    # List all habitats with container status
POST   /api/habitats                    # Create a new habitat
GET    /api/habitats/:id                # Get habitat details
PUT    /api/habitats/:id                # Update config or secret bindings
DELETE /api/habitats/:id                # Remove habitat (stops container)
```

### Lifecycle

```
POST   /api/habitats/:id/start         # Start container
POST   /api/habitats/:id/stop          # Stop container
POST   /api/habitats/:id/rebuild       # Stop + start with fresh config
GET    /api/habitats/:id/logs?tail=100  # Container logs
```

### Proxy to containers

```
GET    /api/habitats/:id/health         # → /health
POST   /api/habitats/:id/chat           # → /api/chat (SSE streaming)
POST   /api/habitats/:id/mcp            # → /mcp
POST   /api/habitats/:id/a2a            # → /a2a
GET    /api/habitats/:id/agent-card     # → /.well-known/agent-card.json
GET    /api/habitats/:id/status         # → /api/status
GET    /api/habitats/:id/sessions       # → /api/sessions
GET    /api/habitats/:id/artifacts      # → /api/artifacts
GET    /api/habitats/:id/files/*        # → /files/*
```

### Secrets

```
GET    /api/secrets                     # List secret names + which habitats use each
POST   /api/secrets                     # Set {name, value}
DELETE /api/secrets/:name               # Remove a secret
```

### Docker

```
POST   /api/docker/build                # Build the habitat image
GET    /api/docker/status               # Docker + image availability
```

### Chat

```
POST   /api/chat                        # Gaia's own chat (AI SDK data stream)
```

Request body follows the AI SDK Message format:

```json
{
  "messages": [
    {"role": "user", "content": "List my habitats"}
  ]
}
```

Response is an AI SDK data stream with type codes:
- `0:` — text delta
- `9:` — tool call
- `a:` — tool result
- `d:` — finish
- `3:` — error

---

## Troubleshooting

### "Docker not available"

Make sure Docker is installed and the daemon is running:

```bash
docker info
```

If you get a permission error, you may need to add your user to the `docker` group or use `sudo`.

### "No available ports in range 7440–7499"

You have 60 containers running (or stale port assignments). Stop some habitats or check for orphaned containers:

```bash
docker ps -a | grep gaia-
```

### Container starts but shows "unhealthy"

Check the container logs:

```bash
curl http://localhost:7420/api/habitats/<id>/logs?tail=100
# or
docker logs gaia-<id>
```

Common causes:
- Missing API key (check secret bindings)
- Bad model name in config
- Image needs rebuilding after code changes

### "Gaia chat requires --provider and --model"

You started Gaia without specifying a provider/model. Restart with:

```bash
dotenvx run -- pnpm run cli habitat gaia \
  --provider google --model gemini-3-flash-preview
```

### Secrets not showing up in container

1. Check the habitat's `secretBindings` — does it include the secret name?
2. Rebuild the habitat (stop + start re-seeds the volume)
3. Verify the secret is in the master vault:

```bash
curl http://localhost:7420/api/secrets
```

### Container can't reach the internet

Containers are on the `gaia-net` Docker network. Make sure your Docker setup allows outbound access. On macOS with Docker Desktop, this should work by default.

### Stale containers after Gaia restart

If Gaia was killed without graceful shutdown, containers may still be running:

```bash
# List orphaned containers
docker ps -a | grep gaia-

# Stop and remove them
docker stop gaia-<id> && docker rm gaia-<id>
```

Then restart Gaia — it will read `registry.json` and reconcile state.
