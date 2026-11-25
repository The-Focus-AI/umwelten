import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { CodingSessionEvent, CodingSessionRecord } from "@umwelten/evaluation";
import { saveSingleRecordToCodingReport } from "../../../../examples/coding-bench/report-store.js";
import { loadCodingFixtures } from "../../../../examples/coding-bench/tasks.js";
import {
  createBenchUiServer,
  type BenchUiServerHandle,
} from "../../../../scripts/bench-ui-server.js";

async function readSseUntilGraded(
  url: string,
  timeoutMs: number = 15_000,
): Promise<CodingSessionEvent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const collected: CodingSessionEvent[] = [];

  try {
    const res = await fetch(url, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    if (!res.body) throw new Error("Missing SSE response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const ev = JSON.parse(line.slice(6)) as CodingSessionEvent;
          collected.push(ev);
          if (ev.type === "graded" && ev.isInitialEval) {
            return collected;
          }
          if (ev.type === "status" && ev.status === "error") {
            throw new Error(`Session errored during SSE stream: ${ev.error}`);
          }
        }
      }
    }
    return collected;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

describe("Bench UI Workbench Server (HTTP + SSE)", () => {
  let srv: BenchUiServerHandle | undefined;
  const tempDirs: string[] = [];

  afterAll(async () => {
    if (srv) await srv.close();
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves workbench UI + catalog, streams mock coding session over SSE, supports follow-up chat, re-grade, and delete", async () => {
    srv = await createBenchUiServer({ port: 0 });
    expect(srv.host).toBe("127.0.0.1");
    expect(srv.port).toBeGreaterThan(0);

    // GET /
    const htmlRes = await fetch(`${srv.url}/`);
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers.get("content-type")).toContain("text/html");
    const html = await htmlRes.text();
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    expect(scriptMatch).toBeTruthy();
    // Ensure client JS has zero syntax errors
    new Function(scriptMatch![1]);

    // GET /styles/labs.css
    const cssRes = await fetch(`${srv.url}/styles/labs.css`);
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get("content-type")).toContain("text/css");

    // GET /api/catalog
    const catRes = await fetch(`${srv.url}/api/catalog`);
    expect(catRes.status).toBe(200);
    const catalog = (await catRes.json()) as {
      models: Array<{ provider: string; name: string }>;
      tasks: Array<{ id: string }>;
      extensions: string[];
    };
    expect(catalog.models.length).toBeGreaterThan(0);
    expect(catalog.tasks).toHaveLength(6);
    expect(catalog.extensions).toContain("pi-default");

    // POST /api/sessions
    const launchRes = await fetch(`${srv.url}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: ["anthropic:claude-fable-5-2"],
        efforts: ["high"],
        tasks: ["01-ledger-rounding"],
        extensions: ["pi-default"],
        mode: "mock",
      }),
    });
    expect(launchRes.status).toBe(201);
    const launched = (await launchRes.json()) as {
      sessions: Array<{ id: string; taskId: string }>;
    };
    expect(launched.sessions).toHaveLength(1);
    const sid = launched.sessions[0].id;

    // GET /api/sessions/:id/events SSE
    const events = await readSseUntilGraded(`${srv.url}/api/sessions/${sid}/events`);
    const types = new Set(events.map((e) => e.type));
    expect(types.has("session_started")).toBe(true);
    expect(types.has("turn_start")).toBe(true);
    expect(types.has("tool_start")).toBe(true);
    expect(types.has("tool_end")).toBe(true);
    const gradedEv = events.find(
      (e): e is Extract<CodingSessionEvent, { type: "graded" }> =>
        e.type === "graded" && e.isInitialEval,
    );
    expect(gradedEv).toBeDefined();
    expect(gradedEv!.record.passed).toBe(true);
    expect(gradedEv!.record.score).toBe(10);

    // Wait briefly for runInitialEval() post-emit status ("ready")
    let snapStatus = "";
    for (let i = 0; i < 20; i++) {
      const snapRes = await fetch(`${srv.url}/api/sessions/${sid}`);
      expect(snapRes.status).toBe(200);
      const snap = (await snapRes.json()) as {
        status: string;
        diff: { changedFiles: string[] } | null;
      };
      snapStatus = snap.status;
      if (snapStatus === "ready") {
        expect(snap.diff?.changedFiles).toContain("src/money.ts");
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(snapStatus).toBe("ready");

    // POST /api/sessions/:id/chat
    const chatRes = await fetch(`${srv.url}/api/sessions/${sid}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "What files did you change?" }),
    });
    expect(chatRes.status).toBe(200);
    const chatData = (await chatRes.json()) as {
      result: { replyText: string; turns: number };
    };
    expect(chatData.result.turns).toBeGreaterThanOrEqual(1);
    expect(chatData.result.replyText.length).toBeGreaterThan(0);

    // POST /api/sessions/:id/grade
    const gradeRes = await fetch(`${srv.url}/api/sessions/${sid}/grade`, {
      method: "POST",
    });
    expect(gradeRes.status).toBe(200);
    const gradeData = (await gradeRes.json()) as { record: CodingSessionRecord };
    expect(gradeData.record.passed).toBe(true);

    // DELETE /api/sessions/:id
    const delRes = await fetch(`${srv.url}/api/sessions/${sid}`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);

    const afterDel = await fetch(`${srv.url}/api/sessions/${sid}`);
    expect(afterDel.status).toBe(404);
  }, 30_000);

  it("saveSingleRecordToCodingReport creates and merges task rows in an isolated temp rootDir", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "umwelten-report-store-"));
    tempDirs.push(tmpRoot);

    const tasks = loadCodingFixtures();
    const baseRecord = (taskId: string, passed: boolean, score: number): CodingSessionRecord => ({
      taskId,
      title: taskId,
      difficulty: "easy",
      language: "typescript",
      model: "claude-fable-5-2",
      provider: "anthropic",
      reasoningEffort: "high",
      effectiveThinkingLevel: "high",
      extensionProfile: "pi-default",
      taskHash: `hash-${taskId}`,
      cacheKey: `cache-${taskId}`,
      generatedAt: new Date().toISOString(),
      passed,
      score,
      maxScore: 10,
      details: "ok",
      visibleTests: { passed: 1, failed: 0, total: 1 },
      hiddenTests: { passed: passed ? 5 : 0, failed: passed ? 0 : 5, total: 5 },
      cheatedProtectedFiles: false,
      stopReason: "completed",
      durationMs: 1200,
      turns: 4,
      toolCallsTotal: 6,
      toolCallsByName: { read: 1, write: 4, bash: 1 },
      toolErrors: 0,
      costUsd: 0.03,
      tokenUsage: {
        prompt: 1000,
        completion: 500,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 200,
        total: 1700,
      },
      changedFiles: ["src/money.ts"],
      gitDiffStat: "src/money.ts | 5 ++---",
      cached: false,
    });

    const first = saveSingleRecordToCodingReport({
      record: baseRecord("01-ledger-rounding", true, 10),
      mode: "mock",
      rootDir: tmpRoot,
      allTasks: tasks,
    });
    expect(fs.existsSync(first.outPath)).toBe(true);
    expect(first.payload.models).toHaveLength(1);
    expect(first.payload.models[0].passedTasks).toBe(1);
    expect(first.payload.models[0].totalTasks).toBe(1);

    const second = saveSingleRecordToCodingReport({
      record: baseRecord("02-cron-dst-scheduler", false, 4),
      mode: "mock",
      rootDir: tmpRoot,
      allTasks: tasks,
    });
    expect(second.payload.models).toHaveLength(1);
    expect(second.payload.models[0].totalTasks).toBe(2);
    expect(second.payload.models[0].passedTasks).toBe(1);
    expect(second.payload.models[0].taskResults.map((t) => t.taskId).sort()).toEqual([
      "01-ledger-rounding",
      "02-cron-dst-scheduler",
    ]);
  });
});
