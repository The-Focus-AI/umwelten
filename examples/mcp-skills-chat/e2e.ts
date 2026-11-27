/**
 * End-to-end check of the MCP skills chat example on one host, three processes' worth:
 * skill server (MCP 2026-07-28 + Skills ext) ← agent (DurableHabitat, A2A + host API) ← chat UI (web client).
 *
 *   pnpm tsx examples/mcp-skills-chat/e2e.ts
 *
 * Covers: connect by URL, tool + skill discovery with origin, the agent's A2A card
 * never advertising skills it loaded, lazy load parked on approval, origin-tagged skill content,
 * skill_read of a manifest file, code-execution gate while a skill is active,
 * manifest change revoking approval, and a declined load.
 */

import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startAgent } from "./agent.js";
import { startChatUi } from "./chat-ui.js";
import { startSkillServer } from "./skill-server.js";

type State = {
  servers: Array<{ label: string; kind: string; protocolVersion?: string; tools: Array<{ name: string }>; skills: Array<{ qualifiedName: string; approved: boolean; active: boolean; ignoredFields: string[] }>; a2aSkills: Array<{ id?: string; name: string }> }>;
  pending: Array<{ key: string; kind: string; toolName?: string; skill?: { qualifiedName: string; manifestHash: string } }>;
  active: Array<{ qualifiedName: string }>;
  messages: Array<{ role: string; text: string; toolName?: string; isError?: boolean; ui?: Array<{ uri: string; text?: string }> }>;
  busy: boolean;
};

const skillsDir = await mkdtemp(join(tmpdir(), "umwelten-skills-"));
await cp(fileURLToPath(new URL("./skills", import.meta.url)), skillsDir, { recursive: true });
const skills = await startSkillServer({ port: 0, skillsDir, watch: false });
const agent = await startAgent({ port: 0, bash: true });
const chat = await startChatUi({ port: 0, agentUrl: agent.url });

async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(chat.url + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error);
  return json;
}
const state = () => api<State>("/api/state");
async function until(pred: (s: State) => boolean, what: string): Promise<State> {
  const start = Date.now();
  for (;;) {
    const s = await state();
    if (pred(s)) return s;
    if (Date.now() - start > 10_000) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(s.pending)} busy=${s.busy}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
const step = (name: string) => console.log(`✓ ${name}`);

try {
  await api("/api/servers", { url: skills.mcpUrl, label: "examples" });
  let s = await state();
  const mcp = s.servers.find((x) => x.label === "examples")!;
  assert.equal(mcp.kind, "mcp");
  assert.equal(mcp.protocolVersion, "2026-07-28");
  assert.deepEqual(mcp.tools.map((t) => t.name).sort(), ["get_time", "service_status"]);
  assert.deepEqual(mcp.skills.map((k) => k.qualifiedName), ["examples/haiku", "examples/incident-triage", "examples/release-notes"]);
  assert.deepEqual(mcp.skills.find((k) => k.qualifiedName === "examples/incident-triage")!.ignoredFields, ["allowed-tools"]);
  step("connected MCP server: 2026-07-28, 2 tools, 3 skills with origin");

  await api("/api/chat", { text: "Draft release notes for: faster CSV export, fixed login timeout" });
  s = await until((x) => x.pending.some((p) => p.kind === "skill-load"), "skill-load approval");
  const ask = s.pending[0]!;
  assert.equal(ask.skill!.qualifiedName, "examples/release-notes");
  assert.ok(!s.messages.some((m) => m.text.includes("Group the changes")), "skill content must not be fetched before approval");
  step("model asked to load examples/release-notes; parked on approval, nothing read yet");
  await api(`/api/approvals/${encodeURIComponent(ask.key)}`, { allow: true });
  s = await until((x) => !x.busy && x.messages.at(-1)?.role === "assistant", "answer");
  const load = s.messages.find((m) => m.toolName === "skill_load")!;
  assert.match(load.text, /^<mcp-skill origin="mcp:examples" name="release-notes"/);
  assert.ok(s.messages.some((m) => m.toolName === "skill_read" && m.text.includes("Lead with the benefit")));
  assert.deepEqual(s.active.map((a) => a.qualifiedName), ["examples/release-notes"]);
  step("approved: origin-tagged SKILL.md + references/STYLE.md read; skill active");
  const card = (await (await fetch(`${agent.url}/.well-known/agent-card.json`)).json()) as { skills: Array<{ id: string }> };
  assert.ok(card.skills.length > 0 && !card.skills.some((k) => k.id.startsWith("mcp-skill:")));
  step("agent's A2A card does not advertise the MCP skill it loaded");

  await api("/api/chat", { text: "We have an incident, please triage it" });
  s = await until((x) => x.pending.some((p) => p.kind === "skill-load"), "triage approval");
  await api(`/api/approvals/${encodeURIComponent(s.pending[0]!.key)}`, { allow: true });
  s = await until((x) => x.pending.some((p) => p.kind === "code-execution"), "bash gate");
  assert.equal(s.pending[0]!.toolName, "bash");
  step("bash call parked on per-call approval while MCP skills are active");
  await api(`/api/approvals/${encodeURIComponent(s.pending[0]!.key)}`, { allow: false });
  s = await until((x) => !x.busy && x.messages.at(-1)?.role === "assistant", "answer after deny");
  assert.ok(s.messages.some((m) => m.toolName === "bash" && m.isError));
  step("denied bash call was blocked");

  await writeFile(join(skillsDir, "release-notes/references/STYLE.md"), "# House style\n\n- Changed.\n");
  await skills.reload();
  await api("/api/servers/examples/refresh", {});
  s = await state();
  assert.equal(s.servers[0]!.skills.find((k) => k.qualifiedName === "examples/release-notes")!.approved, false);
  step("server-side manifest change revoked the release-notes approval");
  await api("/api/chat", { text: "Release notes again: new dark mode" });
  s = await until((x) => x.pending.some((p) => p.kind === "skill-load"), "re-approval");
  assert.notEqual(s.pending[0]!.skill!.manifestHash, ask.skill!.manifestHash);
  await api(`/api/approvals/${encodeURIComponent(s.pending[0]!.key)}`, { allow: false });
  s = await until((x) => !x.busy && x.messages.at(-1)?.role === "assistant", "declined answer");
  assert.match(s.messages.at(-1)!.text, /declined/);
  step("re-approval asked for the new manifest; decline blocked the load");

  await api("/api/chat/new", {});
  assert.deepEqual((await state()).messages, []);
  await api("/api/chat", { text: "api status?" });
  s = await until((x) => !x.busy && x.messages.at(-1)?.role === "assistant", "status answer");
  const status = [...s.messages].reverse().find((m) => m.toolName === "mcp__examples__service_status")!;
  assert.equal(status.ui?.[0]?.uri, "ui://service-status/api");
  assert.ok(!status.text.includes("<"), "the ui:// HTML must stay out of the model's tool result");
  step("new chat; tool's ui:// resource reached the chat UI, not the model");
  console.log("\nmcp-skills-chat e2e: all checks passed");
} finally {
  await chat.close();
  await agent.close();
  await skills.close();
  await rm(skillsDir, { recursive: true, force: true });
}
