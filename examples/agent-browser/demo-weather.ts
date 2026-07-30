/**
 * Meteora — a long-range weather forecasting demo endpoint for the agent
 * browser. One process that answers as BOTH protocols. Forecasts are
 * deterministic pseudo-data: a mulberry32 PRNG seeded from
 * hash(location + ISO day), shaped by a seasonal sinusoid keyed to a
 * pseudo-latitude hashed from the location — so repeated calls agree and
 * different places/days differ plausibly.
 *
 *   - MCP server at        http://localhost:7436/mcp
 *       tools: get_forecast (1–14 days), get_climate_outlook (1–12 months)
 *   - A2A agent card at    http://localhost:7436/.well-known/agent-card.json
 *   - A2A message/send at  http://localhost:7436/a2a  (text 7-day summary)
 *
 *   pnpm tsx examples/agent-browser/demo-weather.ts
 *
 * Point the agent browser at http://localhost:7436/mcp for the MCP face,
 * or http://localhost:7436 for the A2A face. Every tool returns a one-line
 * JSON text block first plus a self-contained mcp-ui SVG chart widget
 * designed for the browser's 560×320 sandboxed iframe. Chart colors were
 * validated with the dataviz palette checker against the widget's own dark
 * surface (#101a24): high #d95926 / low #3987e5 pass all six checks.
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const port = Number(process.env.PORT ?? 7436);
const DEFAULT_LOCATION = "Beacon, NY";

// ── deterministic pseudo-meteorology ────────────────────────────────────────

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

function locKey(location: string): string {
  return location.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Stable per-location climate profile: pseudo-latitude and base wetness. */
function profile(location: string) {
  const h = hash32(locKey(location));
  const lat = 25 + ((h % 1000) / 1000) * 30; // 25..55 "degrees"
  const wet = 0.25 + (((h >>> 10) % 1000) / 1000) * 0.5; // 0.25..0.75
  return { lat, wet };
}

function dayOfYear(d: Date): number {
  return Math.floor(
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
      Date.UTC(d.getFullYear(), 0, 0)) /
      86_400_000,
  );
}

/** Climatological daily mean for this location at this day-of-year, °F. */
function seasonalMeanF(location: string, doy: number): number {
  const { lat } = profile(location);
  const mean = 62 - (lat - 25) * 0.9;
  const amp = 14 + (lat - 25) * 0.55;
  return mean + amp * -Math.cos((2 * Math.PI * (doy - 14)) / 365);
}

type Condition = "sun" | "cloud" | "rain" | "storm" | "snow";

interface DayForecast {
  date: string; // ISO
  weekday: string;
  hi: number;
  lo: number;
  precip: number; // % probability
  condition: Condition;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function forecastDay(location: string, d: Date): DayForecast {
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const rng = mulberry32(hash32(`${locKey(location)}|${iso}`));
  const { wet } = profile(location);
  const base = seasonalMeanF(location, dayOfYear(d));
  const anomaly = (rng() - 0.5) * 14;
  const spread = 7 + rng() * 7;
  const hi = Math.round(base + anomaly + spread / 2);
  const lo = Math.round(base + anomaly - spread / 2 - rng() * 3);
  const precip = Math.round(
    Math.max(0, Math.min(1, rng() * 0.75 + wet * 0.45 - 0.15)) * 100,
  );
  const condition: Condition =
    precip >= 50 && hi <= 36 ? "snow"
    : precip >= 75 && hi >= 68 ? "storm"
    : precip >= 50 ? "rain"
    : precip >= 28 ? "cloud"
    : "sun";
  return { date: iso, weekday: WEEKDAYS[d.getDay()], hi, lo, precip, condition };
}

function forecast(location: string, days: number): DayForecast[] {
  const out: DayForecast[] = [];
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    out.push(forecastDay(location, d));
  }
  return out;
}

type PrecipLean = "wetter" | "drier" | "normal";

interface MonthOutlook {
  month: string; // "2026-08"
  label: string; // "Aug"
  avgF: number;
  normalF: number;
  precip: PrecipLean;
}

function climateOutlook(location: string, months: number): MonthOutlook[] {
  const out: MonthOutlook[] = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 15);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const rng = mulberry32(hash32(`${locKey(location)}|${key}`));
    const normalF = Math.round(seasonalMeanF(location, dayOfYear(d)) * 10) / 10;
    const avgF = Math.round((normalF + (rng() - 0.5) * 8) * 10) / 10;
    const lean = rng() - 0.5 + (profile(location).wet - 0.5) * 0.4;
    const precip: PrecipLean = lean > 0.12 ? "wetter" : lean < -0.12 ? "drier" : "normal";
    out.push({ month: key, label: MONTHS[d.getMonth()], avgF, normalF, precip });
  }
  return out;
}

function outlookSentence(location: string, rows: MonthOutlook[]): string {
  const anom = rows.reduce((s, r) => s + (r.avgF - r.normalF), 0) / rows.length;
  const wetter = rows.filter((r) => r.precip === "wetter").length;
  const drier = rows.filter((r) => r.precip === "drier").length;
  const tempPhrase =
    anom > 1 ? "milder than normal" : anom < -1 ? "cooler than normal" : "near normal temperatures";
  const wetPhrase =
    wetter > drier ? "a wetter lean" : drier > wetter ? "a drier lean" : "typical precipitation";
  const span = `${rows[0].label}–${rows[rows.length - 1].label}`;
  return `${span} in ${location} runs ${tempPhrase} with ${wetPhrase} (${wetter} wetter, ${drier} drier month${drier === 1 ? "" : "s"}).`;
}

// ── widgets ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** Catmull-Rom → cubic bezier path through points. */
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/** Inline SVG weather glyphs — no emoji, no external assets. */
function glyph(kind: Condition, px: number): string {
  const cloudLow = `<path d="M6.5 13h9.8a3.4 3.4 0 0 0 .6-6.76 4.9 4.9 0 0 0-9.5-1.1A3.6 3.6 0 0 0 6.5 13z" fill="#9fb0c0"/>`;
  const bodies: Record<Condition, string> = {
    sun:
      `<g stroke="#e8b93c" stroke-width="1.7" stroke-linecap="round">` +
      `<line x1="12" y1="2.6" x2="12" y2="5.4"/><line x1="12" y1="18.6" x2="12" y2="21.4"/>` +
      `<line x1="2.6" y1="12" x2="5.4" y2="12"/><line x1="18.6" y1="12" x2="21.4" y2="12"/>` +
      `<line x1="5.4" y1="5.4" x2="7.3" y2="7.3"/><line x1="16.7" y1="16.7" x2="18.6" y2="18.6"/>` +
      `<line x1="16.7" y1="7.3" x2="18.6" y2="5.4"/><line x1="5.4" y1="18.6" x2="7.3" y2="16.7"/>` +
      `</g><circle cx="12" cy="12" r="4.5" fill="#e8b93c"/>`,
    cloud: `<path d="M6.3 17.5h10.2a3.9 3.9 0 0 0 .7-7.74 5.4 5.4 0 0 0-10.5-1.2A4.1 4.1 0 0 0 6.3 17.5z" fill="#9fb0c0"/>`,
    rain:
      cloudLow +
      `<g stroke="#6da7ec" stroke-width="1.7" stroke-linecap="round">` +
      `<line x1="8.4" y1="15.6" x2="7.2" y2="19.6"/><line x1="12.4" y1="15.6" x2="11.2" y2="19.6"/>` +
      `<line x1="16.4" y1="15.6" x2="15.2" y2="19.6"/></g>`,
    storm:
      cloudLow +
      `<polygon points="13.4,12.6 9.8,18.4 12.2,18.4 10.9,22.6 16.1,16.4 13.4,16.4 15.6,12.6" fill="#e8b93c"/>`,
    snow:
      cloudLow +
      `<g fill="#e8f1fa"><circle cx="8.4" cy="16.8" r="1.35"/><circle cx="12.4" cy="19.6" r="1.35"/><circle cx="16.4" cy="16.8" r="1.35"/></g>`,
  };
  return `<svg width="${px}" height="${px}" viewBox="0 0 24 24" role="img" aria-label="${kind}">${bodies[kind]}</svg>`;
}

const WIDGET_CSS = `
  * { box-sizing:border-box; }
  body { margin:0; width:560px; height:320px; overflow:hidden; padding:10px 12px;
         background:#101a24; color:#e7edf3;
         font:12px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif; }
  #titlebar { display:flex; align-items:baseline; justify-content:space-between;
              margin-bottom:6px; }
  #title { font-size:11px; font-weight:700; letter-spacing:.13em; color:#8fc1f0; }
  #title span { color:#7b8ea0; font-weight:500; letter-spacing:.05em; }
  #legend { font-size:9.5px; color:#9db0c0; display:flex; gap:10px; }
  #legend i { display:inline-block; width:8px; height:8px; border-radius:50%;
              margin-right:4px; vertical-align:-1px; }
  text { font-family:system-ui,-apple-system,"Segoe UI",sans-serif; }
`;

function dailyWidgetHtml(location: string, days: DayForecast[]): string {
  const W = 536;
  const plotX0 = 36;
  const plotX1 = W - 8;
  const tY0 = 8;
  const tY1 = 108;
  const pBase = 158;
  const pMax = 32;
  const n = days.length;
  const step = (plotX1 - plotX0) / n;
  const cx = (i: number) => plotX0 + (i + 0.5) * step;

  const tMin = Math.min(...days.map((d) => d.lo)) - 4;
  const tMax = Math.max(...days.map((d) => d.hi)) + 4;
  const ty = (t: number) => tY1 - ((t - tMin) / (tMax - tMin)) * (tY1 - tY0);

  // gridlines on a clean step
  const range = tMax - tMin;
  const tick = range > 45 ? 20 : range > 22 ? 10 : 5;
  let grid = "";
  for (let t = Math.ceil(tMin / tick) * tick; t <= tMax; t += tick) {
    grid +=
      `<line x1="${plotX0}" y1="${ty(t).toFixed(1)}" x2="${plotX1}" y2="${ty(t).toFixed(1)}" stroke="#223140" stroke-width="1"/>` +
      `<text x="${plotX0 - 5}" y="${(ty(t) + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="#7b8ea0">${t}°</text>`;
  }

  const hiPts = days.map((d, i) => [cx(i), ty(d.hi)] as [number, number]);
  const loPts = days.map((d, i) => [cx(i), ty(d.lo)] as [number, number]);
  const hiD = smoothPath(hiPts);
  const loRev = [...loPts].reverse();
  const band =
    n > 1
      ? `${hiD} L${loRev[0][0].toFixed(1)},${loRev[0][1].toFixed(1)} ${smoothPath(loRev).replace(/^M[^C]*/, "")} Z`
      : "";

  // selective direct labels: the warmest hi and the coldest lo
  const hiMaxI = days.reduce((b, d, i) => (d.hi > days[b].hi ? i : b), 0);
  const loMinI = days.reduce((b, d, i) => (d.lo < days[b].lo ? i : b), 0);
  const halo = `paint-order="stroke" stroke="#101a24" stroke-width="3"`;
  const labels =
    `<text x="${hiPts[hiMaxI][0].toFixed(1)}" y="${(hiPts[hiMaxI][1] - 6).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="#e7edf3" ${halo}>${days[hiMaxI].hi}°</text>` +
    `<text x="${loPts[loMinI][0].toFixed(1)}" y="${(loPts[loMinI][1] + 13).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="#e7edf3" ${halo}>${days[loMinI].lo}°</text>`;

  // precipitation bars (2px surface gaps come from the bar width < step)
  const barW = Math.min(24, step * 0.5);
  let bars = "";
  for (let i = 0; i < n; i++) {
    const h = (days[i].precip / 100) * pMax;
    bars +=
      `<rect x="${(cx(i) - barW / 2).toFixed(1)}" y="${(pBase - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="#6da7ec"><title>${days[i].weekday} · ${days[i].precip}% precip</title></rect>` +
      (days[i].precip >= 45
        ? `<text x="${cx(i).toFixed(1)}" y="${(pBase - h - 3).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#9db0c0">${days[i].precip}</text>`
        : "");
  }

  const todayLine = `<line x1="${cx(0).toFixed(1)}" y1="${tY0}" x2="${cx(0).toFixed(1)}" y2="${pBase}" stroke="#3a4d61" stroke-width="1" stroke-dasharray="3 3"/>`;

  const cards = days
    .map(
      (d, i) => `<div class="day${i === 0 ? " today" : ""}">
        <div class="wd">${i === 0 ? "Today" : d.weekday}</div>${glyph(d.condition, n > 10 ? 15 : 18)}
        <div class="hi">${d.hi}°</div><div class="lo">${d.lo}°</div></div>`,
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>${WIDGET_CSS}
  #days { display:flex; gap:${n > 10 ? 2 : 4}px; margin-top:5px; }
  .day { flex:1; min-width:0; background:#16222e; border:1px solid #223140;
         border-radius:8px; padding:4px 1px 5px; text-align:center;
         display:flex; flex-direction:column; align-items:center; gap:1px; }
  .day.today { border-color:#3d566b; background:#1a2938; }
  .day .wd { font-size:${n > 10 ? 8 : 9}px; color:#9db0c0; text-transform:uppercase;
             letter-spacing:.04em; }
  .day .hi { font-size:${n > 10 ? 9.5 : 11}px; font-weight:700; }
  .day .lo { font-size:${n > 10 ? 8.5 : 9.5}px; color:#9db0c0; }
  </style></head><body>
  <div id="titlebar">
    <div id="title">METEORA <span>· ${days.length}-day forecast — ${esc(location)}</span></div>
    <div id="legend"><span><i style="background:#d95926"></i>high</span><span><i style="background:#3987e5"></i>low</span><span><i style="background:#6da7ec"></i>precip %</span></div>
  </div>
  <svg width="${W}" height="164" viewBox="0 0 ${W} 164">
    <defs><linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d95926" stop-opacity=".16"/>
      <stop offset="1" stop-color="#3987e5" stop-opacity=".16"/>
    </linearGradient></defs>
    ${grid}${todayLine}
    ${band ? `<path d="${band}" fill="url(#band)"/>` : ""}
    <path d="${hiD}" fill="none" stroke="#d95926" stroke-width="2" stroke-linecap="round"/>
    <path d="${smoothPath(loPts)}" fill="none" stroke="#3987e5" stroke-width="2" stroke-linecap="round"/>
    ${n === 1 ? `<circle cx="${cx(0)}" cy="${ty(days[0].hi).toFixed(1)}" r="4" fill="#d95926"/><circle cx="${cx(0)}" cy="${ty(days[0].lo).toFixed(1)}" r="4" fill="#3987e5"/>` : ""}
    ${labels}
    <text x="2" y="146" font-size="8" fill="#7b8ea0">precip</text>
    ${bars}
    <line x1="${plotX0}" y1="${pBase}" x2="${plotX1}" y2="${pBase}" stroke="#31414f" stroke-width="1"/>
  </svg>
  <div id="days">${cards}</div>
  </body></html>`;
}

function climateWidgetHtml(location: string, rows: MonthOutlook[]): string {
  const W = 536;
  const plotX0 = 36;
  const plotX1 = W - 10;
  const y0 = 8;
  const y1 = 112;
  const n = rows.length;
  const step = (plotX1 - plotX0) / Math.max(1, n);
  const cx = (i: number) => plotX0 + (i + 0.5) * step;

  const bandHalf = 5;
  const vMin = Math.min(...rows.map((r) => Math.min(r.avgF, r.normalF - bandHalf))) - 3;
  const vMax = Math.max(...rows.map((r) => Math.max(r.avgF, r.normalF + bandHalf))) + 3;
  const vy = (t: number) => y1 - ((t - vMin) / (vMax - vMin)) * (y1 - y0);

  const range = vMax - vMin;
  const tick = range > 45 ? 20 : range > 22 ? 10 : 5;
  let grid = "";
  for (let t = Math.ceil(vMin / tick) * tick; t <= vMax; t += tick) {
    grid +=
      `<line x1="${plotX0}" y1="${vy(t).toFixed(1)}" x2="${plotX1}" y2="${vy(t).toFixed(1)}" stroke="#223140" stroke-width="1"/>` +
      `<text x="${plotX0 - 5}" y="${(vy(t) + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="#7b8ea0">${t}°</text>`;
  }

  const upPts = rows.map((r, i) => [cx(i), vy(r.normalF + bandHalf)] as [number, number]);
  const dnPts = rows.map((r, i) => [cx(i), vy(r.normalF - bandHalf)] as [number, number]);
  const dnRev = [...dnPts].reverse();
  const bandD =
    n > 1
      ? `${smoothPath(upPts)} L${dnRev[0][0].toFixed(1)},${dnRev[0][1].toFixed(1)} ${smoothPath(dnRev).replace(/^M[^C]*/, "")} Z`
      : "";

  const avgPts = rows.map((r, i) => [cx(i), vy(r.avgF)] as [number, number]);
  const halo = `paint-order="stroke" stroke="#101a24" stroke-width="3"`;
  const markers = rows
    .map(
      (r, i) =>
        `<circle cx="${avgPts[i][0].toFixed(1)}" cy="${avgPts[i][1].toFixed(1)}" r="4" fill="#d95926" stroke="#101a24" stroke-width="2"><title>${r.label} · avg ${r.avgF}°F (normal ${r.normalF}°F)</title></circle>`,
    )
    .join("");
  const endLabels =
    `<text x="${avgPts[0][0].toFixed(1)}" y="${(avgPts[0][1] - 8).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="#e7edf3" ${halo}>${Math.round(rows[0].avgF)}°</text>` +
    (n > 1
      ? `<text x="${avgPts[n - 1][0].toFixed(1)}" y="${(avgPts[n - 1][1] - 8).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="#e7edf3" ${halo}>${Math.round(rows[n - 1].avgF)}°</text>`
      : "");

  const monthLabels = rows
    .map(
      (r, i) =>
        `<text x="${cx(i).toFixed(1)}" y="128" text-anchor="middle" font-size="8.5" fill="#9db0c0">${r.label}</text>`,
    )
    .join("");

  const drop = `<svg width="10" height="10" viewBox="0 0 24 24"><path d="M12 3c3 4.4 6 7.4 6 10.4a6 6 0 1 1-12 0C6 10.4 9 7.4 12 3z" fill="#6da7ec"/></svg>`;
  const dry = `<svg width="10" height="10" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" fill="#d95926"/><g stroke="#d95926" stroke-width="1.7" stroke-linecap="round"><line x1="12" y1="3" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="21"/><line x1="3" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="21" y2="12"/></g></svg>`;
  const chips = rows
    .map((r) => {
      const g = r.precip === "wetter" ? drop : r.precip === "drier" ? dry : "";
      const word = r.precip === "wetter" ? "wet" : r.precip === "drier" ? "dry" : "–";
      return `<div class="chip p-${r.precip}"><span class="m">${r.label}</span>${g}<span class="w">${word}</span></div>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>${WIDGET_CSS}
  #chips { display:flex; gap:${n > 8 ? 2 : 4}px; margin-top:6px; }
  .chip { flex:1; min-width:0; display:flex; align-items:center; justify-content:center;
          gap:3px; background:#16222e; border:1px solid #223140; border-radius:7px;
          padding:3px 2px; font-size:${n > 8 ? 8 : 9}px; color:#9db0c0; }
  .chip .m { font-weight:700; color:#c6d3de; }
  .chip.p-normal { opacity:.75; }
  #sentence { margin-top:7px; font-size:10.5px; font-style:italic; color:#9db0c0;
              line-height:1.35; }
  </style></head><body>
  <div id="titlebar">
    <div id="title">METEORA <span>· ${n}-month outlook — ${esc(location)}</span></div>
    <div id="legend"><span><i style="background:#d95926"></i>monthly avg</span><span><i style="background:#2a3742; border-radius:2px"></i>normal band</span></div>
  </div>
  <svg width="${W}" height="134" viewBox="0 0 ${W} 134">
    ${grid}
    ${bandD ? `<path d="${bandD}" fill="#22303c"/>` : ""}
    ${n > 1 ? `<path d="${smoothPath(avgPts)}" fill="none" stroke="#d95926" stroke-width="2" stroke-linecap="round"/>` : ""}
    ${markers}${endLabels}${monthLabels}
  </svg>
  <div id="chips">${chips}</div>
  <div id="sentence">${esc(outlookSentence(location, rows))}</div>
  </body></html>`;
}

// ── protocol plumbing ───────────────────────────────────────────────────────

const agentCard = {
  protocolVersion: "0.2.5",
  name: "Meteora",
  description: "A long-range forecaster fluent in seasons, not just weekends.",
  version: "1.0.0",
  url: `http://localhost:${port}/a2a`,
  capabilities: { streaming: false, pushNotifications: false },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [
    {
      id: "forecast",
      name: "Forecast",
      description: "Daily forecasts up to 14 days and climate outlooks up to 12 months.",
      tags: ["demo", "weather"],
    },
  ],
};

/** Pull a location out of free text, loosely. */
function parseLocation(text: string): string {
  const m = text.match(/(?:in|for|at|near)\s+([A-Z][\w'.-]*(?:[ ,]+[A-Z][\w'.-]*)*)/);
  if (m) return m[1].replace(/[?.!,]+$/, "").trim();
  return DEFAULT_LOCATION;
}

function sevenDaySummary(location: string): string {
  const days = forecast(location, 7);
  const lines = days
    .map((d, i) => `${i === 0 ? "Today" : d.weekday} ${d.hi}/${d.lo} ${d.condition}${d.precip >= 50 ? ` (${d.precip}% precip)` : ""}`)
    .join(", ");
  const warmest = days.reduce((b, d) => (d.hi > b.hi ? d : b));
  return `Meteora 7-day for ${location}: ${lines}. Warmest ${warmest.weekday} at ${warmest.hi}°F.`;
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
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id ?? null,
          result: {
            kind: "message",
            messageId: randomUUID(),
            role: "agent",
            parts: [{ kind: "text", text: sevenDaySummary(parseLocation(asked)) }],
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
      const mcp = new McpServer({ name: "meteora", version: "1.0.0" });
      mcp.registerTool(
        "get_forecast",
        {
          description:
            "Daily weather forecast for a location, 1–14 days out (default 7). Returns JSON (hi/lo °F, precip %, condition) plus a forecast-panel widget the client may render.",
          inputSchema: {
            location: z.string().min(1),
            days: z.number().int().min(1).max(14).optional(),
          },
        },
        async ({ location, days }) => {
          const n = days ?? 7;
          const rows = forecast(location, n);
          return {
            content: [
              { type: "text", text: JSON.stringify({ location, days: rows }) },
              {
                type: "resource",
                resource: {
                  uri: `ui://meteora/forecast/${randomUUID()}`,
                  mimeType: "text/html",
                  text: dailyWidgetHtml(location, rows),
                },
              },
            ],
          };
        },
      );
      mcp.registerTool(
        "get_climate_outlook",
        {
          description:
            "Long-range monthly climate outlook for a location, 1–12 months out (default 6). Returns JSON (monthly avg vs normal °F, wetter/drier lean) plus an outlook widget the client may render.",
          inputSchema: {
            location: z.string().min(1),
            months: z.number().int().min(1).max(12).optional(),
          },
        },
        async ({ location, months }) => {
          const rows = climateOutlook(location, months ?? 6);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  location,
                  months: rows,
                  outlook: outlookSentence(location, rows),
                }),
              },
              {
                type: "resource",
                resource: {
                  uri: `ui://meteora/outlook/${randomUUID()}`,
                  mimeType: "text/html",
                  text: climateWidgetHtml(location, rows),
                },
              },
            ],
          };
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
  console.log(`meteora demo: http://localhost:${port}`);
  console.log(`  MCP:      http://localhost:${port}/mcp`);
  console.log(`  A2A card: http://localhost:${port}/.well-known/agent-card.json`);
});
