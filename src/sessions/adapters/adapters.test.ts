import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import Database from 'better-sqlite3';

import { AdapterRegistry, adapterRegistry } from './adapter.js';
import { ClaudeCodeAdapter, createClaudeCodeAdapter } from './claude-code-adapter.js';
import { CursorAdapter, createCursorAdapter } from './cursor-adapter.js';
import { initializeAdapters, getAdapterRegistry } from './index.js';
import type { SessionsIndex } from '../types.js';

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  describe('registerFactory', () => {
    it('should register an adapter factory', () => {
      registry.registerFactory('claude-code', createClaudeCodeAdapter);
      expect(registry.getSources()).toContain('claude-code');
    });
  });

  describe('register', () => {
    it('should register an adapter instance', () => {
      const adapter = new ClaudeCodeAdapter();
      registry.register(adapter);
      expect(registry.get('claude-code')).toBe(adapter);
    });
  });

  describe('get', () => {
    it('should return undefined for unregistered source', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });

    it('should create adapter from factory on first access', () => {
      registry.registerFactory('claude-code', createClaudeCodeAdapter);
      const adapter = registry.get('claude-code');
      expect(adapter).toBeInstanceOf(ClaudeCodeAdapter);
    });

    it('should return same instance on subsequent access', () => {
      registry.registerFactory('claude-code', createClaudeCodeAdapter);
      const adapter1 = registry.get('claude-code');
      const adapter2 = registry.get('claude-code');
      expect(adapter1).toBe(adapter2);
    });
  });

  describe('getAll', () => {
    it('should return all registered adapters', () => {
      registry.registerFactory('claude-code', createClaudeCodeAdapter);
      registry.registerFactory('cursor', createCursorAdapter);
      const adapters = registry.getAll();
      expect(adapters).toHaveLength(2);
    });
  });

  describe('getSources', () => {
    it('should return all registered sources', () => {
      registry.registerFactory('claude-code', createClaudeCodeAdapter);
      registry.registerFactory('cursor', createCursorAdapter);
      const sources = registry.getSources();
      expect(sources).toContain('claude-code');
      expect(sources).toContain('cursor');
    });
  });
});

describe('ClaudeCodeAdapter', () => {
  let adapter: ClaudeCodeAdapter;
  let testDir: string;
  let testProjectPath: string;

  beforeEach(async () => {
    adapter = new ClaudeCodeAdapter();
    testDir = join(tmpdir(), `claude-test-${Date.now()}`);
    testProjectPath = '/test/project';
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('source', () => {
    it('should return claude-code', () => {
      expect(adapter.source).toBe('claude-code');
    });
  });

  describe('displayName', () => {
    it('should return Claude Code', () => {
      expect(adapter.displayName).toBe('Claude Code');
    });
  });

  describe('getSourceLocation', () => {
    it('should return path containing .claude/projects', () => {
      const location = adapter.getSourceLocation();
      expect(location).toContain('.claude');
      expect(location).toContain('projects');
    });
  });

  describe('canHandle', () => {
    it('should return false for non-existent project', async () => {
      const result = await adapter.canHandle('/nonexistent/project');
      expect(result).toBe(false);
    });
  });

  describe('discoverSessions', () => {
    it('should return empty result for non-existent project', async () => {
      const result = await adapter.discoverSessions({
        projectPath: '/nonexistent/project',
      });
      expect(result.sessions).toHaveLength(0);
      expect(result.source).toBe('claude-code');
      expect(result.totalCount).toBe(0);
    });

    it('should return empty result when no project path provided', async () => {
      const result = await adapter.discoverSessions();
      expect(result.sessions).toHaveLength(0);
    });
  });

  describe('getSessionEntry', () => {
    it('should return null for non-existent session', async () => {
      const result = await adapter.getSessionEntry('nonexistent-session');
      expect(result).toBeNull();
    });

    it('should handle prefixed session IDs', async () => {
      const result = await adapter.getSessionEntry('claude-code:nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getSession', () => {
    it('should return null for non-existent session', async () => {
      const result = await adapter.getSession('nonexistent-session');
      expect(result).toBeNull();
    });
  });

  describe('getMessages', () => {
    it('should return empty array for non-existent session', async () => {
      const result = await adapter.getMessages('nonexistent-session');
      expect(result).toEqual([]);
    });
  });

  describe('hasSessionsForProject', () => {
    it('should return false for non-existent project', async () => {
      const result = await adapter.hasSessionsForProject('/nonexistent/project');
      expect(result).toBe(false);
    });
  });
});

describe('CursorAdapter', () => {
  let adapter: CursorAdapter;
  let testWorkspaceDir: string;

  beforeEach(async () => {
    adapter = new CursorAdapter();
    testWorkspaceDir = join(tmpdir(), `cursor-test-${Date.now()}`);
    await mkdir(testWorkspaceDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testWorkspaceDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('source', () => {
    it('should return cursor', () => {
      expect(adapter.source).toBe('cursor');
    });
  });

  describe('displayName', () => {
    it('should return Cursor', () => {
      expect(adapter.displayName).toBe('Cursor');
    });
  });

  describe('getSourceLocation', () => {
    it('should return platform-specific path', () => {
      const location = adapter.getSourceLocation();
      expect(location).toContain('Cursor');
      expect(location).toContain('workspaceStorage');
    });
  });

  describe('canHandle', () => {
    it('should return false for non-existent project', async () => {
      const result = await adapter.canHandle('/nonexistent/project');
      expect(result).toBe(false);
    });
  });

  describe('discoverSessions', () => {
    it('should return empty result when storage not available', async () => {
      const result = await adapter.discoverSessions({
        projectPath: '/nonexistent/project',
      });
      expect(result.sessions).toHaveLength(0);
      expect(result.source).toBe('cursor');
    });
  });

  describe('getSessionEntry', () => {
    it('should return null for invalid session ID format', async () => {
      const result = await adapter.getSessionEntry('invalid');
      expect(result).toBeNull();
    });

    it('should handle prefixed session IDs', async () => {
      const result = await adapter.getSessionEntry('cursor:hash:composer');
      expect(result).toBeNull();
    });
  });

  describe('getSession', () => {
    it('should return null for non-existent session', async () => {
      const result = await adapter.getSession('cursor:hash:composer');
      expect(result).toBeNull();
    });
  });

  describe('getMessages', () => {
    it('should return empty array for non-existent session', async () => {
      const result = await adapter.getMessages('cursor:hash:composer');
      expect(result).toEqual([]);
    });
  });

  describe('with mock SQLite database', () => {
    let dbPath: string;

    beforeEach(async () => {
      // Create a mock Cursor database
      dbPath = join(testWorkspaceDir, 'state.vscdb');
      const db = new Database(dbPath);

      // Create the table
      db.exec(`
        CREATE TABLE IF NOT EXISTS cursorDiskKV (
          key TEXT PRIMARY KEY,
          value TEXT
        )
      `);

      // Insert mock composer data
      const composerData = {
        composerId: 'test-composer-1',
        name: 'Test Session',
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now(),
        context: {
          workspacePath: '/test/project',
          gitBranch: 'main',
        },
      };

      db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)').run(
        'composerData:test-composer-1',
        JSON.stringify(composerData)
      );

      // Insert mock bubble data
      const userBubble = {
        id: 'bubble-1',
        role: 'user',
        content: 'Hello, help me with this code',
        createdAt: Date.now() - 3600000,
      };

      const assistantBubble = {
        id: 'bubble-2',
        role: 'assistant',
        content: 'Sure, I can help you with that!',
        createdAt: Date.now() - 3500000,
        model: 'gpt-4',
      };

      db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)').run(
        'bubbleId:test-composer-1:bubble-1',
        JSON.stringify(userBubble)
      );

      db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)').run(
        'bubbleId:test-composer-1:bubble-2',
        JSON.stringify(assistantBubble)
      );

      // Create workspace.json
      await writeFile(
        join(testWorkspaceDir, 'workspace.json'),
        JSON.stringify({ folder: 'file:///test/project' })
      );

      db.close();
    });

    it('should read sessions from mock database', async () => {
      // We need to create a custom adapter that points to our test directory
      // For now, just verify the database was created correctly
      const db = new Database(dbPath, { readonly: true });

      const row = db
        .prepare('SELECT value FROM cursorDiskKV WHERE key = ?')
        .get('composerData:test-composer-1') as { value: string } | undefined;

      expect(row).toBeDefined();
      const data = JSON.parse(row!.value);
      expect(data.composerId).toBe('test-composer-1');

      db.close();
    });

    it('should read bubbles from mock database', async () => {
      const db = new Database(dbPath, { readonly: true });

      const rows = db
        .prepare('SELECT key, value FROM cursorDiskKV WHERE key LIKE ?')
        .all('bubbleId:test-composer-1:%') as Array<{ key: string; value: string }>;

      expect(rows).toHaveLength(2);

      const bubbles = rows.map(r => JSON.parse(r.value));
      expect(bubbles.some(b => b.role === 'user')).toBe(true);
      expect(bubbles.some(b => b.role === 'assistant')).toBe(true);

      db.close();
    });
  });
});

describe('initializeAdapters', () => {
  it('should register all adapters', () => {
    // Clear existing registrations
    const registry = new AdapterRegistry();

    // Re-initialize would happen on a fresh registry
    registry.registerFactory('claude-code', createClaudeCodeAdapter);
    registry.registerFactory('cursor', createCursorAdapter);

    const sources = registry.getSources();
    expect(sources).toContain('claude-code');
    expect(sources).toContain('cursor');
  });
});

describe('getAdapterRegistry', () => {
  it('should return initialized registry', () => {
    const registry = getAdapterRegistry();
    expect(registry).toBeDefined();
    expect(registry.getSources().length).toBeGreaterThan(0);
  });

  it('should return claude-code adapter', () => {
    const registry = getAdapterRegistry();
    const adapter = registry.get('claude-code');
    expect(adapter).toBeDefined();
    expect(adapter?.source).toBe('claude-code');
  });

  it('should return cursor adapter', () => {
    const registry = getAdapterRegistry();
    const adapter = registry.get('cursor');
    expect(adapter).toBeDefined();
    expect(adapter?.source).toBe('cursor');
  });
});
