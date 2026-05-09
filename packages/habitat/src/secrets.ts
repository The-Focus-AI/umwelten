/**
 * Habitat secret store: load/save secrets.json in the work directory.
 * Secrets are stored as a plain JSON object mapping env var names to values.
 * File permissions are set to 0600 (owner read/write only).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileExists } from './config.js';

const SECRETS_FILENAME = 'secrets.json';

/**
 * Load secrets from secrets.json in the work directory.
 * Returns an empty object if the file doesn't exist.
 */
export async function loadSecrets(workDir: string): Promise<Record<string, string>> {
  const filePath = join(workDir, SECRETS_FILENAME);
  if (!await fileExists(filePath)) return {};
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Save secrets to secrets.json in the work directory.
 * File is written with mode 0600 (owner read/write only).
 */
export async function saveSecrets(workDir: string, secrets: Record<string, string>): Promise<void> {
  const filePath = join(workDir, SECRETS_FILENAME);
  await writeFile(filePath, JSON.stringify(secrets, null, 2) + '\n', { mode: 0o600 });
}
