import { readFile, statfs } from "node:fs/promises";
import { join } from "node:path";

const GIB = 1024 ** 3;

export interface HostResourceSnapshot {
  observedAt: string;
  memory: {
    totalBytes: number;
    availableBytes: number;
    availablePercent: number;
  };
  swap: { totalBytes: number; freeBytes: number };
  disk: {
    path: string;
    totalBytes: number;
    availableBytes: number;
    usedPercent: number;
  };
  warnings: string[];
}

export type HostResourceStatus = HostResourceSnapshot | { error: string };

export function parseMeminfo(input: string): {
  totalBytes: number;
  availableBytes: number;
  swapTotalBytes: number;
  swapFreeBytes: number;
} {
  const values = new Map<string, number>();
  for (const line of input.split("\n")) {
    const match = /^(\w+):\s+(\d+)\s+kB$/.exec(line.trim());
    if (match) values.set(match[1], Number(match[2]) * 1024);
  }
  const totalBytes = values.get("MemTotal");
  const availableBytes = values.get("MemAvailable");
  if (totalBytes === undefined || availableBytes === undefined) {
    throw new Error("meminfo is missing MemTotal or MemAvailable");
  }
  return {
    totalBytes,
    availableBytes,
    swapTotalBytes: values.get("SwapTotal") ?? 0,
    swapFreeBytes: values.get("SwapFree") ?? 0,
  };
}

export async function sampleHostResources(options: {
  procRoot?: string;
  diskPath: string;
  now?: () => Date;
}): Promise<HostResourceSnapshot> {
  const procRoot = options.procRoot ?? process.env.GAIA_HOST_PROC ?? "/proc";
  const memory = parseMeminfo(
    await readFile(join(procRoot, "meminfo"), "utf8"),
  );
  const fs = await statfs(options.diskPath);
  const totalBytes = Number(fs.blocks) * Number(fs.bsize);
  const availableBytes = Number(fs.bavail) * Number(fs.bsize);
  const usedPercent = totalBytes
    ? ((totalBytes - availableBytes) / totalBytes) * 100
    : 0;
  const availablePercent = memory.totalBytes
    ? (memory.availableBytes / memory.totalBytes) * 100
    : 0;
  const warnings: string[] = [];
  if (memory.availableBytes < GIB) {
    warnings.push(
      `Host memory available is ${(memory.availableBytes / GIB).toFixed(2)} GiB (below 1 GiB)`,
    );
  }
  if (usedPercent > 90) {
    warnings.push(`Host disk use is ${usedPercent.toFixed(1)}% (above 90%)`);
  }

  return {
    observedAt: (options.now ?? (() => new Date()))().toISOString(),
    memory: {
      totalBytes: memory.totalBytes,
      availableBytes: memory.availableBytes,
      availablePercent,
    },
    swap: { totalBytes: memory.swapTotalBytes, freeBytes: memory.swapFreeBytes },
    disk: { path: options.diskPath, totalBytes, availableBytes, usedPercent },
    warnings,
  };
}
