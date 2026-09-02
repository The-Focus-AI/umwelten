import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseMeminfo, sampleHostResources } from "./host-resources.js";

let root: string | undefined;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("host resource sampling", () => {
  it("parses Linux meminfo values as bytes", () => {
    expect(
      parseMeminfo(
        "MemTotal:       8000000 kB\nMemAvailable:   500000 kB\nSwapTotal:      2000000 kB\nSwapFree:       1500000 kB\n",
      ),
    ).toEqual({
      totalBytes: 8_192_000_000,
      availableBytes: 512_000_000,
      swapTotalBytes: 2_048_000_000,
      swapFreeBytes: 1_536_000_000,
    });
  });

  it("rejects incomplete memory telemetry", () => {
    expect(() => parseMeminfo("MemTotal: 1000 kB\n")).toThrow(/MemAvailable/);
  });

  it("reports low-memory pressure and disk capacity", async () => {
    root = await mkdtemp(join(tmpdir(), "gaia-resources-"));
    const proc = join(root, "proc");
    await mkdir(proc);
    await writeFile(
      join(proc, "meminfo"),
      "MemTotal: 8000000 kB\nMemAvailable: 500000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n",
    );

    const snapshot = await sampleHostResources({
      procRoot: proc,
      diskPath: root,
      now: () => new Date("2026-09-02T17:00:00Z"),
    });
    expect(snapshot.observedAt).toBe("2026-09-02T17:00:00.000Z");
    expect(snapshot.memory.availableBytes).toBe(512_000_000);
    expect(snapshot.swap.totalBytes).toBe(0);
    expect(snapshot.disk.totalBytes).toBeGreaterThan(0);
    expect(snapshot.warnings).toContainEqual(expect.stringMatching(/memory.*below 1 GiB/i));
  });
});
