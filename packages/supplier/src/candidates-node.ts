/**
 * The real detection effects. Split from `candidates.ts` so the estimate itself
 * imports no Node built-ins and stays testable against a fabricated machine.
 */

import os from "node:os";
import { execFileSync } from "node:child_process";
import { detectResources, type DetectEffects, type MachineResources } from "./candidates.js";

export const nodeDetectEffects: DetectEffects = {
  platform: () => process.platform,
  arch: () => process.arch,
  totalMemory: () => os.totalmem(),
  freeMemory: () => os.freemem(),
  run(command, args) {
    try {
      return execFileSync(command, args, {
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      // Not installed, not on PATH, or it failed. All of those mean the same
      // thing here — this machine does not have that accelerator — and none of
      // them should stop an agent from starting.
      return undefined;
    }
  },
};

export function detectMachineResources(): MachineResources {
  return detectResources(nodeDetectEffects);
}
