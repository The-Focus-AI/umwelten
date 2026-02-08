import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Habitat } from './habitat.js';

describe('Habitat', () => {
  let tempDir: string;
  let workDir: string;
  let sessionsDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'habitat-test-'));
    workDir = join(tempDir, 'work');
    sessionsDir = join(tempDir, 'sessions');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('create()', () => {
    it('should create a habitat with explicit directories', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      expect(habitat.workDir).toBe(workDir);
      expect(habitat.sessionsDir).toBe(sessionsDir);
      expect(habitat.envPrefix).toBe('HABITAT');
    });

    it('should create directories on init', async () => {
      await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      const { readdir } = await import('node:fs/promises');
      // Directories should exist (no error)
      await readdir(workDir);
      await readdir(sessionsDir);
    });

    it('should use custom env prefix', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        envPrefix: 'MYBOT',
        skipBuiltinTools: true,
        skipSkills: true,
      });

      expect(habitat.envPrefix).toBe('MYBOT');
    });

    it('should load config from disk', async () => {
      await mkdir(workDir, { recursive: true });
      await writeFile(
        join(workDir, 'config.json'),
        JSON.stringify({ agents: [], defaultProvider: 'google', defaultModel: 'gemini-2.0-flash' }),
        'utf-8'
      );

      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      const config = habitat.getConfig();
      expect(config.defaultProvider).toBe('google');
      expect(config.defaultModel).toBe('gemini-2.0-flash');
      expect(config.agents).toEqual([]);
    });

    it('should use provided config override', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        config: { agents: [], name: 'test-habitat' },
        skipBuiltinTools: true,
        skipSkills: true,
      });

      expect(habitat.getConfig().name).toBe('test-habitat');
    });

    it('should register built-in tools by default', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipSkills: true,
      });

      const tools = habitat.getTools();
      expect(tools.read_file).toBeDefined();
      expect(tools.write_file).toBeDefined();
      expect(tools.list_directory).toBeDefined();
      expect(tools.ripgrep).toBeDefined();
      expect(tools.current_time).toBeDefined();
      expect(tools.agents_list).toBeDefined();
      expect(tools.sessions_list).toBeDefined();
      expect(tools.external_interactions_list).toBeDefined();
    });

    it('should skip built-in tools when requested', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      const tools = habitat.getTools();
      expect(Object.keys(tools).length).toBe(0);
    });

    it('should call registerCustomTools callback', async () => {
      let callbackCalled = false;
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
        registerCustomTools: (h) => {
          callbackCalled = true;
          // Could add custom tools here
        },
      });

      expect(callbackCalled).toBe(true);
    });
  });

  describe('config management', () => {
    it('should save and reload config', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      await habitat.updateConfig({ name: 'updated-habitat' });
      const reloaded = await habitat.reloadConfig();
      expect(reloaded.name).toBe('updated-habitat');
    });
  });

  describe('agent management', () => {
    it('should add and retrieve agents', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      await habitat.addAgent({
        id: 'test-agent',
        name: 'Test Agent',
        projectPath: '/tmp/test-project',
      });

      expect(habitat.getAgents()).toHaveLength(1);
      expect(habitat.getAgent('test-agent')).toBeDefined();
      expect(habitat.getAgent('Test Agent')).toBeDefined();
      expect(habitat.getAgent('nonexistent')).toBeUndefined();
    });

    it('should update agents', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      await habitat.addAgent({ id: 'a1', name: 'Agent 1', projectPath: '/tmp/a1' });
      await habitat.updateAgent('a1', { name: 'Updated Agent 1' });

      expect(habitat.getAgent('a1')?.name).toBe('Updated Agent 1');
    });

    it('should remove agents', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      await habitat.addAgent({ id: 'a1', name: 'Agent 1', projectPath: '/tmp/a1' });
      const removed = await habitat.removeAgent('a1');

      expect(removed?.id).toBe('a1');
      expect(habitat.getAgents()).toHaveLength(0);
    });

    it('should include agent project paths in allowed roots', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      await habitat.addAgent({ id: 'a1', name: 'Agent 1', projectPath: '/tmp/a1-project' });

      const roots = habitat.getAllowedRoots();
      expect(roots).toContain(workDir);
      expect(roots).toContain(sessionsDir);
      expect(roots).toContain('/tmp/a1-project');
    });
  });

  describe('model defaults', () => {
    it('should return undefined when no model configured', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      expect(habitat.getDefaultModelDetails()).toBeUndefined();
    });

    it('should return model details from config', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        config: { agents: [], defaultProvider: 'google', defaultModel: 'gemini-2.0-flash' },
        skipBuiltinTools: true,
        skipSkills: true,
      });

      const details = habitat.getDefaultModelDetails();
      expect(details?.provider).toBe('google');
      expect(details?.name).toBe('gemini-2.0-flash');
    });
  });

  describe('session management', () => {
    it('should create CLI sessions with unique IDs', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      const s1 = await habitat.getOrCreateSession('cli');
      const s2 = await habitat.getOrCreateSession('cli');

      expect(s1.sessionId).not.toBe(s2.sessionId);
      expect(s1.sessionId).toMatch(/^cli-/);
    });

    it('should list sessions', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      await habitat.getOrCreateSession('cli');
      await habitat.getOrCreateSession('cli');

      const sessions = await habitat.listSessions();
      expect(sessions.length).toBe(2);
    });
  });

  describe('stimulus', () => {
    it('should build stimulus with default persona when no STIMULUS.md', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      const stimulus = await habitat.getStimulus();
      const prompt = stimulus.getPrompt();
      expect(prompt).toContain('assistant');
    });

    it('should build stimulus from STIMULUS.md when present', async () => {
      await mkdir(workDir, { recursive: true });
      await writeFile(
        join(workDir, 'STIMULUS.md'),
        '---\nrole: butler\nobjective: serve the user\n---\n# Custom Persona\n\nYou are a custom agent.',
        'utf-8'
      );

      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      const stimulus = await habitat.getStimulus();
      const prompt = stimulus.getPrompt();
      expect(prompt).toContain('butler');
      expect(prompt).toContain('serve the user');
    });
  });

  describe('onboarding', () => {
    it('should report not onboarded for empty work dir', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      expect(await habitat.isOnboarded()).toBe(false);
    });

    it('should onboard and then report onboarded', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      const result = await habitat.onboard();
      expect(result.created).toContain('config.json');
      expect(result.created).toContain('STIMULUS.md (minimal)');
      expect(result.created).toContain('skills/');
      expect(result.created).toContain('tools/');

      expect(await habitat.isOnboarded()).toBe(true);
    });
  });

  describe('secrets', () => {
    it('should check secret availability from environment', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      // PATH is always set
      expect(habitat.isSecretAvailable('PATH')).toBe(true);
      expect(habitat.isSecretAvailable('DEFINITELY_NOT_SET_XYZZY')).toBe(false);
    });
  });

  describe('state files', () => {
    it('should read and write state files', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      await habitat.writeStateFile('custom-state.json', { counter: 42 });
      const data = await habitat.readStateFile<{ counter: number }>('custom-state.json');
      expect(data?.counter).toBe(42);
    });

    it('should return null for missing state files', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      const data = await habitat.readStateFile('nonexistent.json');
      expect(data).toBeNull();
    });
  });

  describe('work dir files', () => {
    it('should read and write work dir files', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      await habitat.writeWorkDirFile('notes.md', '# My Notes');
      const content = await habitat.readWorkDirFile('notes.md');
      expect(content).toBe('# My Notes');
    });

    it('should return null for missing files', async () => {
      const habitat = await Habitat.create({
        workDir,
        sessionsDir,
        skipBuiltinTools: true,
        skipSkills: true,
      });

      const content = await habitat.readWorkDirFile('nonexistent.md');
      expect(content).toBeNull();
    });
  });
});
