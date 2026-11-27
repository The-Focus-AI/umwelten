/**
 * Local MCP skill server for the mcp-skills-chat example.
 *
 * Serves a directory of skill folders (each with a SKILL.md) over MCP protocol
 * revision 2026-07-28 with the Skills extension (`io.modelcontextprotocol/skills`),
 * plus two small tools, on `/mcp`. It runs no agent and no model: it only serves.
 *
 * Point `--skills` at any skills directory, e.g. The-Focus-AI/standards'
 * `skills/`, to serve those instead:
 *
 *   pnpm tsx examples/mcp-skills-chat/skill-server.ts --port 7701 --skills ./examples/mcp-skills-chat/skills
 */

import { watch } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadSkills } from "@umwelten/protocols";
import { createTestMcpServer } from "@umwelten/protocols/mcp/testing.js";
import { z } from "zod";

export interface SkillServerOptions {
  port?: number;
  skillsDir?: string;
  name?: string;
  /** Re-scan the skills directory when files change (default true). */
  watch?: boolean;
}

export interface RunningSkillServer {
  mcpUrl: string;
  origin: string;
  reload(): Promise<{ listChanged: boolean; changed: string[] }>;
  close(): Promise<void>;
}

const SERVICE_STATUS: Record<string, string> = {
  api: "degraded — p95 latency 2.4s since 14:05 UTC",
  web: "operational",
  billing: "operational",
};

/** The `ui://` view `service_status` returns: a small status card (MCP-UI raw HTML). */
function statusCard(service: string): string {
  const status = SERVICE_STATUS[service];
  const [state = "unknown", detail = ""] = (status ?? "unknown").split(" — ");
  const color = state === "operational" ? "#2f9e44" : state === "degraded" ? "#e67700" : "#868e96";
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const rows = Object.entries(SERVICE_STATUS)
    .map(([name, s]) => {
      const st = s.split(" — ")[0]!;
      const c = st === "operational" ? "#2f9e44" : "#e67700";
      return `<li${name === service ? ' class="me"' : ""}><i style="background:${c}"></i>${esc(name)}<span>${esc(st)}</span></li>`;
    })
    .join("");
  return `<!doctype html><style>
body{margin:0;font:14px/1.4 system-ui,sans-serif;color:#1d1d1b}
.card{display:flex;gap:18px;padding:14px 16px;align-items:flex-start}
.main{flex:1}.badge{display:inline-block;padding:2px 10px;border-radius:999px;color:#fff;font-weight:600;font-size:12px;background:${color};text-transform:capitalize}
h1{font-size:18px;margin:0 0 6px}.detail{color:#555;margin-top:6px}.time{color:#999;font-size:12px;margin-top:8px}
ul{list-style:none;margin:0;padding:0 0 0 16px;border-left:1px solid #eee;min-width:150px}
li{display:flex;align-items:center;gap:8px;padding:3px 0;color:#666}li span{margin-left:auto;font-size:12px;color:#999}
li.me{color:#1d1d1b;font-weight:600}i{width:8px;height:8px;border-radius:50%}
</style><div class="card"><div class="main"><h1>${esc(service)}</h1><span class="badge">${esc(state)}</span>
${detail ? `<div class="detail">${esc(detail)}</div>` : ""}<div class="time">Checked ${new Date().toISOString().slice(11, 16)} UTC</div></div>
<ul>${rows}</ul></div>`;
}

export async function startSkillServer(options: SkillServerOptions = {}): Promise<RunningSkillServer> {
  const skillsDir = resolve(options.skillsDir ?? fileURLToPath(new URL("./skills", import.meta.url)));
  const name = options.name ?? "umwelten-example-skills";
  const catalog = await loadSkills(skillsDir, { onWarning: (w) => console.warn(`[skills] ${w.path}: ${w.message}`) });

  const mcp = createTestMcpServer({
    name,
    version: "1.0.0",
    instructions: "Example skill server. Its skills are listed with skills/list; load one only when it is relevant.",
    skills: catalog,
    register(server) {
      server.registerTool(
        "get_time",
        { description: "Current time on the skill server host (ISO 8601, UTC)", inputSchema: z.object({}) },
        async () => ({ content: [{ type: "text", text: new Date().toISOString() }] }),
      );
      server.registerTool(
        "service_status",
        {
          description: "Health of one production service (api, web, billing)",
          inputSchema: z.object({ service: z.string().describe("Service name") }),
        },
        async ({ service }) => ({
          content: [
            { type: "text", text: `${service}: ${SERVICE_STATUS[service] ?? "unknown service"}` },
            {
              type: "resource",
              resource: {
                uri: `ui://service-status/${encodeURIComponent(service)}`,
                mimeType: "text/html",
                text: statusCard(service),
              },
            },
          ],
        }),
      );
    },
  });

  const http: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/mcp") return void mcp.nodeHandler(req, res);
    if (path === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, skills: catalog.entries.map((s) => s.uri) }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => http.listen(options.port ?? 7701, "127.0.0.1", r));
  const address = http.address();
  const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : options.port}`;

  const reload = async () => {
    const changes = await catalog.reload();
    if (changes.listChanged) mcp.handler.notify.resourcesChanged();
    return changes;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher =
    options.watch === false
      ? undefined
      : watch(skillsDir, { recursive: true }, () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            void reload().then((c) => {
              if (c.changed.length || c.listChanged) console.log(`[skills] reloaded: ${JSON.stringify(c)}`);
            });
          }, 150);
        });

  return {
    mcpUrl: `${origin}/mcp`,
    origin,
    reload,
    async close() {
      watcher?.close();
      clearTimeout(timer);
      await mcp.close();
      http.closeAllConnections();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      port: { type: "string", default: "7701" },
      skills: { type: "string" },
      name: { type: "string" },
    },
  });
  const server = await startSkillServer({
    port: Number(values.port),
    skillsDir: values.skills,
    name: values.name,
  });
  console.log(`MCP skill server: ${server.mcpUrl}`);
}
