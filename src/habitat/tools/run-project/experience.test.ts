import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  generateExperienceId,
  experienceExists,
  startExperience,
  continueExperience,
  commitExperience,
  discardExperience,
  getExperienceDir,
  getExperiencesBaseDir,
} from './experience.js';

describe('experience', () => {
  let tempDir: string;
  let workDir: string;
  let sourceDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'experience-test-'));
    workDir = join(tempDir, 'work');
    sourceDir = join(tempDir, 'source');
    await mkdir(workDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    // Create a sample source file
    await writeFile(join(sourceDir, 'hello.txt'), 'Hello, World!');
    await mkdir(join(sourceDir, 'subdir'), { recursive: true });
    await writeFile(join(sourceDir, 'subdir', 'nested.txt'), 'Nested file');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('generateExperienceId', () => {
    it('should generate unique IDs', async () => {
      const id1 = await generateExperienceId();
      const id2 = await generateExperienceId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^experience-\d+-[a-z0-9]+$/);
    });
  });

  describe('getExperiencesBaseDir', () => {
    it('should return a sibling directory', () => {
      const base = getExperiencesBaseDir('/home/user/work');
      expect(base).toBe('/home/user/work-dagger-experiences');
    });
  });

  describe('startExperience', () => {
    it('should copy source to experience directory', async () => {
      const eid = 'test-exp-1';
      await startExperience(workDir, eid, sourceDir);

      expect(await experienceExists(workDir, eid)).toBe(true);

      const expDir = getExperienceDir(workDir, eid);
      const content = await readFile(join(expDir, 'hello.txt'), 'utf-8');
      expect(content).toBe('Hello, World!');

      const nested = await readFile(join(expDir, 'subdir', 'nested.txt'), 'utf-8');
      expect(nested).toBe('Nested file');
    });

    it('should filter out .git and node_modules', async () => {
      await mkdir(join(sourceDir, '.git'), { recursive: true });
      await writeFile(join(sourceDir, '.git', 'config'), 'gitconfig');
      await mkdir(join(sourceDir, 'node_modules'), { recursive: true });
      await writeFile(join(sourceDir, 'node_modules', 'mod.js'), 'module');

      const eid = 'test-exp-filtered';
      await startExperience(workDir, eid, sourceDir);

      const expDir = getExperienceDir(workDir, eid);
      await expect(access(join(expDir, '.git'))).rejects.toThrow();
      await expect(access(join(expDir, 'node_modules'))).rejects.toThrow();
      // But regular files should be there
      const content = await readFile(join(expDir, 'hello.txt'), 'utf-8');
      expect(content).toBe('Hello, World!');
    });

    it('should save metadata', async () => {
      const eid = 'test-exp-meta';
      await startExperience(workDir, eid, sourceDir, 'my-agent');

      const expDir = getExperienceDir(workDir, eid);
      const metaContent = await readFile(join(expDir, 'meta.json'), 'utf-8');
      const meta = JSON.parse(metaContent);
      expect(meta.experienceId).toBe(eid);
      expect(meta.sourcePath).toBe(sourceDir);
      expect(meta.agentId).toBe('my-agent');
      expect(meta.created).toBeTruthy();
    });
  });

  describe('continueExperience', () => {
    it('should update lastUsed', async () => {
      const eid = 'test-exp-continue';
      await startExperience(workDir, eid, sourceDir);

      const expDir = getExperienceDir(workDir, eid);
      const metaBefore = JSON.parse(await readFile(join(expDir, 'meta.json'), 'utf-8'));

      // Wait a moment to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));
      const meta = await continueExperience(workDir, eid);

      expect(meta.experienceId).toBe(eid);
      expect(new Date(meta.lastUsed).getTime()).toBeGreaterThanOrEqual(
        new Date(metaBefore.lastUsed).getTime()
      );
    });

    it('should throw for non-existent experience', async () => {
      await expect(continueExperience(workDir, 'nonexistent')).rejects.toThrow(
        'EXPERIENCE_NOT_FOUND'
      );
    });
  });

  describe('commitExperience', () => {
    it('should copy experience back to source and delete', async () => {
      const eid = 'test-exp-commit';
      await startExperience(workDir, eid, sourceDir);

      // Modify a file in the experience
      const expDir = getExperienceDir(workDir, eid);
      await writeFile(join(expDir, 'new-file.txt'), 'Created in experience');

      const meta = await commitExperience(workDir, eid);
      expect(meta.sourcePath).toBe(sourceDir);

      // New file should be in source now
      const content = await readFile(join(sourceDir, 'new-file.txt'), 'utf-8');
      expect(content).toBe('Created in experience');

      // Experience should be deleted
      expect(await experienceExists(workDir, eid)).toBe(false);
    });

    it('should throw for non-existent experience', async () => {
      await expect(commitExperience(workDir, 'nonexistent')).rejects.toThrow(
        'EXPERIENCE_NOT_FOUND'
      );
    });
  });

  describe('discardExperience', () => {
    it('should delete the experience directory', async () => {
      const eid = 'test-exp-discard';
      await startExperience(workDir, eid, sourceDir);

      expect(await experienceExists(workDir, eid)).toBe(true);
      await discardExperience(workDir, eid);
      expect(await experienceExists(workDir, eid)).toBe(false);
    });
  });
});
