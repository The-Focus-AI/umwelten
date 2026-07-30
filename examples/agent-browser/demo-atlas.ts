/**
 * Atlas — a route/map planning demo endpoint for the agent browser. One
 * process that answers as BOTH protocols. Geography is fake but coherent:
 * every place name hashes to a stable coordinate on a 1000×620 chart, so
 * "Harbor Point" is always in the same spot, and a fixed decorative
 * terrain (lakes, a river, contour hills) sits behind every map.
 *
 *   - MCP server at        http://localhost:7437/mcp
 *       tools: plan_route (from/to/waypoints/mode), list_landmarks
 *   - A2A agent card at    http://localhost:7437/.well-known/agent-card.json
 *   - A2A message/send at  http://localhost:7437/a2a  ("from X to Y" itinerary)
 *
 *   pnpm tsx examples/agent-browser/demo-atlas.ts
 *
 * Point the agent browser at http://localhost:7437/mcp for the MCP face,
 * or http://localhost:7437 for the A2A face. Every tool returns a one-line
 * JSON text block first plus a self-contained mcp-ui SVG map widget
 * (animated dashed route stroke, numbered markers, leg legend) designed
 * for the browser's 560×320 sandboxed iframe. Route colors (drive
 * #3987e5 / bike #d95926 / walk #199e70) were validated all-pairs with
 * the dataviz palette checker against the chart surface (#0e1a20).
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const port = Number(process.env.PORT ?? 7437);

// ── fake but coherent geography ─────────────────────────────────────────────

const CANVAS_W = 1000;
const CANVAS_H = 620;

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every place name lands on a stable chart coordinate. */
function placeCoord(name: string): { x: number; y: number } {
  const rng = mulberry32(hash32(name.trim().toLowerCase().replace(/\s+/g, " ")));
  return {
    x: Math.round(70 + rng() * (CANVAS_W - 140)),
    y: Math.round(60 + rng() * (CANVAS_H - 120)),
  };
}

type Mode = "drive" | "bike" | "walk";

const MODES: Record<Mode, { color: string; fudge: number; kmh: number; label: string }> = {
  drive: { color: "#3987e5", fudge: 1.35, kmh: 64, label: "driving" },
  bike: { color: "#d95926", fudge: 1.18, kmh: 16.5, label: "cycling" },
  walk: { color: "#199e70", fudge: 1.02, kmh: 4.8, label: "walking" },
};

const KM_PER_PX = 0.32;

interface Leg {
  from: string;
  to: string;
  km: number;
  minutes: number;
}

interface RoutePlan {
  mode: Mode;
  stops: string[];
  legs: Leg[];
  totalKm: number;
  totalMinutes: number;
}

function planRoute(stops: string[], mode: Mode): RoutePlan {
  const m = MODES[mode];
  const legs: Leg[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = placeCoord(stops[i]);
    const b = placeCoord(stops[i + 1]);
    const px = Math.hypot(b.x - a.x, b.y - a.y) * 1.04; // curved path
    const km = Math.round(px * KM_PER_PX * m.fudge * 10) / 10;
    legs.push({
      from: stops[i],
      to: stops[i + 1],
      km,
      minutes: Math.max(1, Math.round((km / m.kmh) * 60)),
    });
  }
  const totalKm = Math.round(legs.reduce((s, l) => s + l.km, 0) * 10) / 10;
  const totalMinutes = legs.reduce((s, l) => s + l.minutes, 0);
  return { mode, stops, legs, totalKm, totalMinutes };
}

function fmtMin(min: number): string {
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

const LANDMARKS: Array<{ name: string; tag: string }> = [
  { name: "Harbor Point", tag: "lighthouse quay" },
  { name: "Old Mill", tag: "riverside ruin" },
  { name: "Observatory", tag: "hilltop dome" },
  { name: "Fern Hollow", tag: "shaded valley" },
  { name: "Saltmarsh Landing", tag: "tidal flats" },
  { name: "Kestrel Ridge", tag: "high moor" },
  { name: "Larkspur Crossing", tag: "market bridge" },
];

// ── widget ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** Fixed decorative terrain in chart coordinates: graticule, contour hills, two lakes, a river. */
function terrainSvg(): string {
  let grat = "";
  for (let x = 125; x < CANVAS_W; x += 125)
    grat += `<line x1="${x}" y1="0" x2="${x}" y2="${CANVAS_H}"/>`;
  for (let y = 125; y < CANVAS_H; y += 125)
    grat += `<line x1="0" y1="${y}" x2="${CANVAS_W}" y2="${y}"/>`;
  const contours = (cx: number, cy: number) =>
    [46, 84, 126, 172]
      .map(
        (r, i) =>
          `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${Math.round(r * 0.72)}" transform="rotate(${i % 2 ? -8 : 6} ${cx} ${cy})"/>`,
      )
      .join("");
  return (
    `<g stroke="#13232c" stroke-width="2">${grat}</g>` +
    `<g fill="none" stroke="#1a303b" stroke-width="3">${contours(790, 140)}${contours(215, 480)}</g>` +
    `<path d="M100,140 C110,90 220,95 245,150 C262,195 190,228 140,212 C95,198 92,172 100,140 Z" fill="#123039" stroke="#1f4a58" stroke-width="3"/>` +
    `<path d="M755,470 C772,418 882,424 902,470 C918,510 862,547 800,536 C752,527 744,504 755,470 Z" fill="#123039" stroke="#1f4a58" stroke-width="3"/>` +
    `<path d="M430,0 C400,90 500,130 480,210 C460,290 380,330 418,410 C452,480 560,520 545,620" fill="none" stroke="#1f4a58" stroke-width="8" stroke-linecap="round" opacity=".9"/>` +
    // compass rose, top-left
    `<g transform="translate(58,66)" stroke="#3a5563" fill="none" stroke-width="3">` +
    `<circle r="30"/><circle r="5" fill="#3a5563" stroke="none"/>` +
    `<path d="M0,-30 L7,0 L0,30 L-7,0 Z" fill="#3a5563" stroke="none" opacity=".85"/>` +
    `<text y="-38" text-anchor="middle" font-size="24" fill="#5d7887" stroke="none">N</text></g>`
  );
}

/** Route polyline through the stops: gently curved quadratic legs. */
function routePathD(pts: Array<{ x: number; y: number }>): string {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const bend = Math.min(80, dist * 0.18) * (i % 2 === 0 ? 1 : -1);
    const cx = (a.x + b.x) / 2 - (dy / dist) * bend;
    const cy = (a.y + b.y) / 2 + (dx / dist) * bend;
    d += ` Q${cx.toFixed(0)},${cy.toFixed(0)} ${b.x},${b.y}`;
  }
  return d;
}

function markerSvg(
  pt: { x: number; y: number },
  label: string,
  fill: string,
  n?: number,
): string {
  const halo = `paint-order="stroke" stroke="#0e1a20" stroke-width="8"`;
  const labelY = pt.y > CANVAS_H - 90 ? pt.y - 40 : pt.y + 58;
  return (
    `<circle cx="${pt.x}" cy="${pt.y}" r="26" fill="${fill}" stroke="#0e1a20" stroke-width="6"/>` +
    (n !== undefined
      ? `<text x="${pt.x}" y="${pt.y + 9}" text-anchor="middle" font-size="27" font-weight="700" fill="#0e1a20">${n}</text>`
      : `<circle cx="${pt.x}" cy="${pt.y}" r="9" fill="#0e1a20"/>`) +
    `<text x="${pt.x}" y="${labelY}" text-anchor="middle" font-size="29" font-weight="600" fill="#cfe0ea" ${halo}>${esc(label)}</text>`
  );
}

const WIDGET_CSS = `
  * { box-sizing:border-box; }
  body { margin:0; width:560px; height:320px; overflow:hidden; padding:10px 12px;
         background:#0b141a; color:#dfe9ef;
         font:12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif; }
  #title { font-size:11px; font-weight:700; letter-spacing:.14em; color:#d6b36a;
           margin-bottom:7px; }
  #title span { color:#7e929f; font-weight:500; letter-spacing:.05em; }
  #layout { display:flex; gap:10px; }
  #map { width:316px; height:196px; border-radius:10px; border:1px solid #1d3340;
         background:#0e1a20; flex:none; }
  #panel { flex:1; min-width:0; background:#111e26; border:1px solid #1d3340;
           border-radius:10px; padding:8px 10px; display:flex; flex-direction:column; }
  #panel h3 { margin:0 0 6px; font-size:10px; text-transform:uppercase;
              letter-spacing:.09em; color:#7e929f; font-weight:700;
              display:flex; align-items:center; gap:5px; }
  #panel h3 i { width:9px; height:9px; border-radius:50%; display:inline-block; }
  .rows { flex:1; overflow:hidden; }
  .leg { display:flex; gap:6px; margin-bottom:5px; font-size:10px; }
  .leg .n { color:#7e929f; font-weight:700; flex:none; width:26px; }
  .leg .names { color:#dfe9ef; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .leg .stats { color:#93a8b4; }
  .total { border-top:1px solid #1d3340; margin-top:2px; padding-top:5px;
           font-size:10.5px; font-weight:700; display:flex; justify-content:space-between; }
  #note { margin-top:6px; font-size:9.5px; color:#5f7280; }
  @keyframes dash { to { stroke-dashoffset:-46; } }
  .route { stroke-dasharray:26 20; animation:dash 1.15s linear infinite; }
`;

function routeWidgetHtml(plan: RoutePlan): string {
  const m = MODES[plan.mode];
  const pts = plan.stops.map(placeCoord);
  const markers = plan.stops
    .map((name, i) => markerSvg(pts[i], name, m.color, i + 1))
    .join("");
  const legRows = plan.legs
    .map(
      (l, i) => `<div class="leg"><span class="n">${i + 1}→${i + 2}</span>
        <div style="min-width:0"><div class="names">${esc(l.from)} → ${esc(l.to)}</div>
        <div class="stats">${l.km} km · ${fmtMin(l.minutes)}</div></div></div>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${WIDGET_CSS}</style></head><body>
  <div id="title">ATLAS <span>· route plan — ${esc(m.label)}</span></div>
  <div id="layout">
    <svg id="map" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" preserveAspectRatio="xMidYMid meet">
      ${terrainSvg()}
      <path class="route" d="${routePathD(pts)}" fill="none" stroke="${m.color}" stroke-width="9" stroke-linecap="round"/>
      ${markers}
    </svg>
    <div id="panel">
      <h3><i style="background:${m.color}"></i>${plan.stops.length} stops · ${esc(m.label)}</h3>
      <div class="rows">${legRows}</div>
      <div class="total"><span>Total</span><span>${plan.totalKm} km · ${fmtMin(plan.totalMinutes)}</span></div>
    </div>
  </div>
  <div id="note">Fictional cartography — every place name maps to a stable spot on Atlas's own chart.</div>
  </body></html>`;
}

function landmarksWidgetHtml(): string {
  const pins = LANDMARKS.map((l) => {
    const p = placeCoord(l.name);
    return markerSvg(p, l.name, "#3987e5");
  }).join("");
  const rows = LANDMARKS.map(
    (l) => `<div class="leg"><span class="n">◆</span>
      <div style="min-width:0"><div class="names">${esc(l.name)}</div>
      <div class="stats">${esc(l.tag)}</div></div></div>`,
  ).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${WIDGET_CSS}</style></head><body>
  <div id="title">ATLAS <span>· charted landmarks</span></div>
  <div id="layout">
    <svg id="map" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" preserveAspectRatio="xMidYMid meet">
      ${terrainSvg()}${pins}
    </svg>
    <div id="panel">
      <h3><i style="background:#3987e5"></i>${LANDMARKS.length} landmarks</h3>
      <div class="rows">${rows}</div>
    </div>
  </div>
  <div id="note">Fictional cartography — ask Atlas to plan a route between any of these.</div>
  </body></html>`;
}

// ── protocol plumbing ───────────────────────────────────────────────────────

const agentCard = {
  protocolVersion: "0.2.5",
  name: "Atlas",
  description: "A cartographic planner that turns place names into routes.",
  version: "1.0.0",
  url: `http://localhost:${port}/a2a`,
  capabilities: { streaming: false, pushNotifications: false },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [
    {
      id: "route-planning",
      name: "Route planning",
      description: "Plans drive/bike/walk routes between named places, with waypoints.",
      tags: ["demo", "maps"],
    },
  ],
};

function parseItinerary(text: string): { stops: string[]; mode: Mode } {
  const mode: Mode = /\b(bike|bicycle|cycl)/i.test(text)
    ? "bike"
    : /\b(walk|foot|hik)/i.test(text)
      ? "walk"
      : "drive";
  const m = text.match(/from\s+(.+?)\s+to\s+(.+?)(?:\s+via\s+(.+?))?\s*[?.!]*$/i);
  if (!m) return { stops: ["Harbor Point", "Observatory"], mode };
  const via = m[3] ? m[3].split(/\s*(?:,|and)\s+/).filter(Boolean) : [];
  return { stops: [m[1].trim(), ...via.map((v) => v.trim()), m[2].trim()], mode };
}

function itineraryText(plan: RoutePlan): string {
  const legs = plan.legs
    .map((l, i) => `${i + 1}. ${l.from} → ${l.to} (${l.km} km, ${fmtMin(l.minutes)})`)
    .join("; ");
  return `Atlas ${MODES[plan.mode].label} route: ${legs}. Total ${plan.totalKm} km, about ${fmtMin(plan.totalMinutes)}.`;
}

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

    if (req.method === "GET" && path === "/.well-known/agent-card.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(agentCard));
      return;
    }

    if (req.method === "POST" && path === "/a2a") {
      const rpc = JSON.parse(await readBody(req));
      const parts: Array<{ kind?: string; text?: string }> =
        rpc?.params?.message?.parts ?? [];
      const asked = parts.filter((p) => p.kind === "text").map((p) => p.text).join(" ");
      const { stops, mode } = parseItinerary(asked);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id ?? null,
          result: {
            kind: "message",
            messageId: randomUUID(),
            role: "agent",
            parts: [{ kind: "text", text: itineraryText(planRoute(stops, mode)) }],
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
      const mcp = new McpServer({ name: "atlas", version: "1.0.0" });
      mcp.registerTool(
        "plan_route",
        {
          description:
            "Plan a route between named places (with up to 4 waypoints) by drive, bike, or walk. Returns JSON legs with distance and duration plus a stylized map widget the client may render.",
          inputSchema: {
            from: z.string().min(1),
            to: z.string().min(1),
            waypoints: z.array(z.string().min(1)).max(4).optional(),
            mode: z.enum(["drive", "bike", "walk"]).optional(),
          },
        },
        async ({ from, to, waypoints, mode }) => {
          const plan = planRoute([from, ...(waypoints ?? []), to], mode ?? "drive");
          return {
            content: [
              { type: "text", text: JSON.stringify(plan) },
              {
                type: "resource",
                resource: {
                  uri: `ui://atlas/route/${randomUUID()}`,
                  mimeType: "text/html",
                  text: routeWidgetHtml(plan),
                },
              },
            ],
          };
        },
      );
      mcp.registerTool(
        "list_landmarks",
        {
          description:
            "List Atlas's charted landmarks (invented, but stable — routes to them always agree). Returns JSON plus a map widget pinning each one.",
          inputSchema: {},
        },
        async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                landmarks: LANDMARKS.map((l) => ({ ...l, ...placeCoord(l.name) })),
              }),
            },
            {
              type: "resource",
              resource: {
                uri: `ui://atlas/landmarks/${randomUUID()}`,
                mimeType: "text/html",
                text: landmarksWidgetHtml(),
              },
            },
          ],
        }),
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
  console.log(`atlas demo: http://localhost:${port}`);
  console.log(`  MCP:      http://localhost:${port}/mcp`);
  console.log(`  A2A card: http://localhost:${port}/.well-known/agent-card.json`);
});
