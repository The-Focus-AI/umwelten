/**
 * What survives a restart.
 *
 * Against a real temporary directory rather than a mocked filesystem — file
 * modes and rename-over-existing are exactly the parts a mock would get right
 * by assumption.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  STATE_VERSION,
  clearRuntimePid,
  loadConfig,
  loadCredential,
  loadState,
  reapOrphanedRuntime,
  recordRuntimePid,
  saveConfig,
  saveCredential,
  saveState,
  supplierDir,
  type PersistedConfig,
} from "./state.js";

const CONFIG: PersistedConfig = {
  exchangeUrl: "https://exchange.example",
  guarantees: ["on-premise"],
  servingMode: "managed",
  managed: {
    models: ["gemma-4-26b"],
    contextTokens: 32_768,
    parallel: 4,
    port: 7439,
    configPath: "/tmp/llama-swap.yaml",
  },
};

let dir: string;
let savedEnv: string | undefined;
let savedCredentialEnv: string | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "umwelten-supplier-"));
  savedEnv = process.env.UMWELTEN_SUPPLIER_DIR;
  savedCredentialEnv = process.env.SUPPLIER_CREDENTIAL;
  process.env.UMWELTEN_SUPPLIER_DIR = dir;
  delete process.env.SUPPLIER_CREDENTIAL;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.UMWELTEN_SUPPLIER_DIR;
  else process.env.UMWELTEN_SUPPLIER_DIR = savedEnv;
  if (savedCredentialEnv !== undefined) process.env.SUPPLIER_CREDENTIAL = savedCredentialEnv;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("configuration", () => {
  it("round-trips what a restart needs", () => {
    saveConfig(CONFIG);
    const loaded = loadConfig();
    expect(loaded?.exchangeUrl).toBe("https://exchange.example");
    expect(loaded?.managed?.contextTokens).toBe(32_768);
  });

  it("returns nothing rather than failing on a corrupt file", () => {
    // A corrupt state file must not stop an agent from starting. Missing,
    // unreadable and corrupt all mean the same thing to every caller: there is
    // nothing to resume from, so probe.
    fs.writeFileSync(path.join(dir, "config.json"), "{ not json");
    expect(loadConfig()).toBeUndefined();
  });
});

describe("the credential", () => {
  it("is never written into the config file", () => {
    // The config is the file an operator reads out loud, pastes into an issue,
    // and copies between machines.
    saveConfig(CONFIG);
    saveCredential("super-secret");
    expect(fs.readFileSync(path.join(dir, "config.json"), "utf8")).not.toContain("super-secret");
  });

  it("is stored readable only by its owner", () => {
    saveCredential("super-secret");
    const mode = fs.statSync(path.join(dir, "credential")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("stays 0600 when overwritten", () => {
    // A plain write over an existing file keeps its old mode, so a credential
    // written before this rule existed would stay world-readable forever.
    const file = path.join(dir, "credential");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, "old", { mode: 0o644 });

    saveCredential("new-secret");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("survives a restart without being re-entered", () => {
    saveCredential("super-secret");
    expect(loadCredential()).toBe("super-secret");
  });

  it("lets the environment win, so a container can inject one", () => {
    saveCredential("from-disk");
    process.env.SUPPLIER_CREDENTIAL = "from-env";
    expect(loadCredential()).toBe("from-env");
  });
});

describe("probe state", () => {
  it("round-trips a probe result", () => {
    saveState({
      version: STATE_VERSION,
      fingerprint: "abc123",
      probedAt: "2026-08-01T12:00:00Z",
      probed: [],
    });
    expect(loadState()?.fingerprint).toBe("abc123");
  });

  it("refuses a state file from a version it does not know", () => {
    // Probing again costs minutes; misreading a snapshot publishes a wrong
    // claim about a machine.
    saveState({
      version: STATE_VERSION + 1,
      fingerprint: "abc",
      probedAt: "2026-08-01T12:00:00Z",
      probed: [],
    });
    expect(loadState()).toBeUndefined();
  });

  it("leaves the previous file intact if a write is interrupted", () => {
    // Write-then-rename: a crash mid-write must not leave a truncated file
    // that the next start has to recover from.
    saveState({ version: STATE_VERSION, fingerprint: "first", probedAt: "2026-08-01T12:00:00Z", probed: [] });
    fs.writeFileSync(path.join(dir, "state.json.tmp"), "{ half written");
    expect(loadState()?.fingerprint).toBe("first");
  });
});

describe("reapOrphanedRuntime", () => {
  it("does nothing when no runtime was recorded", () => {
    expect(reapOrphanedRuntime()).toBeUndefined();
  });

  it("stops a runtime a previous run left behind", () => {
    // A power cut is not a shutdown we get to observe, and what it leaves is a
    // process holding the GPU that the next start cannot use and did not make.
    recordRuntimePid(4242);
    const killed: number[] = [];
    const note = reapOrphanedRuntime({ isAlive: () => true, kill: (pid) => killed.push(pid) });

    expect(killed).toEqual([4242]);
    expect(note).toMatch(/left behind by a previous run/);
    // And the record is cleared, so a second start does not chase a dead pid.
    expect(reapOrphanedRuntime({ isAlive: () => true, kill: () => {} })).toBeUndefined();
  });

  it("says nothing when the recorded process is already gone", () => {
    // The normal case after a clean shutdown that raced the pid file.
    recordRuntimePid(4242);
    expect(reapOrphanedRuntime({ isAlive: () => false, kill: () => {} })).toBeUndefined();
  });

  it("does not chase a pid that was never a process", () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "runtime.pid"), "not-a-pid");
    const killed: number[] = [];
    expect(reapOrphanedRuntime({ isAlive: () => true, kill: (p) => killed.push(p) })).toBeUndefined();
    expect(killed).toEqual([]);
  });

  it("clearing is safe when there is nothing to clear", () => {
    expect(() => clearRuntimePid()).not.toThrow();
  });
});

describe("supplierDir", () => {
  it("is overridable, so a test never writes to a real home directory", () => {
    expect(supplierDir()).toBe(dir);
  });
});
