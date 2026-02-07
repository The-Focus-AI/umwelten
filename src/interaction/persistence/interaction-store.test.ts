
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InteractionStore } from './interaction-store.js';
import { Interaction } from '../core/interaction.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import { NormalizedSession, SessionSource, NormalizedSessionEntry } from '../types/normalized-types.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('InteractionStore', () => {
    let store: InteractionStore;
    let testDir: string;

    beforeEach(async () => {
        testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'interaction-store-test-'));
        store = new InteractionStore({ basePath: testDir });
    });

    afterEach(async () => {
        await fs.rm(testDir, { recursive: true, force: true });
    });

    it('should save a normalized session as JSONL', async () => {
        const session: NormalizedSession = {
            id: 'test-session-1',
            source: 'native',
            sourceId: 'test-session-1',
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            messageCount: 2,
            firstPrompt: 'Hello',
            messages: [
                { id: '1', role: 'user', content: 'Hello' },
                { id: '2', role: 'assistant', content: 'Hi there' }
            ]
        };

        await store.saveSession(session);

        const files = await fs.readdir(testDir);
        expect(files).toContain('test-session-1.jsonl');

        const content = await fs.readFile(path.join(testDir, 'test-session-1.jsonl'), 'utf-8');
        const lines = content.trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(JSON.parse(lines[0]).role).toBe('user');
    });

    it('should load a session by ID', async () => {
        const sessionData: NormalizedSession = {
            id: 'test-session-2',
            source: 'native',
            sourceId: 'test-session-2',
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            messageCount: 1,
            firstPrompt: 'Test',
            messages: [
                { id: '1', role: 'user', content: 'Test' }
            ]
        };

        await store.saveSession(sessionData);

        const loaded = await store.loadSession('test-session-2');
        expect(loaded).toBeDefined();
        expect(loaded?.id).toBe('test-session-2');
        expect(loaded?.messages).toHaveLength(1);
        expect(loaded?.messages[0].content).toBe('Test');
    });

    it('should return undefined for non-existent session', async () => {
        const loaded = await store.loadSession('non-existent');
        expect(loaded).toBeUndefined();
    });

    it('should list all sessions', async () => {
        const session1 = {
            id: 'list-test-1',
            source: 'native' as SessionSource,
            sourceId: 'list-test-1',
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            messageCount: 1,
            firstPrompt: 'First',
            messages: [{ id: '1', role: 'user' as const, content: 'First' }]
        };

        const session2 = {
            id: 'list-test-2',
            source: 'native' as SessionSource,
            sourceId: 'list-test-2',
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            messageCount: 1,
            firstPrompt: 'Second',
            messages: [{ id: '2', role: 'user' as const, content: 'Second' }]
        };

        await store.saveSession(session1);
        await store.saveSession(session2);

        const sessions = await store.listSessions();
        expect(sessions).toHaveLength(2);
        expect(sessions.map((s: NormalizedSessionEntry) => s.id).sort()).toEqual(['list-test-1', 'list-test-2']);
    });
});
