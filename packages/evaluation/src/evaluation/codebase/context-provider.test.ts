import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectProjectType,
  loadCodebaseContext,
  formatCodebaseContextPrompt,
  createCodebaseStimulus,
  loadRelevantFiles,
} from './context-provider.js';

describe('context-provider', () => {
  let testDir: string;

  beforeAll(async () => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `umwelten-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // Create test files
    await mkdir(join(testDir, 'src'), { recursive: true });
    await writeFile(
      join(testDir, 'package.json'),
      JSON.stringify({ name: 'test-project', version: '1.0.0' })
    );
    await writeFile(
      join(testDir, 'src', 'index.ts'),
      'export function hello() { return "world"; }'
    );
    await writeFile(
      join(testDir, 'src', 'utils.ts'),
      'export function add(a: number, b: number) { return a + b; }'
    );
    await writeFile(join(testDir, 'README.md'), '# Test Project\n\nThis is a test.');

    // Create a node_modules directory (should be excluded)
    await mkdir(join(testDir, 'node_modules'), { recursive: true });
    await writeFile(
      join(testDir, 'node_modules', 'some-lib.js'),
      'module.exports = {};'
    );
  });

  afterAll(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('detectProjectType', () => {
    it('should detect npm project', async () => {
      const projectType = await detectProjectType(testDir);
      expect(projectType).toBe('npm');
    });

    it('should return unknown for non-standard projects', async () => {
      const emptyDir = join(tmpdir(), `umwelten-empty-${Date.now()}`);
      await mkdir(emptyDir, { recursive: true });

      const projectType = await detectProjectType(emptyDir);
      expect(projectType).toBe('unknown');

      await rm(emptyDir, { recursive: true, force: true });
    });
  });

  describe('loadCodebaseContext', () => {
    it('should load codebase with default settings', async () => {
      const context = await loadCodebaseContext({
        path: testDir,
      });

      expect(context.projectType).toBe('npm');
      expect(context.files.length).toBeGreaterThan(0);

      // Should include our TypeScript files
      const tsFiles = context.files.filter(f => f.path.endsWith('.ts'));
      expect(tsFiles.length).toBe(2);

      // Should include README
      const readme = context.files.find(f => f.path === 'README.md');
      expect(readme).toBeDefined();

      // Should exclude node_modules
      const nodeModulesFiles = context.files.filter(f =>
        f.path.includes('node_modules')
      );
      expect(nodeModulesFiles.length).toBe(0);
    });

    it('should detect languages correctly', async () => {
      const context = await loadCodebaseContext({
        path: testDir,
      });

      const indexFile = context.files.find(f => f.path.includes('index.ts'));
      expect(indexFile?.language).toBe('typescript');

      const readmeFile = context.files.find(f => f.path === 'README.md');
      expect(readmeFile?.language).toBe('markdown');
    });

    it('should generate file tree when requested', async () => {
      const context = await loadCodebaseContext({
        path: testDir,
        includeFileTree: true,
      });

      expect(context.fileTree).toBeDefined();
      expect(context.fileTree).toContain('src');
      expect(context.fileTree).toContain('index.ts');
    });

    it('should respect custom include/exclude patterns', async () => {
      const context = await loadCodebaseContext({
        path: testDir,
        include: ['**/*.md'],
        exclude: [],
      });

      // Should only include markdown files
      expect(context.files.every(f => f.path.endsWith('.md'))).toBe(true);
      expect(context.files.length).toBeGreaterThan(0);
    });

    it('should respect max context size', async () => {
      const context = await loadCodebaseContext({
        path: testDir,
        maxContextSize: 100, // Very small limit
      });

      // Should truncate files
      expect(context.totalSize).toBeLessThanOrEqual(100);
      if (context.truncatedFiles) {
        expect(context.truncatedFiles.length).toBeGreaterThan(0);
      }
    });

    it('should track total size correctly', async () => {
      const context = await loadCodebaseContext({
        path: testDir,
      });

      const expectedSize = context.files.reduce(
        (sum, file) => sum + file.content.length,
        0
      );

      expect(context.totalSize).toBe(expectedSize);
    });
  });

  describe('formatCodebaseContextPrompt', () => {
    it('should format context as readable prompt', async () => {
      const context = await loadCodebaseContext({
        path: testDir,
        includeFileTree: true,
      });

      const prompt = formatCodebaseContextPrompt(context);

      expect(prompt).toContain('# Codebase Context');
      expect(prompt).toContain('Project Type: npm');
      expect(prompt).toContain('## File Structure');
      expect(prompt).toContain('## Source Files');
      expect(prompt).toContain('index.ts');
    });

    it('should include language markers in code blocks', async () => {
      const context = await loadCodebaseContext({
        path: testDir,
      });

      const prompt = formatCodebaseContextPrompt(context);

      expect(prompt).toContain('```typescript');
      expect(prompt).toContain('```markdown');
    });

    it('should show truncation warning when applicable', async () => {
      const context = await loadCodebaseContext({
        path: testDir,
        maxContextSize: 100,
      });

      const prompt = formatCodebaseContextPrompt(context);

      if (context.truncatedFiles && context.truncatedFiles.length > 0) {
        expect(prompt).toContain('files were excluded due to size limits');
      }
    });
  });

  describe('createCodebaseStimulus', () => {
    it('should create stimulus with codebase context', async () => {
      const context = await loadCodebaseContext({
        path: testDir,
      });

      const stimulus = createCodebaseStimulus(
        context,
        'Add a new function called multiply',
        'test-task-1'
      );

      expect(stimulus.id).toBe('test-task-1');
      expect(stimulus.description).toContain('Add a new function called multiply');
      expect(stimulus.options.role).toBe('coding assistant');
      expect(stimulus.options.instructions).toBeDefined();
      expect(stimulus.options.instructions?.[0]).toContain('# Codebase Context');
      expect(stimulus.options.instructions?.[0]).toContain('# Task');
      expect(stimulus.options.systemContext).toBeDefined();

      const metadata = JSON.parse(stimulus.options.systemContext || '{}');
      expect(metadata.projectType).toBe('npm');
      expect(metadata.fileCount).toBe(context.files.length);
    });

    it('should auto-generate ID if not provided', async () => {
      const context = await loadCodebaseContext({
        path: testDir,
      });

      const stimulus = createCodebaseStimulus(context, 'Test task');

      expect(stimulus.id).toMatch(/^codebase-\d+$/);
    });
  });

  describe('loadRelevantFiles', () => {
    it('should load only specified files', async () => {
      const files = await loadRelevantFiles(testDir, [
        join('src', 'index.ts'),
        'README.md',
      ]);

      expect(files.length).toBe(2);

      const indexFile = files.find(f => f.path.includes('index.ts'));
      expect(indexFile).toBeDefined();
      expect(indexFile?.content).toContain('hello');

      const readmeFile = files.find(f => f.path === 'README.md');
      expect(readmeFile).toBeDefined();
    });

    it('should handle missing files gracefully', async () => {
      const files = await loadRelevantFiles(testDir, [
        join('src', 'index.ts'),
        'nonexistent.ts',
      ]);

      // Should only load the existing file
      expect(files.length).toBe(1);
      expect(files[0].path).toContain('index.ts');
    });

    it('should detect languages for relevant files', async () => {
      const files = await loadRelevantFiles(testDir, [join('src', 'index.ts')]);

      expect(files[0].language).toBe('typescript');
    });
  });
});
