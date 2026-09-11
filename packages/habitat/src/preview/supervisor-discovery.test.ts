import { describe, expect, it, vi } from "vitest";
import { readFile, readdir, readlink } from "node:fs/promises";
import { discoverProcessTreePorts } from "./supervisor.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  readlink: vi.fn(),
}));

describe("Linux preview process discovery", () => {
  it("finds worker-thread children, deduplicates them, and tolerates exiting threads and descriptors", async () => {
    const directories: Record<string, string[]> = {
      "/proc/100/task": ["100", "101", "102", "103"],
      "/proc/200/task": ["200"],
      "/proc/100/fd": [],
      "/proc/200/fd": ["7", "8"],
    };
    vi.mocked(readdir).mockImplementation(async (path) => {
      if (!(String(path) in directories)) throw new Error("process exited");
      return directories[String(path)] as never;
    });
    vi.mocked(readFile).mockImplementation(async (path) => {
      if (String(path) === "/proc/100/task/101/children")
        throw new Error("thread exited");
      if (
        ["/proc/100/task/102/children", "/proc/100/task/103/children"].includes(
          String(path),
        )
      )
        return "200 300";
      if (String(path) === "/proc/net/tcp")
        return "  sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n   0: 00000000:1F91 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 12345\n";
      return "";
    });
    vi.mocked(readlink).mockImplementation(async (path) => {
      if (String(path).endsWith("/8")) throw new Error("descriptor exited");
      return "socket:[12345]";
    });

    expect(await discoverProcessTreePorts(100)).toEqual([
      { port: 8081, loopbackOnly: false },
    ]);
    expect(
      vi
        .mocked(readdir)
        .mock.calls.filter(([path]) => path === "/proc/200/task"),
    ).toHaveLength(1);
    expect(
      vi
        .mocked(readdir)
        .mock.calls.filter(([path]) => path === "/proc/300/task"),
    ).toHaveLength(1);
  });
});
