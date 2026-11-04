import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { FileTaskStore } from "@umwelten/protocols";
import { TaskState } from "@a2a-js/sdk";
import {
  collectOperationalTelemetry,
  fetchOperationsJson,
} from "./operational-telemetry.js";
import { habitatTaskDir } from "./a2a-handler.js";
import {
  startContainerServer,
  type StartedContainerServer,
} from "./container-server.js";
import type { Habitat } from "./habitat.js";
import { handleGaiaRoute, type GaiaRouteContext } from "./tools/gaia/routes.js";

const dirs: string[] = [];
let child: StartedContainerServer | undefined;
afterEach(async () => {
  child?.close();
  child = undefined;
  vi.unstubAllEnvs();
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "telemetry-"));
  dirs.push(dir);
  return dir;
}

describe("operational metadata boundary", () => {
  it("counts working versus waiting tasks and recent completions without emitting private fields", async () => {
    const dir = await directory();
    const completions = join(dir, "completions");
    await mkdir(completions);
    const store = new FileTaskStore({ dir: habitatTaskDir(dir) });
    for (const [id, state] of [
      ["private-working", TaskState.TASK_STATE_WORKING],
      ["private-waiting", TaskState.TASK_STATE_AUTH_REQUIRED],
    ] as const) {
      await store.save({
        id,
        contextId: "private-session",
        status: {
          state,
          timestamp: "2026-11-04T10:00:00.000Z",
          message: undefined,
        },
        history: [],
        artifacts: [],
        metadata: undefined,
      });
    }
    const record = {
      kind: "llm",
      endedAt: "2026-11-04T11:55:00.000Z",
      outcome: "error",
      durationMs: 120001,
      tokens: { total: 71 },
      cost: { total: 0.03 },
      error: "private-token",
      usageRaw: { client: "private-finances" },
    };
    await writeFile(
      join(completions, "2026-11-04.jsonl"),
      [record, { ...record, endedAt: "2026-11-04T11:44:59.999Z" }]
        .map((r) => JSON.stringify(r))
        .join("\n"),
    );
    const report = await collectOperationalTelemetry({
      workDir: dir,
      configurationReady: false,
      completionsDir: completions,
      now: Date.parse("2026-11-04T12:00:00Z"),
    });
    expect(report.tasks).toEqual({
      active: 1,
      waiting: 1,
      oldestActiveAt: "2026-11-04T10:00:00.000Z",
    });
    expect(report.executions).toEqual({
      count: 1,
      errors: 1,
      slow: 1,
      tokens: 71,
      cost: 0.03,
      available: true,
      truncated: false,
    });
    expect(JSON.stringify(report)).not.toContain("private-");
    await writeFile(join(habitatTaskDir(dir), "broken.task.json"), "not json");
    await expect(
      collectOperationalTelemetry({
        workDir: dir,
        configurationReady: true,
        completionsDir: completions,
      }),
    ).rejects.toThrow("Task inventory incomplete");
  });

  it("supports child JWT/service auth and authenticates the Gaia projection by child key, not query ID", async () => {
    const keyPair = await generateKeyPair("ES256");
    vi.stubEnv("HABITAT_API_KEY", "child-a-key");
    vi.stubEnv("HABITAT_AUTH_JWKS_URL", "");
    vi.stubEnv("HABITAT_AUTH_AUDIENCE", "https://child-a.example");
    vi.stubEnv("HABITAT_AUTH_ISSUER", "https://saas.example");
    vi.stubEnv("HABITAT_AUTH_PUBLIC_KEY", await exportSPKI(keyPair.publicKey));
    const ctx = {
      registry: {
        list: () => [
          { id: "a", apiKey: "child-a-key" },
          { id: "b", apiKey: "child-b-key" },
        ],
      },
      operations: {
        snapshot: (subject: string) => ({
          version: 1,
          observedAt: new Date().toISOString(),
          stale: false,
          conditions: [{ subject }],
        }),
      },
    } as unknown as GaiaRouteContext;
    const gaia = createServer((req, res) => {
      void handleGaiaRoute(ctx, req, res);
    });
    await new Promise<void>((r) => gaia.listen(0, "127.0.0.1", r));
    const gaiaUrl = `http://127.0.0.1:${(gaia.address() as AddressInfo).port}`;
    vi.stubEnv("GAIA_URL", gaiaUrl);
    try {
      const workDir = await directory();
      const habitat = {
        getConfig: () => ({ name: "test" }),
        getTools: () => ({}),
        getWorkDir: () => workDir,
        computeRequirements: async () => ({ aggregate: { envVars: [] } }),
      } as unknown as Habitat;
      child = await startContainerServer({
        habitat,
        port: 0,
        host: "127.0.0.1",
      });
      const url = `http://127.0.0.1:${child.port}/api/operations`;
      expect((await fetch(url)).status).toBe(401);
      const jwt = await new SignJWT({})
        .setProtectedHeader({ alg: "ES256" })
        .setSubject("user-a")
        .setIssuer("https://saas.example")
        .setAudience("https://child-a.example")
        .setExpirationTime("5m")
        .sign(keyPair.privateKey);
      for (const token of [jwt, "child-a-key"]) {
        const response = await fetch(url, {
          headers: { authorization: `Bearer ${token}` },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toMatchObject({
          conditions: [{ subject: "a" }],
        });
      }
      const projection = await fetchOperationsJson(
        `${gaiaUrl}/internal/operations/status?id=b`,
        "child-a-key",
      );
      expect(projection).toMatchObject({ conditions: [{ subject: "a" }] });
      expect(
        (await fetch(`${gaiaUrl}/internal/operations/status`)).status,
      ).toBe(401);
      expect(
        (
          await fetch(
            `http://127.0.0.1:${child.port}/internal/operations/telemetry`,
            { headers: { authorization: `Bearer ${jwt}` } },
          )
        ).status,
      ).toBe(401);
      expect((await fetch(`${gaiaUrl}/health/operations`)).status).toBe(200);
      ctx.operations = undefined;
      const watchdog = await fetch(`${gaiaUrl}/health/operations`);
      expect(watchdog.status).toBe(503);
      expect(await watchdog.json()).toEqual({ status: "stale" });
      expect(
        (await fetch(url, { headers: { authorization: "Bearer child-a-key" } }))
          .status,
      ).toBe(503);
      const telemetry = await fetchOperationsJson(
        `http://127.0.0.1:${child.port}/internal/operations/telemetry`,
        "child-a-key",
      );
      expect(telemetry).toMatchObject({
        runtimeErrors: 1,
        tasks: { active: 0 },
      });
    } finally {
      await new Promise<void>((r) => gaia.close(() => r()));
    }
  });
});
