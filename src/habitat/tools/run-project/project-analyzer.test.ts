import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeProject, clearAnalysisCache } from './project-analyzer.js';

describe('project-analyzer', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'project-analyzer-'));
    clearAnalysisCache();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('project type detection', () => {
    it('should detect npm project', async () => {
      await writeFile(join(tempDir, 'package.json'), '{"name":"test"}');
      const reqs = await analyzeProject(tempDir);
      expect(reqs.projectType).toBe('npm');
      expect(reqs.baseImage).toBe('node:20');
      expect(reqs.setupCommands).toContain('npm install');
    });

    it('should detect pip project', async () => {
      await writeFile(join(tempDir, 'requirements.txt'), 'flask\n');
      const reqs = await analyzeProject(tempDir);
      expect(reqs.projectType).toBe('pip');
      expect(reqs.baseImage).toBe('python:3.11');
    });

    it('should detect shell project from run.sh', async () => {
      await writeFile(join(tempDir, 'run.sh'), '#!/bin/bash\necho hello');
      const reqs = await analyzeProject(tempDir);
      expect(reqs.projectType).toBe('shell');
      expect(reqs.baseImage).toBe('ubuntu:22.04');
    });

    it('should detect shell project from bin/ directory', async () => {
      await mkdir(join(tempDir, 'bin'));
      await writeFile(join(tempDir, 'bin', 'fetch'), '#!/bin/bash\ncurl http://example.com');
      const reqs = await analyzeProject(tempDir);
      expect(reqs.projectType).toBe('shell');
    });

    it('should detect shell project from Makefile', async () => {
      await writeFile(join(tempDir, 'Makefile'), 'all:\n\techo hello');
      const reqs = await analyzeProject(tempDir);
      expect(reqs.projectType).toBe('shell');
    });

    it('should return unknown for empty project', async () => {
      const reqs = await analyzeProject(tempDir);
      expect(reqs.projectType).toBe('unknown');
    });
  });

  describe('tool detection from scripts', () => {
    it('should detect imagemagick usage', async () => {
      await mkdir(join(tempDir, 'bin'));
      await writeFile(join(tempDir, 'bin', 'process'), '#!/bin/bash\nmagick input.png output.png');
      const reqs = await analyzeProject(tempDir);
      expect(reqs.detectedTools).toContain('imagemagick');
      expect(reqs.aptPackages).toContain('imagemagick');
    });

    it('should detect claude CLI usage', async () => {
      await mkdir(join(tempDir, 'bin'));
      await writeFile(
        join(tempDir, 'bin', 'analyze'),
        '#!/bin/bash\nclaude --model haiku -p "analyze this"'
      );
      const reqs = await analyzeProject(tempDir);
      expect(reqs.detectedTools).toContain('claude-cli');
      expect(reqs.npmGlobalPackages).toContain('@anthropic-ai/claude-code');
      expect(reqs.envVarNames).toContain('ANTHROPIC_API_KEY');
    });

    it('should detect multiple tools', async () => {
      await mkdir(join(tempDir, 'bin'));
      await writeFile(
        join(tempDir, 'bin', 'pipeline'),
        '#!/bin/bash\ncurl http://api.example.com | jq .data > out.json\ngit commit -am "update"'
      );
      const reqs = await analyzeProject(tempDir);
      expect(reqs.detectedTools).toContain('curl');
      expect(reqs.detectedTools).toContain('jq');
      expect(reqs.detectedTools).toContain('git');
      expect(reqs.aptPackages).toContain('curl');
      expect(reqs.aptPackages).toContain('jq');
      expect(reqs.aptPackages).toContain('git');
    });

    it('should detect npx usage and upgrade to node image', async () => {
      await writeFile(join(tempDir, 'run.sh'), '#!/bin/bash\nnpx @the-focus-ai/nano-banana');
      const reqs = await analyzeProject(tempDir);
      expect(reqs.detectedTools).toContain('npx');
      // Shell project with npx should get node image
      expect(reqs.baseImage).toBe('node:20');
    });

    it('should detect tools from root scripts', async () => {
      await writeFile(join(tempDir, 'setup.sh'), '#!/bin/bash\nwget http://example.com/file');
      const reqs = await analyzeProject(tempDir);
      expect(reqs.detectedTools).toContain('wget');
    });
  });

  describe('env var detection', () => {
    it('should detect env vars from CLAUDE.md', async () => {
      await writeFile(
        join(tempDir, 'CLAUDE.md'),
        '# Config\nSet GEMINI_API_KEY and ANTHROPIC_API_KEY in your environment.'
      );
      const reqs = await analyzeProject(tempDir);
      expect(reqs.envVarNames).toContain('GEMINI_API_KEY');
      expect(reqs.envVarNames).toContain('ANTHROPIC_API_KEY');
    });

    it('should detect env vars from .env file', async () => {
      await writeFile(
        join(tempDir, '.env'),
        'GOOGLE_API_KEY=xxx\nSECRET_TOKEN=yyy\n# comment\nNOT_UPPER=skip\n'
      );
      const reqs = await analyzeProject(tempDir);
      expect(reqs.envVarNames).toContain('GOOGLE_API_KEY');
      expect(reqs.envVarNames).toContain('SECRET_TOKEN');
    });

    it('should detect env vars from .env.example', async () => {
      await writeFile(
        join(tempDir, '.env.example'),
        'TAVILY_API_KEY=your-key-here\n'
      );
      const reqs = await analyzeProject(tempDir);
      expect(reqs.envVarNames).toContain('TAVILY_API_KEY');
    });
  });

  describe('setup commands', () => {
    it('should generate apt install command for detected packages', async () => {
      await mkdir(join(tempDir, 'bin'));
      await writeFile(join(tempDir, 'bin', 'run'), '#!/bin/bash\ncurl http://example.com | jq .data');
      const reqs = await analyzeProject(tempDir);
      const aptCmd = reqs.setupCommands.find((c) => c.includes('apt-get install'));
      expect(aptCmd).toBeDefined();
      expect(aptCmd).toContain('curl');
      expect(aptCmd).toContain('jq');
    });

    it('should generate npm global install for detected packages', async () => {
      await mkdir(join(tempDir, 'bin'));
      await writeFile(join(tempDir, 'bin', 'run'), '#!/bin/bash\nclaude --model haiku -p "test"');
      const reqs = await analyzeProject(tempDir);
      const npmCmd = reqs.setupCommands.find((c) => c.includes('npm install -g'));
      expect(npmCmd).toBeDefined();
      expect(npmCmd).toContain('@anthropic-ai/claude-code');
    });

    it('should include npm install for npm projects', async () => {
      await writeFile(join(tempDir, 'package.json'), '{"name":"test"}');
      const reqs = await analyzeProject(tempDir);
      expect(reqs.setupCommands).toContain('npm install');
    });
  });

  describe('skill detection', () => {
    it('should detect skill repos from plugin references in scripts', async () => {
      await mkdir(join(tempDir, 'bin'));
      await writeFile(
        join(tempDir, 'bin', 'screenshot'),
        '#!/bin/bash\n~/.claude/plugins/cache/marketplace/chrome-driver/bin/screenshot "$1"'
      );
      const reqs = await analyzeProject(tempDir);
      expect(reqs.skillRepos).toHaveLength(1);
      expect(reqs.skillRepos[0].name).toBe('chrome-driver');
      expect(reqs.skillRepos[0].gitRepo).toBe('The-Focus-AI/chrome-driver');
      expect(reqs.aptPackages).toContain('chromium');
    });

    it('should have empty skillRepos when no plugins referenced', async () => {
      await writeFile(join(tempDir, 'run.sh'), '#!/bin/bash\necho hello');
      const reqs = await analyzeProject(tempDir);
      expect(reqs.skillRepos).toHaveLength(0);
    });
  });

  describe('caching', () => {
    it('should cache analysis results', async () => {
      await writeFile(join(tempDir, 'package.json'), '{"name":"test"}');
      const reqs1 = await analyzeProject(tempDir);
      const reqs2 = await analyzeProject(tempDir);
      // Should return the same object (cached)
      expect(reqs1).toBe(reqs2);
    });

    it('should return fresh results after cache clear', async () => {
      await writeFile(join(tempDir, 'package.json'), '{"name":"test"}');
      const reqs1 = await analyzeProject(tempDir);
      clearAnalysisCache();
      const reqs2 = await analyzeProject(tempDir);
      // New object but same content
      expect(reqs1).not.toBe(reqs2);
      expect(reqs1.projectType).toBe(reqs2.projectType);
    });
  });
});
