import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSecrets, saveSecrets } from './secrets.js';

describe('secrets', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'secrets-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('loadSecrets()', () => {
    it('should return empty object when secrets.json does not exist', async () => {
      const secrets = await loadSecrets(tempDir);
      expect(secrets).toEqual({});
    });

    it('should load secrets from secrets.json', async () => {
      await writeFile(
        join(tempDir, 'secrets.json'),
        JSON.stringify({ API_KEY: 'test-key', TOKEN: 'test-token' }),
      );

      const secrets = await loadSecrets(tempDir);
      expect(secrets).toEqual({ API_KEY: 'test-key', TOKEN: 'test-token' });
    });

    it('should return empty object for invalid JSON', async () => {
      await writeFile(join(tempDir, 'secrets.json'), 'not valid json');

      const secrets = await loadSecrets(tempDir);
      expect(secrets).toEqual({});
    });
  });

  describe('saveSecrets()', () => {
    it('should write secrets to secrets.json', async () => {
      const secrets = { MY_KEY: 'my-value' };
      await saveSecrets(tempDir, secrets);

      const raw = await readFile(join(tempDir, 'secrets.json'), 'utf-8');
      expect(JSON.parse(raw)).toEqual(secrets);
    });

    it('should set file permissions to 0600', async () => {
      await saveSecrets(tempDir, { KEY: 'val' });

      const st = await stat(join(tempDir, 'secrets.json'));
      // mode & 0o777 gives the permission bits
      const perms = st.mode & 0o777;
      expect(perms).toBe(0o600);
    });

    it('should overwrite existing secrets', async () => {
      await saveSecrets(tempDir, { A: '1', B: '2' });
      await saveSecrets(tempDir, { C: '3' });

      const secrets = await loadSecrets(tempDir);
      expect(secrets).toEqual({ C: '3' });
      expect(secrets.A).toBeUndefined();
    });
  });
});
