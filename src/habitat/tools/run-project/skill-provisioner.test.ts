import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { detectSkillRequirements, resolveSkillRepo, normalizeGitUrl } from './skill-provisioner.js';

describe('skill-provisioner', () => {
  describe('detectSkillRequirements', () => {
    it('should detect chrome-driver plugin references', async () => {
      const scripts = [
        '#!/bin/bash\n~/.claude/plugins/cache/marketplace/chrome-driver/bin/screenshot https://example.com',
      ];
      const reqs = await detectSkillRequirements(scripts, '/tmp/test');
      expect(reqs.skillRepos).toHaveLength(1);
      expect(reqs.skillRepos[0].name).toBe('chrome-driver');
      expect(reqs.skillRepos[0].gitRepo).toBe('The-Focus-AI/chrome-driver');
      expect(reqs.skillRepos[0].containerPath).toBe('/opt/chrome-driver');
      expect(reqs.aptPackages).toContain('chromium');
      expect(reqs.aptPackages).toContain('perl');
    });

    it('should detect nano-banana plugin references', async () => {
      const scripts = [
        '#!/bin/bash\n~/.claude/plugins/cache/marketplace/nano-banana/bin/generate image',
      ];
      const reqs = await detectSkillRequirements(scripts, '/tmp/test');
      expect(reqs.skillRepos).toHaveLength(1);
      expect(reqs.skillRepos[0].name).toBe('nano-banana');
      expect(reqs.skillRepos[0].gitRepo).toBe('The-Focus-AI/nano-banana-cli');
      expect(reqs.skillRepos[0].containerPath).toBe('/opt/nano-banana');
    });

    it('should detect unknown plugins as generic skill repos', async () => {
      const scripts = [
        '#!/bin/bash\n~/.claude/plugins/cache/some-org/my-plugin/bin/run',
      ];
      const reqs = await detectSkillRequirements(scripts, '/tmp/test');
      expect(reqs.skillRepos).toHaveLength(1);
      expect(reqs.skillRepos[0].name).toBe('my-plugin');
      expect(reqs.skillRepos[0].gitRepo).toBe('some-org/my-plugin');
      expect(reqs.skillRepos[0].containerPath).toBe('/opt/my-plugin');
    });

    it('should detect multiple plugins without duplicates', async () => {
      const scripts = [
        '#!/bin/bash\n~/.claude/plugins/cache/marketplace/chrome-driver/bin/screenshot https://example.com',
        '#!/bin/bash\n~/.claude/plugins/cache/marketplace/chrome-driver/lib/utils.pl\n~/.claude/plugins/cache/marketplace/nano-banana/bin/gen',
      ];
      const reqs = await detectSkillRequirements(scripts, '/tmp/test');
      expect(reqs.skillRepos).toHaveLength(2);
      const names = reqs.skillRepos.map((r) => r.name);
      expect(names).toContain('chrome-driver');
      expect(names).toContain('nano-banana');
    });

    it('should detect plugins via expanded home dir paths', async () => {
      const home = homedir();
      const scripts = [
        `#!/bin/bash\nCHROME_EXTRACT="${home}/.claude/plugins/cache/focus-marketplace/chrome-driver/0.1.0/bin/extract"\n"$CHROME_EXTRACT" http://example.com`,
      ];
      const reqs = await detectSkillRequirements(scripts, '/tmp/test');
      expect(reqs.skillRepos).toHaveLength(1);
      expect(reqs.skillRepos[0].name).toBe('chrome-driver');
      expect(reqs.skillRepos[0].gitRepo).toBe('The-Focus-AI/chrome-driver');
    });

    it('should deduplicate tilde and expanded paths to same plugin', async () => {
      const home = homedir();
      const scripts = [
        `#!/bin/bash\n~/.claude/plugins/cache/focus-marketplace/chrome-driver/bin/extract http://example.com`,
        `#!/bin/bash\n${home}/.claude/plugins/cache/focus-marketplace/chrome-driver/0.1.0/bin/screenshot http://example.com`,
      ];
      const reqs = await detectSkillRequirements(scripts, '/tmp/test');
      expect(reqs.skillRepos).toHaveLength(1);
      expect(reqs.skillRepos[0].name).toBe('chrome-driver');
    });

    it('should return empty for scripts without plugin references', async () => {
      const scripts = ['#!/bin/bash\necho hello world'];
      const reqs = await detectSkillRequirements(scripts, '/tmp/test');
      expect(reqs.skillRepos).toHaveLength(0);
      expect(reqs.aptPackages).toHaveLength(0);
    });
  });

  describe('resolveSkillRepo', () => {
    it('should resolve known skill by name', () => {
      const repo = resolveSkillRepo('chrome-driver');
      expect(repo.name).toBe('chrome-driver');
      expect(repo.gitRepo).toBe('The-Focus-AI/chrome-driver');
      expect(repo.containerPath).toBe('/opt/chrome-driver');
      expect(repo.aptPackages).toContain('chromium');
    });

    it('should resolve unknown name as git repo', () => {
      const repo = resolveSkillRepo('some-org/custom-tool');
      expect(repo.name).toBe('custom-tool');
      expect(repo.gitRepo).toBe('some-org/custom-tool');
      expect(repo.containerPath).toBe('/opt/custom-tool');
      expect(repo.aptPackages).toHaveLength(0);
    });

    it('should handle full git URLs', () => {
      const repo = resolveSkillRepo('https://github.com/foo/bar.git');
      expect(repo.name).toBe('bar');
      expect(repo.gitRepo).toBe('https://github.com/foo/bar.git');
      expect(repo.containerPath).toBe('/opt/bar');
    });
  });

  describe('normalizeGitUrl', () => {
    it('should convert owner/repo to full GitHub URL', () => {
      expect(normalizeGitUrl('Focus-AI/chrome-driver')).toBe(
        'https://github.com/Focus-AI/chrome-driver'
      );
    });

    it('should pass through full URLs unchanged', () => {
      expect(normalizeGitUrl('https://github.com/foo/bar')).toBe(
        'https://github.com/foo/bar'
      );
    });

    it('should pass through git@ URLs unchanged', () => {
      expect(normalizeGitUrl('git@github.com:foo/bar.git')).toBe(
        'git@github.com:foo/bar.git'
      );
    });
  });
});
