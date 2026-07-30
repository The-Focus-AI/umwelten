/**
 * Hearthstone — a smart-house demo endpoint for the agent browser. One
 * process that answers as BOTH protocols, with REAL in-process house state
 * (lights + furnace + a lazily drifting indoor temperature) that every
 * tool result's dashboard widget reflects:
 *
 *   - MCP server at        http://localhost:7435/mcp
 *       tools: get_house_status, set_light, set_all_lights, set_furnace
 *   - A2A agent card at    http://localhost:7435/.well-known/agent-card.json
 *   - A2A message/send at  http://localhost:7435/a2a   (text status summary)
 *
 *   pnpm tsx examples/agent-browser/demo-house.ts
 *
 * Point the agent browser at http://localhost:7435/mcp for the MCP face,
 * or http://localhost:7435 for the A2A face. Every tool returns a one-line
 * JSON text block (for text-only clients) plus a self-contained mcp-ui HTML
 * dashboard designed for the browser's 560×320 sandboxed iframe.
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const port = Number(process.env.PORT ?? 7435);

const ROOMS = ["living", "kitchen", "bedroom", "office", "porch"] as const;
type Room = (typeof ROOMS)[number];

/** The one true house. Temperature drift is advanced lazily per request. */
const house = {
  furnace: { on: false, targetF: 68 },
  indoorF: 61,
  rooms: Object.fromEntries(ROOMS.map((r) => [r, { light: false }])) as Record<
    Room,
    { light: boolean }
  >,
  lastTick: Date.now(),
};

const DRIFT_F_PER_MIN = 0.4;
const COLD_FLOOR_F = 55;

function advanceHouse(now = Date.now()): void {
  const minutes = (now - house.lastTick) / 60_000;
  house.lastTick = now;
  if (minutes <= 0) return;
  const target = house.furnace.on ? house.furnace.targetF : COLD_FLOOR_F;
  const delta = target - house.indoorF;
  const step = Math.sign(delta) * Math.min(Math.abs(delta), DRIFT_F_PER_MIN * minutes);
  house.indoorF = Math.round((house.indoorF + step) * 10) / 10;
}

type Trend = "heating" | "cooling" | "holding";

function trend(): Trend {
  const target = house.furnace.on ? house.furnace.targetF : COLD_FLOOR_F;
  if (Math.abs(target - house.indoorF) < 0.3) return "holding";
  return target > house.indoorF ? "heating" : "cooling";
}

function snapshot() {
  return {
    indoorF: house.indoorF,
    furnace: { ...house.furnace },
    trend: trend(),
    rooms: Object.fromEntries(ROOMS.map((r) => [r, house.rooms[r].light])),
    litRooms: ROOMS.filter((r) => house.rooms[r].light),
  };
}

function statusLine(): string {
  const s = snapshot();
  const lit = s.litRooms.length
    ? `lights on in ${s.litRooms.join(", ")}`
    : "all lights off";
  const furnace = s.furnace.on
    ? `furnace on (target ${s.furnace.targetF}°F)`
    : "furnace off";
  return `Indoors ${s.indoorF}°F and ${s.trend}; ${furnace}; ${lit}.`;
}

/**
 * The dashboard: a CSS-grid cross-section of the house. Room cards glow
 * warm amber when lit; the furnace panel burns an animated CSS flame when
 * on. Cards and the furnace toggle are clickable but only update the
 * widget's local view — the footer says so.
 */
function dashboardHtml(): string {
  const s = snapshot();
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing:border-box; }
  body { margin:0; width:560px; height:320px; overflow:hidden; padding:10px 12px;
         background:#16110c; color:#efe6d8;
         font:12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif; }
  #title { font-size:11px; font-weight:700; letter-spacing:.14em; color:#f5a742;
           margin-bottom:8px; }
  #title span { color:#8f8271; font-weight:500; letter-spacing:.06em; }
  #layout { display:flex; gap:10px; height:252px; }
  #housegrid { flex:1; display:grid; gap:7px;
    grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr 0.62fr;
    grid-template-areas:"bedroom office" "living kitchen" "porch porch"; }
  .room { border-radius:10px; padding:7px 9px; cursor:pointer; position:relative;
          border:1px solid #253048; background:#141c2c;
          transition:background .25s,border-color .25s,box-shadow .25s;
          display:flex; flex-direction:column; justify-content:space-between; }
  .room .name { font-size:10px; text-transform:uppercase; letter-spacing:.08em;
                color:#8b95a8; }
  .room.lit { background:radial-gradient(circle at 50% 35%,#4a3413 0%,#2c2010 70%);
              border-color:#7a5a22; box-shadow:0 0 16px rgba(245,167,66,.22) inset,
              0 0 10px rgba(245,167,66,.14); }
  .room.lit .name { color:#e8c98a; }
  .lamp { width:22px; height:22px; }
  #right { width:186px; display:flex; flex-direction:column; gap:8px; }
  #furnace { flex:1; border-radius:10px; border:1px solid #2a3a52; background:#131b29;
             padding:8px 10px; text-align:center; cursor:pointer;
             transition:background .25s,border-color .25s; position:relative; }
  #furnace.on { background:#241609; border-color:#8a4a18;
                box-shadow:0 0 18px rgba(226,87,30,.18) inset; }
  #furnace .label { font-size:10px; text-transform:uppercase; letter-spacing:.1em;
                    color:#8b95a8; }
  #furnace.on .label { color:#f0a35e; }
  .flame { position:relative; width:46px; height:54px; margin:8px auto 2px; }
  .flame i { position:absolute; bottom:0; left:50%; display:block;
             border-radius:50% 50% 50% 50%/62% 62% 38% 38%;
             transform:translateX(-50%); }
  #furnace.on .f1 { width:34px; height:50px; background:#e2571e;
    box-shadow:0 0 22px rgba(255,140,40,.5); animation:flick .9s ease-in-out infinite alternate; }
  #furnace.on .f2 { width:21px; height:33px; background:#ff9d2e;
    animation:flick .66s ease-in-out infinite alternate-reverse; }
  #furnace.on .f3 { width:11px; height:16px; background:#ffe08a;
    animation:flick .5s ease-in-out infinite alternate; }
  #furnace.off .f1 { width:34px; height:50px; background:none;
    border:2px dashed #33475e; }
  @keyframes flick {
    from { transform:translateX(-50%) scale(1,1); }
    to   { transform:translateX(-52%) scale(.9,1.07); } }
  #furnace .state { font-size:11px; font-weight:700; margin-top:2px; }
  #furnace.on .state { color:#ffb45e; } #furnace.off .state { color:#5c7595; }
  #temp { border-radius:10px; border:1px solid #2a3a52; background:#131b29;
          padding:8px 10px; display:flex; gap:9px; align-items:center; height:84px; }
  #temp .big { font-size:19px; font-weight:700; color:#efe6d8; }
  #temp .arrow { color:#8b95a8; font-size:12px; }
  #temp .mode { font-size:10px; color:#8b95a8; margin-top:2px; }
  #note { margin-top:7px; font-size:10px; color:#7d7466; }
  #note.flash { color:#f5a742; }
  </style></head><body>
  <div id="title">HEARTHSTONE <span>· house controller</span></div>
  <div id="layout">
    <div id="housegrid"></div>
    <div id="right">
      <div id="furnace">
        <div class="label">Furnace</div>
        <div class="flame"><i class="f1"></i><i class="f2"></i><i class="f3"></i></div>
        <div class="state"></div>
      </div>
      <div id="temp"></div>
    </div>
  </div>
  <div id="note">Click rooms or the furnace for a local preview — ask the agent to actually switch anything.</div>
  <script>
  const ROOMS = ${JSON.stringify(ROOMS)};
  let s = ${JSON.stringify(s)};
  const lampSvg = (lit) => '<svg class="lamp" viewBox="0 0 24 24">' +
    (lit ? '<ellipse cx="12" cy="12.5" rx="8" ry="4" fill="#f5a742" opacity=".28"/>' : '') +
    '<path d="M8.2 4h7.6l3 7H5.2z" fill="' + (lit ? '#ffc266' : '#3a4658') + '"/>' +
    '<rect x="11.2" y="11" width="1.6" height="7" fill="' + (lit ? '#c89454' : '#31405a') + '"/>' +
    '<path d="M8.5 20h7" stroke="' + (lit ? '#c89454' : '#31405a') + '" stroke-width="2" stroke-linecap="round"/></svg>';
  function render() {
    document.getElementById("housegrid").innerHTML = ROOMS.map((r) =>
      '<div class="room' + (s.rooms[r] ? ' lit' : '') + '" data-room="' + r +
      '" style="grid-area:' + r + '">' + lampSvg(s.rooms[r]) +
      '<div class="name">' + r + '</div></div>').join('');
    const f = document.getElementById("furnace");
    f.className = s.furnace.on ? 'on' : 'off';
    f.querySelector(".state").textContent = s.furnace.on
      ? 'ON · ' + s.furnace.targetF + '°F' : 'OFF';
    const frac = Math.max(0, Math.min(1, (s.indoorF - 50) / 35));
    const mercury = s.trend === 'cooling' ? '#6da7ec' : '#e2861e';
    const modeText = s.trend === 'heating' ? 'heating\\u2026'
      : s.trend === 'cooling' ? 'drifting down\\u2026' : 'holding steady';
    document.getElementById("temp").innerHTML =
      '<svg width="18" height="62" viewBox="0 0 18 62">' +
      '<rect x="6.5" y="3" width="5" height="46" rx="2.5" fill="#0f1622" stroke="#33475e"/>' +
      '<rect x="7.5" y="' + (47 - 42 * frac) + '" width="3" height="' + (42 * frac + 2) +
      '" rx="1.5" fill="' + mercury + '"/>' +
      '<circle cx="9" cy="53" r="6" fill="' + mercury + '"/></svg>' +
      '<div><span class="big">' + s.indoorF + '°F</span> <span class="arrow">→ ' +
      (s.furnace.on ? s.furnace.targetF : ${COLD_FLOOR_F}) + '°F</span>' +
      '<div class="mode">' + modeText + '</div></div>';
    for (const el of document.querySelectorAll(".room"))
      el.onclick = () => { s.rooms[el.dataset.room] = !s.rooms[el.dataset.room]; poke(); };
    f.onclick = () => { s.furnace.on = !s.furnace.on; retrend(); poke(); };
  }
  function retrend() {
    const target = s.furnace.on ? s.furnace.targetF : ${COLD_FLOOR_F};
    s.trend = Math.abs(target - s.indoorF) < .3 ? 'holding'
      : target > s.indoorF ? 'heating' : 'cooling';
  }
  function poke() {
    render();
    const n = document.getElementById("note");
    n.classList.add("flash");
    n.textContent = "local preview — ask the agent to actually switch it";
    setTimeout(() => n.classList.remove("flash"), 900);
  }
  render();
  </script></body></html>`;
}

/** Standard tool payload: one-line JSON first, dashboard resource second. */
function houseResult() {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(snapshot()) },
      {
        type: "resource" as const,
        resource: {
          uri: `ui://hearthstone/dashboard/${randomUUID()}`,
          mimeType: "text/html",
          text: dashboardHtml(),
        },
      },
    ],
  };
}

const agentCard = {
  protocolVersion: "0.2.5",
  name: "Hearthstone",
  description:
    "A smart-house butler that reports and controls the lights and furnace.",
  version: "1.0.0",
  url: `http://localhost:${port}/a2a`,
  capabilities: { streaming: false, pushNotifications: false },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [
    {
      id: "house-status",
      name: "House status",
      description: "Reports lights, furnace, and indoor temperature.",
      tags: ["demo", "smart-home"],
    },
  ],
};

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = createServer((req, res) => {
  void (async () => {
    const path = new URL(req.url ?? "/", `http://localhost:${port}`).pathname;
    advanceHouse();

    if (req.method === "GET" && path === "/.well-known/agent-card.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(agentCard));
      return;
    }

    if (req.method === "POST" && path === "/a2a") {
      const rpc = JSON.parse(await readBody(req));
      const asked: string = (rpc?.params?.message?.parts ?? [])
        .filter((p: { kind?: string }) => p.kind === "text")
        .map((p: { text?: string }) => p.text ?? "")
        .join(" ")
        .toLowerCase();

      // The butler doesn't just report — simple spoken commands work too,
      // so the A2A face lives up to its card. (The MCP face is still the
      // one that returns the visual dashboard.)
      const actions: string[] = [];
      advanceHouse();
      const wantsOff = /\b(off|out|kill|douse)\b/.test(asked);
      const wantsOn = /\bon\b/.test(asked);
      if (/light|lamp/.test(asked) && (wantsOn || wantsOff)) {
        const named = ROOMS.filter((r) => asked.includes(r));
        const targets = named.length ? named : [...ROOMS];
        for (const r of targets) house.rooms[r].light = wantsOn && !wantsOff;
        actions.push(
          `${wantsOn && !wantsOff ? "lit" : "darkened"} ${named.length ? named.join(", ") : "every room"}`,
        );
      }
      const tempMatch = asked.match(/\b(?:to|at)\s+(\d{2})\b/);
      if (/furnace|heat|thermostat|warm/.test(asked)) {
        if (tempMatch) {
          house.furnace.targetF = Math.min(85, Math.max(50, Number(tempMatch[1])));
          house.furnace.on = true;
          actions.push(`set the furnace to ${house.furnace.targetF}°F`);
        } else if (wantsOff) {
          house.furnace.on = false;
          actions.push("shut the furnace down");
        } else if (wantsOn) {
          house.furnace.on = true;
          actions.push(`lit the furnace (target ${house.furnace.targetF}°F)`);
        }
      }

      const preface = actions.length
        ? `Very good — I have ${actions.join(" and ")}. `
        : "";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id ?? null,
          result: {
            kind: "message",
            messageId: randomUUID(),
            role: "agent",
            parts: [
              {
                kind: "text",
                text: `${preface}Hearthstone reporting: ${statusLine()} (Attach my /mcp face to see the dashboard.)`,
              },
            ],
          },
        }),
      );
      return;
    }

    if (path === "/mcp") {
      const raw = await readBody(req);
      let parsed: unknown;
      try {
        parsed = raw ? JSON.parse(raw) : undefined;
      } catch {
        res.writeHead(400).end();
        return;
      }
      const mcp = new McpServer({ name: "hearthstone", version: "1.0.0" });
      mcp.registerTool(
        "get_house_status",
        {
          description:
            "Report the current house state: indoor temperature, furnace, and which rooms are lit. Returns JSON plus a dashboard widget the client may render.",
          inputSchema: {},
        },
        async () => houseResult(),
      );
      mcp.registerTool(
        "set_light",
        {
          description: "Turn one room's light on or off.",
          inputSchema: { room: z.enum(ROOMS), on: z.boolean() },
        },
        async ({ room, on }) => {
          house.rooms[room].light = on;
          return houseResult();
        },
      );
      mcp.registerTool(
        "set_all_lights",
        {
          description: "Turn every light in the house on or off at once.",
          inputSchema: { on: z.boolean() },
        },
        async ({ on }) => {
          for (const r of ROOMS) house.rooms[r].light = on;
          return houseResult();
        },
      );
      mcp.registerTool(
        "set_furnace",
        {
          description:
            "Turn the furnace on or off, optionally setting its target temperature (50–85°F). Indoor temperature drifts toward the target while on, and back toward 55°F while off.",
          inputSchema: {
            on: z.boolean(),
            targetF: z.number().min(50).max(85).optional(),
          },
        },
        async ({ on, targetF }) => {
          house.furnace.on = on;
          if (targetF !== undefined) house.furnace.targetF = Math.round(targetF);
          return houseResult();
        },
      );
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, parsed);
      await transport.close();
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("try /mcp, /a2a, or /.well-known/agent-card.json");
  })().catch((err) => {
    if (!res.headersSent) {
      res.writeHead(500);
      res.end(String(err));
    }
  });
});

server.listen(port, () => {
  console.log(`hearthstone demo: http://localhost:${port}`);
  console.log(`  MCP:      http://localhost:${port}/mcp`);
  console.log(`  A2A card: http://localhost:${port}/.well-known/agent-card.json`);
});
