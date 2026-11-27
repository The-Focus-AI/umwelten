# MCP skills chat

An umwelten agent that connects to MCP servers by URL, discovers their **tools** and **skills** (`io.modelcontextprotocol/skills`, protocol `2026-07-28`), and pulls skills in during a conversation, with you approving each one.

The example runs as three separate processes, each with one job:

| Process | File | Interface | Role |
| :--- | :--- | :--- | :--- |
| **Skill server** | `skill-server.ts` (`:7701`) | MCP `/mcp` | Serves a skills directory and two tools. No model, no agent. |
| **Agent** | `agent.ts` (`:7702`) | A2A `/.well-known/agent-card.json` + `/a2a` for other agents; JSON host API `/api/*` for its operator | The `DurableHabitat`: model, MCP connections, skill registry, approvals. No web page. |
| **Chat UI** | `chat-ui.ts` (`:7700`) | Web page | A thin client: serves the page (and `marked` for Markdown) and forwards `/api/*` to the agent. No state. |

```bash
pnpm tsx examples/mcp-skills-chat/skill-server.ts --port 7701
pnpm tsx examples/mcp-skills-chat/agent.ts --port 7702 --bash --connect examples=http://127.0.0.1:7701/mcp
pnpm tsx examples/mcp-skills-chat/chat-ui.ts --port 7700 --agent http://127.0.0.1:7702
# open http://127.0.0.1:7700

pnpm run demo:mcp-skills               # scripted end-to-end check of all three
pnpm run demo:mcp-skills:conformance   # official conformance scenarios against :7701
```

The agent runs an offline demo model unless you pass `--model provider:id`. To route through the Mycel Exchange, set `MYCEL_URL` (for example `https://mycel.thefocus.ai`) and `MYCEL_API_KEY`, then pass `--model mycel:<id>`, such as `mycel:anthropic/claude-opus-5.5`. Any other Pi provider works too, for example `google:gemini-3-flash-preview`.

The chat page renders assistant replies as Markdown (GFM). Model output is untrusted: raw HTML shows as text, only `http(s)`/`mailto` links are kept, and images become links.

## What happens

| Step | Who | Protocol |
| :--- | :--- | :--- |
| Connect by URL | `discoverAgentEndpoint` → `RemoteMcpClient` | `server/discover` (2026-07-28), `tools/list`, `skills/list` |
| Catalog | `McpSkillHost` → `skills` prompt section | name, description, origin only; nothing is read |
| Model wants a skill | `skill_load("label/name")` parks on approval | approval card shows the manifest hash + files |
| Approve | `McpSkillApprovalSignal` → verified `resources/read` | size, digest, frontmatter checked; content wrapped `<mcp-skill origin="mcp:label">` |
| Supporting files | `skill_read` | only manifest files, only from the skill's own server |
| Skill wants to run code | `bash` parks on a per-call approval while any MCP skill is active | `allowed-tools` is ignored |
| Server changes a file | refresh → manifest hash differs → approval revoked | next load asks again |
| Tool returns custom UI | `ui://` embedded resource kept in the result `details`, not sent to the model | chat UI renders it inline in a sandboxed iframe (`allow-scripts`, no same-origin); try "Is the api service healthy?" |
| New chat | `POST /api/chat/new` | fresh conversation; approvals and connections stay, active skills reset |

Skill identity is `(server label, uri)`. Two servers can both serve `skill://deploy/SKILL.md`; they are different skills, addressed as `alpha/deploy` and `beta/deploy`. A bare name works only when it is unique across every origin.

## A2A agent skills vs MCP skills

- An **A2A agent skill** (agent card `skills[]`) says what an agent can do for you. It has no content.
- An **MCP skill** is a `SKILL.md` package with a digest manifest that a host may load into its own model's context.

A Habitat's A2A card may advertise the MCP skills it **serves** (`createA2ASurface({ servedMcpSkills })`), as agent skills with `id: "mcp-skill:<SKILL.md uri>"` and tag `mcp-skill`. It never advertises MCP skills it has **loaded** from elsewhere: those are per-conversation, approval-bound, third-party content. So the agent here advertises only itself, whatever skills it is using. Connecting another agent's A2A URL in the UI lists that agent's capabilities; they describe what it can do and are never loaded into this agent's context.

## Pointing it at the standards skill server

When a server for The-Focus-AI/standards `skills/` exists, add its URL with a label such as `standards`. Its skills appear as `standards/<name>`. You can try this today by serving a local checkout:

```bash
pnpm tsx examples/mcp-skills-chat/skill-server.ts --port 7703 --skills ../standards/skills --name standards
```

Then choose **+ Add server** in the chat with URL `http://127.0.0.1:7703/mcp` and label `standards`, or start the agent with `--connect standards=http://127.0.0.1:7703/mcp`.

Approvals stay in memory unless you pass the agent `--approvals ~/.umwelten/mcp-skills/approvals.json`. The store refuses paths inside skill-discovery directories (`.agents/skills`, `.claude/skills`, …).
