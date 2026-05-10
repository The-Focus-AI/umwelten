import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InlineVault, HabitatVault, OnePasswordVault } from "./vault.js";

describe("InlineVault", () => {
  let dir: string;
  let vault: InlineVault;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "inline-vault-"));
    vault = new InlineVault(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns undefined when secrets file does not exist", async () => {
    expect(await vault.resolve("ANY")).toBeUndefined();
    expect(await vault.list()).toEqual([]);
  });

  it("persists secrets to disk and reads them back", async () => {
    await vault.set("API_KEY", "abc-123");
    expect(await vault.resolve("API_KEY")).toBe("abc-123");
    expect(await vault.list()).toEqual(["API_KEY"]);

    const v2 = new InlineVault(dir);
    expect(await v2.resolve("API_KEY")).toBe("abc-123");
  });

  it("writes secrets file with mode 0600", async () => {
    await vault.set("X", "1");
    const s = await stat(join(dir, "secrets.json"));
    // Mask the perm bits and compare to 0o600.
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("removes secrets", async () => {
    await vault.set("A", "1");
    await vault.set("B", "2");
    await vault.remove("A");
    expect(await vault.resolve("A")).toBeUndefined();
    expect(await vault.resolve("B")).toBe("2");
  });

  it("tolerates malformed json", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "secrets.json"), "{not json}");
    expect(await vault.resolve("X")).toBeUndefined();
  });
});

describe("HabitatVault", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "habitat-vault-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("falls back to process.env when secrets.json is missing", async () => {
    const original = process.env.TEST_HABITAT_VAULT_FALLBACK;
    process.env.TEST_HABITAT_VAULT_FALLBACK = "from-env";
    try {
      const vault = new HabitatVault(workDir);
      expect(await vault.resolve("TEST_HABITAT_VAULT_FALLBACK")).toBe("from-env");
    } finally {
      if (original === undefined) delete process.env.TEST_HABITAT_VAULT_FALLBACK;
      else process.env.TEST_HABITAT_VAULT_FALLBACK = original;
    }
  });

  it("prefers /data/secrets.json over process.env", async () => {
    await writeFile(join(workDir, "secrets.json"), JSON.stringify({ FOO: "from-file" }));
    process.env.FOO = "from-env";
    try {
      const vault = new HabitatVault(workDir);
      expect(await vault.resolve("FOO")).toBe("from-file");
    } finally {
      delete process.env.FOO;
    }
  });
});

describe("OnePasswordVault", () => {
  it("returns undefined for every lookup (stub)", async () => {
    const v = new OnePasswordVault("op://Vault/Item");
    expect(await v.resolve("ANY")).toBeUndefined();
  });
});
