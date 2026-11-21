import { access, readFile } from "node:fs/promises";
import type { HabitatConfig } from "./types.js";

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(configPath: string): Promise<HabitatConfig> {
  if (!(await fileExists(configPath))) return {};
  try {
    return JSON.parse(await readFile(configPath, "utf8")) as HabitatConfig;
  } catch {
    return {};
  }
}
