import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../../../../deploy/gaia/redeploy.sh", import.meta.url),
);
const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function redeploy(overrides: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gaia-redeploy-"));
  directories.push(dir);
  const log = join(dir, "calls.jsonl");
  const envFile = join(dir, "env");
  writeFileSync(
    envFile,
    "GAIA_HOSTNAME=gaia.example\nGAIA_API_KEY=fixture-service-key\nGAIA_INGRESS_NETWORK=\nGAIA_PREVIEW_WAKE_KEY=\nGAIA_PREVIEW_ACTIVITY_KEY=\n",
  );
  writeFileSync(log, "");
  // Run the real deploy script against fake CLIs, never Docker or the network.
  writeFileSync(
    join(dir, "docker"),
    `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const { basename } = require('node:path');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const command = basename(process.argv[1]);
appendFileSync(process.env.TEST_LOG, JSON.stringify([command, ...args]) + '\\n');
if (command === 'curl') process.exit(0);
if (args[0] === 'image') process.exit(process.env.TEST_NO_CACHE === '1' ? 1 : 0);
if (args[0] === 'build' && args.includes('habitat-coding') && process.env.TEST_BUILD_FAIL === '1') process.exit(1);
if (args[0] === 'run' && process.env.TEST_BOOT_FAIL === '1') process.exit(1);
if (args[0] === 'ps') console.log('gaia-cornwall-market');
if (args[0] === 'exec') {
  const probe = \
    "globalThis.fetch = async (url, options) => {" +
    "if (url !== 'http://127.0.0.1:8080/shell/' || options.headers.Accept !== 'text/html' || options.redirect !== 'manual' || options.headers.Authorization) throw new Error('bad browser probe');" +
    "return new Response(null, {status: Number(process.env.TEST_LOGIN_STATUS), headers: {location: process.env.TEST_LOCATION}}); };";
  const result = spawnSync(process.execPath, ['-e', probe + args.at(-1)], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
`,
    { mode: 0o755 },
  );
  symlinkSync(join(dir, "docker"), join(dir, "curl"));
  let error: unknown;
  try {
    execFileSync("bash", [script], {
      encoding: "utf8",
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        GAIA_ENV_FILE: envFile,
        GITHUB_TOKEN: "",
        TEST_LOG: log,
        TEST_NO_CACHE: "0",
        TEST_BUILD_FAIL: "0",
        TEST_BOOT_FAIL: "0",
        HABITAT_ID: "cornwall-market",
        HABITAT_API_KEY: "fixture-key",
        HABITAT_AUTH_AUDIENCE: "https://cornwall.example",
        HABITAT_AUTH_ISSUER: "https://habitats.example",
        HABITAT_AUTH_JWKS_URL: "https://habitats.example/.well-known/jwks.json",
        PORT: "8080",
        TEST_LOGIN_STATUS: "303",
        TEST_LOCATION:
          "https://habitats.example/auth/handoff?habitat_id=cornwall-market&return_to=%2Fshell%2F",
        ...overrides,
      },
    });
  } catch (caught) {
    error = caught;
  }
  const calls = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
  return { calls, error };
}

describe("Gaia redeploy", () => {
  it("rebuilds both derived images before any restart and verifies browser login", () => {
    const { calls, error } = redeploy();
    expect(error).toBeUndefined();
    const builds = calls.filter((call) => call[1] === "build");
    expect(builds.map((call) => call[call.indexOf("-t") + 1])).toEqual([
      "habitat",
      "twitter-habitat",
      "habitat-coding",
    ]);
    expect(builds[2]).toContain(
      "standards=docker-image://habitat-coding:latest",
    );
    expect(calls.indexOf(builds[2])).toBeLessThan(
      calls.findIndex((call) => call[1] === "compose"),
    );
    expect(
      calls.some(
        (call) => call[1] === "exec" && call[2] === "gaia-cornwall-market",
      ),
    ).toBe(true);
  });

  it("uses only the secret reference for an explicitly supplied standards credential", () => {
    const { calls, error } = redeploy({
      GITHUB_TOKEN: "fixture-github-secret",
      TEST_NO_CACHE: "1",
    });
    expect(error).toBeUndefined();
    const build = calls.find(
      (call) => call[1] === "build" && call.includes("habitat-coding"),
    )!;
    expect(build).toContain("id=gh_token,env=GITHUB_TOKEN");
    expect(JSON.stringify(calls)).not.toContain("fixture-github-secret");
  });

  it.each([
    { TEST_NO_CACHE: "1" },
    { TEST_BUILD_FAIL: "1" },
    { TEST_BOOT_FAIL: "1" },
  ])(
    "does not restart anything after a missing corpus, failed build, or non-root preflight: %j",
    (override) => {
      const { calls, error } = redeploy(override);
      expect(error).toBeDefined();
      expect(
        calls.some((call) => call[1] === "compose" || call[0] === "curl"),
      ).toBe(false);
    },
  );

  it.each([
    { TEST_LOGIN_STATUS: "200" },
    { TEST_LOGIN_STATUS: "404" },
    {
      TEST_LOCATION:
        "https://evil.example/auth/handoff?habitat_id=cornwall-market",
    },
    {
      TEST_LOCATION: "https://habitats.example/auth/handoff?habitat_id=twitter",
    },
  ])(
    "fails a healthy but stale or misdirected browser login: %j",
    (override) => {
      expect(redeploy(override).error).toBeDefined();
    },
  );

  it("keeps unconfigured legacy hosts usable", () => {
    expect(
      redeploy({ HABITAT_AUTH_AUDIENCE: "", TEST_LOGIN_STATUS: "200" }).error,
    ).toBeUndefined();
  });
});
