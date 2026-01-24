import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyChanges, cleanupWorkdir } from './change-applicator.js';
import type { ExtractedChanges } from './types.js';

describe('change-applicator', () => {
  let testCodebase: string;
  let workdirs: string[] = [];

  beforeEach(async () => {
    // Create a test codebase
    testCodebase = join(tmpdir(), `test-codebase-${Date.now()}`);
    await mkdir(testCodebase, { recursive: true });

    // Create some test files
    await mkdir(join(testCodebase, 'src'), { recursive: true });
    await writeFile(
      join(testCodebase, 'src', 'index.ts'),
      'export function hello() {\n  return "world";\n}'
    );
    await writeFile(
      join(testCodebase, 'src', 'utils.ts'),
      'export function add(a: number, b: number) {\n  return a + b;\n}'
    );
    await writeFile(
      join(testCodebase, 'README.md'),
      '# Test Project\n\nThis is a test.'
    );
  });

  afterEach(async () => {
    // Clean up test codebase
    await rm(testCodebase, { recursive: true, force: true });

    // Clean up any workdirs
    for (const workdir of workdirs) {
      try {
        await rm(workdir, { recursive: true, force: true });
      } catch {
        // Ignore errors
      }
    }
    workdirs = [];
  });

  describe('applyChanges', () => {
    it('should create an isolated copy of the codebase', async () => {
      const changes: ExtractedChanges = {
        success: true,
        files: [],
        format: 'unknown',
      };

      const result = await applyChanges(testCodebase, changes);
      workdirs.push(result.workdir);

      expect(result.success).toBe(true);
      expect(result.workdir).toBeDefined();

      // Verify files were copied
      const indexContent = await readFile(
        join(result.workdir, 'src', 'index.ts'),
        'utf-8'
      );
      expect(indexContent).toContain('hello');
    });

    it('should apply create operation', async () => {
      const changes: ExtractedChanges = {
        success: true,
        files: [
          {
            path: 'src/new-file.ts',
            type: 'create',
            content: 'export const NEW = true;',
          },
        ],
        format: 'code-block',
      };

      const result = await applyChanges(testCodebase, changes);
      workdirs.push(result.workdir);

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].success).toBe(true);
      expect(result.files[0].operation).toBe('created');

      // Verify file was created
      const content = await readFile(
        join(result.workdir, 'src', 'new-file.ts'),
        'utf-8'
      );
      expect(content).toBe('export const NEW = true;');
    });

    it('should apply modify operation with full content', async () => {
      const changes: ExtractedChanges = {
        success: true,
        files: [
          {
            path: 'src/index.ts',
            type: 'modify',
            content: 'export function hello() {\n  return "universe";\n}',
          },
        ],
        format: 'code-block',
      };

      const result = await applyChanges(testCodebase, changes);
      workdirs.push(result.workdir);

      expect(result.success).toBe(true);
      expect(result.files[0].success).toBe(true);
      expect(result.files[0].operation).toBe('modified');

      // Verify content was changed
      const content = await readFile(
        join(result.workdir, 'src', 'index.ts'),
        'utf-8'
      );
      expect(content).toContain('universe');
    });

    it('should apply modify operation with diff hunks', async () => {
      const changes: ExtractedChanges = {
        success: true,
        files: [
          {
            path: 'src/index.ts',
            type: 'modify',
            hunks: [
              {
                oldStart: 1,
                oldLines: 3,
                newStart: 1,
                newLines: 4,
                lines: [
                  ' export function hello() {',
                  '+  console.log("Hello!");',
                  '   return "world";',
                  ' }',
                ],
              },
            ],
          },
        ],
        format: 'unified-diff',
      };

      const result = await applyChanges(testCodebase, changes);
      workdirs.push(result.workdir);

      expect(result.success).toBe(true);
      expect(result.files[0].success).toBe(true);
      expect(result.files[0].operation).toBe('modified');
      expect(result.files[0].hunksApplied).toBe(1);

      // Verify hunk was applied
      const content = await readFile(
        join(result.workdir, 'src', 'index.ts'),
        'utf-8'
      );
      expect(content).toContain('console.log("Hello!")');
    });

    it('should handle multiple hunks', async () => {
      const changes: ExtractedChanges = {
        success: true,
        files: [
          {
            path: 'src/utils.ts',
            type: 'modify',
            hunks: [
              {
                oldStart: 1,
                oldLines: 3,
                newStart: 1,
                newLines: 4,
                lines: [
                  ' export function add(a: number, b: number) {',
                  '+  // Perform addition',
                  '   return a + b;',
                  ' }',
                ],
              },
            ],
          },
        ],
        format: 'unified-diff',
      };

      const result = await applyChanges(testCodebase, changes);
      workdirs.push(result.workdir);

      expect(result.success).toBe(true);
      expect(result.files[0].hunksApplied).toBe(1);

      const content = await readFile(
        join(result.workdir, 'src', 'utils.ts'),
        'utf-8'
      );
      expect(content).toContain('// Perform addition');
    });

    it('should apply delete operation', async () => {
      const changes: ExtractedChanges = {
        success: true,
        files: [
          {
            path: 'README.md',
            type: 'delete',
          },
        ],
        format: 'git-patch',
      };

      const result = await applyChanges(testCodebase, changes);
      workdirs.push(result.workdir);

      expect(result.success).toBe(true);
      expect(result.files[0].success).toBe(true);
      expect(result.files[0].operation).toBe('deleted');

      // Verify file was deleted
      await expect(
        stat(join(result.workdir, 'README.md'))
      ).rejects.toThrow();
    });

    it('should apply rename operation', async () => {
      const changes: ExtractedChanges = {
        success: true,
        files: [
          {
            path: 'src/index.ts',
            type: 'rename',
            newPath: 'src/main.ts',
          },
        ],
        format: 'git-patch',
      };

      const result = await applyChanges(testCodebase, changes);
      workdirs.push(result.workdir);

      expect(result.success).toBe(true);
      expect(result.files[0].success).toBe(true);
      expect(result.files[0].operation).toBe('renamed');

      // Verify old file doesn't exist
      await expect(
        stat(join(result.workdir, 'src', 'index.ts'))
      ).rejects.toThrow();

      // Verify new file exists
      const content = await readFile(
        join(result.workdir, 'src', 'main.ts'),
        'utf-8'
      );
      expect(content).toContain('hello');
    });

    it('should apply multiple changes', async () => {
      const changes: ExtractedChanges = {
        success: true,
        files: [
          {
            path: 'src/new.ts',
            type: 'create',
            content: 'export const NEW = 1;',
          },
          {
            path: 'src/index.ts',
            type: 'modify',
            content: 'export function hello() { return "modified"; }',
          },
          {
            path: 'README.md',
            type: 'delete',
          },
        ],
        format: 'mixed',
      };

      const result = await applyChanges(testCodebase, changes);
      workdirs.push(result.workdir);

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(3);
      expect(result.files.every(f => f.success)).toBe(true);
    });

    it('should handle hunk application failure gracefully', async () => {
      const changes: ExtractedChanges = {
        success: true,
        files: [
          {
            path: 'src/index.ts',
            type: 'modify',
            hunks: [
              {
                oldStart: 1,
                oldLines: 3,
                newStart: 1,
                newLines: 3,
                lines: [
                  ' export function WRONG() {', // This won't match
                  '   return "world";',
                  ' }',
                ],
              },
            ],
          },
        ],
        format: 'unified-diff',
      };

      const result = await applyChanges(testCodebase, changes);
      workdirs.push(result.workdir);

      expect(result.success).toBe(false);
      expect(result.files[0].success).toBe(false);
      expect(result.files[0].error).toBeDefined();
      expect(result.files[0].hunksFailed).toBe(1);
    });

    it('should create parent directories for new files', async () => {
      const changes: ExtractedChanges = {
        success: true,
        files: [
          {
            path: 'deep/nested/new-file.ts',
            type: 'create',
            content: 'export const DEEP = true;',
          },
        ],
        format: 'code-block',
      };

      const result = await applyChanges(testCodebase, changes);
      workdirs.push(result.workdir);

      expect(result.success).toBe(true);
      expect(result.files[0].success).toBe(true);

      // Verify file was created in nested directory
      const content = await readFile(
        join(result.workdir, 'deep', 'nested', 'new-file.ts'),
        'utf-8'
      );
      expect(content).toBe('export const DEEP = true;');
    });

    it('should use custom workdir base', async () => {
      const customBase = join(tmpdir(), `custom-base-${Date.now()}`);
      await mkdir(customBase, { recursive: true });

      const changes: ExtractedChanges = {
        success: true,
        files: [],
        format: 'unknown',
      };

      const result = await applyChanges(testCodebase, changes, customBase);
      workdirs.push(result.workdir);

      expect(result.workdir).toContain('custom-base');

      // Clean up custom base
      await rm(customBase, { recursive: true, force: true });
    });
  });

  describe('cleanupWorkdir', () => {
    it('should remove working directory', async () => {
      const changes: ExtractedChanges = {
        success: true,
        files: [],
        format: 'unknown',
      };

      const result = await applyChanges(testCodebase, changes);
      const workdir = result.workdir;

      // Verify it exists
      await stat(workdir);

      // Clean it up
      await cleanupWorkdir(workdir);

      // Verify it's gone
      await expect(stat(workdir)).rejects.toThrow();
    });
  });
});
