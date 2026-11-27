import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { memorySkillFiles, SkillsExtension } from '@modelcontextprotocol/server/ext/skills';
import { z } from 'zod';
import { createTestMcpServer } from '../mcp/testing.js';
import {
  agentCardCandidates,
  discoverAgentEndpoint,
} from './discover.js';

const servers: Server[] = [];

function listen(server: Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) => new Promise<void>((resolve) => s.close(() => resolve())),
    ),
  );
});

describe('agentCardCandidates', () => {
  it('tries the path-mounted card before the origin well-known', () => {
    expect(agentCardCandidates('https://x.test/agents/jeeves')).toEqual([
      'https://x.test/agents/jeeves/.well-known/agent-card.json',
      'https://x.test/.well-known/agent-card.json',
    ]);
  });

  it('strips a trailing /a2a before appending the well-known path', () => {
    expect(agentCardCandidates('https://x.test/agents/jeeves/a2a')[0]).toBe(
      'https://x.test/agents/jeeves/.well-known/agent-card.json',
    );
  });

  it('uses a pasted agent-card URL verbatim', () => {
    expect(
      agentCardCandidates('https://x.test/.well-known/agent-card.json'),
    ).toEqual(['https://x.test/.well-known/agent-card.json']);
  });
});

describe('discoverAgentEndpoint — A2A', () => {
  it('normalizes an agent card into an EndpointCard', async () => {
    const card = {
      name: 'Jeeves',
      description: 'A valet.',
      version: '1.0.0',
      url: 'http://ignored.test/a2a',
      capabilities: { streaming: true },
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      skills: [{ id: 'general', name: 'General', description: 'Everything.' }],
    };
    const server = createServer((req, res) => {
      if (req.url === '/.well-known/agent-card.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(card));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    const port = await listen(server);

    const result = await discoverAgentEndpoint(`http://127.0.0.1:${port}/`);
    expect(result.kind).toBe('a2a');
    expect(result.name).toBe('Jeeves');
    expect(result.url).toBe('http://ignored.test/a2a');
    expect(result.streaming).toBe(true);
    expect(result.auth).toBe('bearer');
    expect(result.capabilities).toEqual([
      { kind: 'a2a-skill', name: 'General', description: 'Everything.', id: 'general' },
    ]);
  });

  it('marks a card without security schemes as open', async () => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: 'Open Agent', skills: [] }));
    });
    const port = await listen(server);
    const result = await discoverAgentEndpoint(`http://127.0.0.1:${port}/`);
    expect(result.auth).toBe('open');
  });
});

describe('discoverAgentEndpoint — MCP', () => {
  it('negotiates 2026-07-28 and lists tools and MCP skills as distinct capability kinds', async () => {
    const skills = await SkillsExtension.load(
      memorySkillFiles({
        'triage/SKILL.md': '---\nname: triage\ndescription: Triage an incident\n---\nSteps.\n',
      }),
    );
    const mcp = createTestMcpServer({
      name: 'test-mcp',
      version: '9.9.9',
      skills,
      register(server) {
        server.registerTool(
          'add',
          { description: 'Add two numbers', inputSchema: z.object({ a: z.number(), b: z.number() }) },
          async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }),
        );
      },
    });
    const url = await mcp.listen();
    try {
      const result = await discoverAgentEndpoint(url);
      expect(result.kind).toBe('mcp');
      expect(result.name).toBe('test-mcp');
      expect(result.version).toBe('9.9.9');
      expect(result.auth).toBe('open');
      expect((result.raw as { protocolVersion?: string }).protocolVersion).toBe('2026-07-28');
      expect(result.capabilities).toEqual([
        { kind: 'mcp-tool', name: 'add', description: 'Add two numbers' },
        { kind: 'mcp-skill', name: 'triage', description: 'Triage an incident', id: 'skill://triage/SKILL.md' },
      ]);
    } finally {
      await mcp.close();
    }
  });

  it('reports oauth-required on a 401 instead of failing', async () => {
    const server = createServer((req, res) => {
      res.writeHead(401, {
        'www-authenticate':
          'Bearer resource_metadata="http://x.test/.well-known/oauth-protected-resource"',
      });
      res.end();
    });
    const port = await listen(server);

    const result = await discoverAgentEndpoint(`http://127.0.0.1:${port}/mcp`);
    expect(result.kind).toBe('mcp');
    expect(result.auth).toBe('oauth-required');
    expect(result.capabilities).toEqual([]);
  });
});

describe('discoverAgentEndpoint — neither', () => {
  it('throws when the URL answers as neither protocol', async () => {
    const server = createServer((req, res) => {
      res.writeHead(404);
      res.end('not here');
    });
    const port = await listen(server);
    await expect(
      discoverAgentEndpoint(`http://127.0.0.1:${port}/nothing`),
    ).rejects.toThrow(/No agent endpoint found/);
  });

  it('rejects garbage input before probing', async () => {
    await expect(discoverAgentEndpoint('not a url')).rejects.toThrow();
  });
});
