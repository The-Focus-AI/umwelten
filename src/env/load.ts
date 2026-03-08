import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import dotenv from 'dotenv';

let loaded = false;
let loadedPath: string | undefined;

export function findNearestEnvFile(startDir: string = process.cwd()): string | undefined {
  let currentDir = resolve(startDir);

  while (true) {
    const candidate = join(currentDir, '.env');
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }
    currentDir = parentDir;
  }
}

export function loadEnv(startDir: string = process.cwd()): string | undefined {
  if (loaded) {
    return loadedPath;
  }

  const envPath = findNearestEnvFile(startDir);
  if (envPath) {
    dotenv.config({ path: envPath, quiet: true });
    loadedPath = envPath;
  }

  loaded = true;
  return loadedPath;
}

loadEnv();