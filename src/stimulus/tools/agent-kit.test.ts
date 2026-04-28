import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentKit } from './agent-kit.js';

const callCtx = { messages: [] as any[], toolCallId: 'test' };

async function exec(tool: any, args: any) {
  return await tool.execute(args, callCtx);
}

describe('createAgentKit', () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = join(tmpdir(), `umwelten-agent-kit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(workspaceDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(workspaceDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('filesystem tools', () => {
    it('write + read inside workspace works', async () => {
      const kit = await createAgentKit({ workspaceDir });
      const w = await exec(kit.tools.write, { path: 'note.md', content: 'hello' });
      expect(w.written).toBe(true);

      const r = await exec(kit.tools.read, { path: 'note.md' });
      expect(r.content).toBe('hello');
    });

    it('create_directory creates nested dirs', async () => {
      const kit = await createAgentKit({ workspaceDir });
      const m = await exec(kit.tools.create_directory, { path: 'a/b/c' });
      expect(m.created).toBe(true);

      const list = await exec(kit.tools.list_directory, { path: 'a/b' });
      expect(list.entries.some((e: any) => e.name === 'c' && e.isDir)).toBe(true);
    });

    it('list_directory shows the workspace root with "."', async () => {
      const kit = await createAgentKit({ workspaceDir });
      await exec(kit.tools.write, { path: 'foo.txt', content: 'x' });
      const list = await exec(kit.tools.list_directory, { path: '.' });
      expect(list.entries.some((e: any) => e.name === 'foo.txt')).toBe(true);
    });

    it('absolute path with double-slash bypasses chroot and is rejected', async () => {
      // Single leading "/" is treated as the virtual workspace root (chroot-style).
      // Use "//" to force a real absolute path that escapes the sandbox.
      const kit = await createAgentKit({ workspaceDir });
      const r = await exec(kit.tools.read, { path: '//etc/passwd' });
      expect(r.error).toMatch(/OUTSIDE_ALLOWED_PATH/);
    });

    it('write with .. traversal escaping workspace returns OUTSIDE_ALLOWED_PATH', async () => {
      const kit = await createAgentKit({ workspaceDir });
      const r = await exec(kit.tools.write, { path: '../escape.txt', content: 'nope' });
      expect(r.error).toMatch(/OUTSIDE_ALLOWED_PATH/);
    });

    it('extraRoots lets read/list reach a sibling directory via absolute path', async () => {
      // Set up a sibling "repo" the agent can inspect but not the workspace's parent.
      const sibling = `${workspaceDir}-extra`;
      await mkdir(sibling, { recursive: true });
      await writeFile(join(sibling, 'README.md'), '# extra root', 'utf-8');
      try {
        const kit = await createAgentKit({ workspaceDir, extraRoots: [sibling] });
        const r = await exec(kit.tools.read, { path: join(sibling, 'README.md') });
        expect(r.content).toBe('# extra root');

        const list = await exec(kit.tools.list_directory, { path: sibling });
        expect(list.entries.some((e: any) => e.name === 'README.md')).toBe(true);
      } finally {
        await rm(sibling, { recursive: true, force: true });
      }
    });
  });

  describe('bash tool', () => {
    it('runs with cwd set to workspace and returns exitCode 0', async () => {
      const kit = await createAgentKit({ workspaceDir });
      const r = await exec(kit.tools.bash, { command: 'pwd' });
      expect(r.exitCode).toBe(0);
      // macOS resolves /var/folders/... → /private/var/folders/...; compare via realpath.
      const expected = await realpath(workspaceDir);
      expect(r.stdout.trim()).toBe(expected);
    });

    it('propagates non-zero exit codes', async () => {
      const kit = await createAgentKit({ workspaceDir });
      const r = await exec(kit.tools.bash, { command: 'exit 7' });
      expect(r.exitCode).toBe(7);
    });

    it('captures stderr', async () => {
      const kit = await createAgentKit({ workspaceDir });
      const r = await exec(kit.tools.bash, { command: 'echo oops 1>&2; exit 1' });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/oops/);
    });
  });

  describe('AGENTS.md auto-load', () => {
    it('returns systemContext when AGENTS.md exists', async () => {
      await writeFile(join(workspaceDir, 'AGENTS.md'), '# Be helpful', 'utf-8');
      const kit = await createAgentKit({ workspaceDir });
      expect(kit.systemContext).toBe('# Be helpful');
    });

    it('returns undefined when AGENTS.md is absent', async () => {
      const kit = await createAgentKit({ workspaceDir });
      expect(kit.systemContext).toBeUndefined();
    });

    it('honors agentsMdPath override', async () => {
      const custom = join(workspaceDir, 'CUSTOM.md');
      await writeFile(custom, 'override content', 'utf-8');
      const kit = await createAgentKit({ workspaceDir, agentsMdPath: custom });
      expect(kit.systemContext).toBe('override content');
    });
  });

  describe('skills auto-discovery', () => {
    it('skills tool is registered when skills/ contains a SKILL.md', async () => {
      const skillDir = join(workspaceDir, 'skills', 'demo');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---\nname: demo\ndescription: A demo skill\n---\n\nFollow these steps.\n`,
        'utf-8'
      );
      const kit = await createAgentKit({ workspaceDir });
      expect(kit.skills).toContain('demo');
      expect(kit.tools.skill).toBeDefined();
    });

    it('skills tool is absent when skills/ is missing', async () => {
      const kit = await createAgentKit({ workspaceDir });
      expect(kit.skills).toEqual([]);
      expect(kit.tools.skill).toBeUndefined();
    });

    it('skills tool is absent when skills/ exists but is empty', async () => {
      await mkdir(join(workspaceDir, 'skills'), { recursive: true });
      const kit = await createAgentKit({ workspaceDir });
      expect(kit.skills).toEqual([]);
      expect(kit.tools.skill).toBeUndefined();
    });
  });
});
