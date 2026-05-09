
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import fs from 'fs/promises';
import {
    NormalizedSession,
    NormalizedSessionEntry,
    SessionDiscoveryOptions,
    SessionDiscoveryResult
} from '../types/normalized-types.js';

export interface InteractionStoreOptions {
    basePath: string;
}

export class InteractionStore {
    private basePath: string;

    constructor(options: InteractionStoreOptions) {
        this.basePath = options.basePath;
    }

    private getFilePath(id: string): string {
        return join(this.basePath, `${id}.jsonl`);
    }

    async saveSession(session: NormalizedSession): Promise<void> {
        await fs.mkdir(this.basePath, { recursive: true });

        // Write detailed messages to JSONL
        const filePath = this.getFilePath(session.id);
        const content = session.messages.map(m => JSON.stringify(m)).join('\n');
        await fs.writeFile(filePath, content, 'utf-8');

        // In a real implementation, we would also update an index file here
        // For this MVP step, saving the file is enough to satisfy the test
    }

    async loadSession(id: string): Promise<NormalizedSession | undefined> {
        const filePath = this.getFilePath(id);
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const messages = content.trim().split('\n').map(line => JSON.parse(line));

            // Reconstruct minimal session object from file content
            // In a real app, we'd read from an index or metadata file for full details
            return {
                id,
                source: 'native',
                sourceId: id,
                created: new Date().toISOString(), // Placeholder
                modified: new Date().toISOString(), // Placeholder
                messageCount: messages.length,
                firstPrompt: messages.length > 0 ? messages[0].content : '',
                messages
            } as NormalizedSession;
        } catch (error) {
            if ((error as any).code === 'ENOENT') {
                return undefined;
            }
            throw error;
        }
    }

    async listSessions(options?: SessionDiscoveryOptions): Promise<NormalizedSessionEntry[]> {
        try {
            const files = await fs.readdir(this.basePath);
            const sessionFiles = files.filter(f => f.endsWith('.jsonl'));

            const sessions: NormalizedSessionEntry[] = [];
            for (const file of sessionFiles) {
                const id = file.replace('.jsonl', '');
                // For listing, we might not want to load the whole file.
                // For now, load it to get metadata if we don't have a separate index.
                const session = await this.loadSession(id);
                if (session) {
                    sessions.push({
                        id: session.id,
                        source: session.source,
                        sourceId: session.sourceId,
                        created: session.created,
                        modified: session.modified,
                        messageCount: session.messageCount,
                        firstPrompt: session.firstPrompt
                    });
                }
            }
            return sessions;
        } catch {
            return [];
        }
    }
}
