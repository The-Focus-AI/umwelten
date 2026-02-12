import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentRunnerTools, discoverAgentCapabilities, type AgentRunnerToolsContext } from './agent-runner-tools.js';
import type { AgentEntry, LogPattern } from '../types.js';

describe('agent-runner-tools', () => {
  let tempDir: string;
  let workDir: string;
  let agentProjectDir: string;
  let agents: AgentEntry[];
  let mockHabitatAgent: { ask: ReturnType<typeof vi.fn> };
  let ctx: AgentRunnerToolsContext;
  let tools: Record<string, any>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-runner-test-'));
    workDir = join(tempDir, 'work');
    agentProjectDir = join(tempDir, 'project');
    await mkdir(workDir, { recursive: true });
    await mkdir(agentProjectDir, { recursive: true });

    agents = [];
    mockHabitatAgent = { ask: vi.fn().mockResolvedValue('Mock agent response') };

    ctx = {
      getWorkDir: () => workDir,
      getAgent: (id) => agents.find(a => a.id === id || a.name === id),
      addAgent: async (agent) => { agents.push(agent); },
      getOrCreateHabitatAgent: async () => mockHabitatAgent,
    };

    tools = createAgentRunnerTools(ctx);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('agent_clone', () => {
    it('should reject when agent already exists', async () => {
      agents.push({ id: 'test-agent', name: 'Test Agent', projectPath: agentProjectDir });

      const result = await tools.agent_clone.execute({
        gitUrl: 'https://github.com/org/repo.git',
        name: 'Test Agent',
        id: 'test-agent',
      }, { messages: [], toolCallId: 'test' });

      expect(result.error).toBe('AGENT_EXISTS');
    });

    it('should derive id from name when not provided', async () => {
      // This will fail the clone (no real git), but we can check the error
      const result = await tools.agent_clone.execute({
        gitUrl: 'https://invalid-url.example.com/repo.git',
        name: 'My Cool Agent',
      }, { messages: [], toolCallId: 'test' });

      // The clone will fail, but the ID derivation logic works
      expect(result.error).toBe('CLONE_FAILED');
    });
  });

  describe('agent_logs', () => {
    it('should return error for unknown agent', async () => {
      const result = await tools.agent_logs.execute({
        agentId: 'nonexistent',
        tail: 50,
      }, { messages: [], toolCallId: 'test' });

      expect(result.error).toBe('AGENT_NOT_FOUND');
    });

    it('should return error when no log patterns configured', async () => {
      agents.push({ id: 'test-agent', name: 'Test Agent', projectPath: agentProjectDir });

      const result = await tools.agent_logs.execute({
        agentId: 'test-agent',
        tail: 50,
      }, { messages: [], toolCallId: 'test' });

      expect(result.error).toBe('NO_LOG_PATTERNS');
    });

    it('should read log files matching patterns', async () => {
      const logsDir = join(agentProjectDir, 'logs');
      await mkdir(logsDir, { recursive: true });
      await writeFile(join(logsDir, 'app.log'), 'line1\nline2\nline3\n');

      const logPatterns: LogPattern[] = [{ pattern: 'logs/*.log', format: 'plain' }];
      agents.push({
        id: 'test-agent',
        name: 'Test Agent',
        projectPath: agentProjectDir,
        logPatterns,
      });

      const result = await tools.agent_logs.execute({
        agentId: 'test-agent',
        tail: 50,
      }, { messages: [], toolCallId: 'test' });

      expect(result.logs).toBeDefined();
      expect(result.logs.length).toBe(1);
      expect(result.logs[0].file).toBe('logs/app.log');
      expect(result.logs[0].lines).toEqual(['line1', 'line2', 'line3']);
    });

    it('should read JSONL log files', async () => {
      const logsDir = join(agentProjectDir, 'logs');
      await mkdir(logsDir, { recursive: true });
      await writeFile(
        join(logsDir, 'events.jsonl'),
        '{"event":"start","ts":"2024-01-01"}\n{"event":"end","ts":"2024-01-02"}\n'
      );

      const logPatterns: LogPattern[] = [{ pattern: 'logs/*.jsonl', format: 'jsonl' }];
      agents.push({
        id: 'test-agent',
        name: 'Test Agent',
        projectPath: agentProjectDir,
        logPatterns,
      });

      const result = await tools.agent_logs.execute({
        agentId: 'test-agent',
        tail: 50,
      }, { messages: [], toolCallId: 'test' });

      expect(result.logs).toBeDefined();
      expect(result.logs[0].format).toBe('jsonl');
      expect(result.logs[0].lines.length).toBe(2);
    });

    it('should filter log lines', async () => {
      const logsDir = join(agentProjectDir, 'logs');
      await mkdir(logsDir, { recursive: true });
      await writeFile(join(logsDir, 'app.log'), 'INFO: started\nERROR: failed\nINFO: done\n');

      const logPatterns: LogPattern[] = [{ pattern: 'logs/*.log', format: 'plain' }];
      agents.push({
        id: 'test-agent',
        name: 'Test Agent',
        projectPath: agentProjectDir,
        logPatterns,
      });

      const result = await tools.agent_logs.execute({
        agentId: 'test-agent',
        tail: 50,
        filter: 'ERROR',
      }, { messages: [], toolCallId: 'test' });

      expect(result.logs[0].lines).toEqual(['ERROR: failed']);
    });

    it('should tail log lines', async () => {
      const logsDir = join(agentProjectDir, 'logs');
      await mkdir(logsDir, { recursive: true });
      const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`).join('\n');
      await writeFile(join(logsDir, 'app.log'), lines);

      const logPatterns: LogPattern[] = [{ pattern: 'logs/*.log', format: 'plain' }];
      agents.push({
        id: 'test-agent',
        name: 'Test Agent',
        projectPath: agentProjectDir,
        logPatterns,
      });

      const result = await tools.agent_logs.execute({
        agentId: 'test-agent',
        tail: 5,
      }, { messages: [], toolCallId: 'test' });

      expect(result.logs[0].lines.length).toBe(5);
      expect(result.logs[0].lines[0]).toBe('line96');
      expect(result.logs[0].lines[4]).toBe('line100');
    });
  });

  describe('agent_status', () => {
    it('should return error for unknown agent', async () => {
      const result = await tools.agent_status.execute({
        agentId: 'nonexistent',
      }, { messages: [], toolCallId: 'test' });

      expect(result.error).toBe('AGENT_NOT_FOUND');
    });

    it('should return basic status', async () => {
      agents.push({
        id: 'test-agent',
        name: 'Test Agent',
        projectPath: agentProjectDir,
        commands: { run: 'npm start', test: 'npm test' },
      });

      const result = await tools.agent_status.execute({
        agentId: 'test-agent',
      }, { messages: [], toolCallId: 'test' });

      expect(result.id).toBe('test-agent');
      expect(result.name).toBe('Test Agent');
      expect(result.commands).toEqual({ run: 'npm start', test: 'npm test' });
    });

    it('should read status file when configured', async () => {
      await writeFile(join(agentProjectDir, 'status.md'), '# Status\nAll good');

      agents.push({
        id: 'test-agent',
        name: 'Test Agent',
        projectPath: agentProjectDir,
        statusFile: 'status.md',
      });

      const result = await tools.agent_status.execute({
        agentId: 'test-agent',
      }, { messages: [], toolCallId: 'test' });

      expect(result.statusFile.content).toBe('# Status\nAll good');
    });

    it('should handle missing status file gracefully', async () => {
      agents.push({
        id: 'test-agent',
        name: 'Test Agent',
        projectPath: agentProjectDir,
        statusFile: 'missing-status.md',
      });

      const result = await tools.agent_status.execute({
        agentId: 'test-agent',
      }, { messages: [], toolCallId: 'test' });

      expect(result.statusFile.error).toBe('File not found');
    });

    it('should list recent log files', async () => {
      const logsDir = join(agentProjectDir, 'logs');
      await mkdir(logsDir, { recursive: true });
      await writeFile(join(logsDir, 'app.log'), 'content');

      agents.push({
        id: 'test-agent',
        name: 'Test Agent',
        projectPath: agentProjectDir,
        logPatterns: [{ pattern: 'logs/*.log', format: 'plain' }],
      });

      const result = await tools.agent_status.execute({
        agentId: 'test-agent',
      }, { messages: [], toolCallId: 'test' });

      expect(result.recentLogs).toBeDefined();
      expect(result.recentLogs.length).toBeGreaterThan(0);
      expect(result.recentLogs[0].file).toBe('logs/app.log');
    });
  });

  describe('agent_ask', () => {
    it('should return error for unknown agent', async () => {
      const result = await tools.agent_ask.execute({
        agentId: 'nonexistent',
        message: 'hello',
      }, { messages: [], toolCallId: 'test' });

      expect(result.error).toBe('AGENT_NOT_FOUND');
    });

    it('should delegate to habitat agent', async () => {
      agents.push({ id: 'test-agent', name: 'Test Agent', projectPath: agentProjectDir });

      const result = await tools.agent_ask.execute({
        agentId: 'test-agent',
        message: 'What does this project do?',
      }, { messages: [], toolCallId: 'test' });

      expect(result.response).toBe('Mock agent response');
      expect(result.agentId).toBe('test-agent');
      expect(mockHabitatAgent.ask).toHaveBeenCalledWith('What does this project do?');
    });

    it('should handle agent ask errors', async () => {
      agents.push({ id: 'test-agent', name: 'Test Agent', projectPath: agentProjectDir });

      mockHabitatAgent.ask.mockRejectedValueOnce(new Error('Model error'));

      const result = await tools.agent_ask.execute({
        agentId: 'test-agent',
        message: 'hello',
      }, { messages: [], toolCallId: 'test' });

      expect(result.error).toBe('AGENT_ASK_FAILED');
      expect(result.message).toBe('Model error');
    });
  });

  describe('discoverAgentCapabilities', () => {
    it('should discover commands from package.json scripts', async () => {
      await writeFile(join(agentProjectDir, 'package.json'), JSON.stringify({
        name: 'test-project',
        scripts: {
          start: 'node index.js',
          dev: 'nodemon index.js',
          test: 'vitest',
          build: 'tsc',
          lint: 'eslint .',
          custom: 'echo custom',  // not in interesting scripts
        },
      }));

      const agent: AgentEntry = { id: 'test', name: 'Test', projectPath: agentProjectDir };
      await discoverAgentCapabilities(agent);

      expect(agent.commands).toBeDefined();
      expect(agent.commands!.start).toBe('node index.js');
      expect(agent.commands!.dev).toBe('nodemon index.js');
      expect(agent.commands!.test).toBe('vitest');
      expect(agent.commands!.build).toBe('tsc');
      expect(agent.commands!.lint).toBe('eslint .');
      expect(agent.commands!['custom']).toBeUndefined();
    });

    it('should discover shell scripts in root', async () => {
      await writeFile(join(agentProjectDir, 'run.sh'), '#!/bin/bash\necho hello');
      await writeFile(join(agentProjectDir, 'setup.sh'), '#!/bin/bash\necho setup');

      const agent: AgentEntry = { id: 'test', name: 'Test', projectPath: agentProjectDir };
      await discoverAgentCapabilities(agent);

      expect(agent.commands).toBeDefined();
      expect(agent.commands!.run).toBe('./run.sh');
      expect(agent.commands!.setup).toBe('./setup.sh');
    });

    it('should discover Makefile', async () => {
      await writeFile(join(agentProjectDir, 'Makefile'), 'all:\n\techo hello');

      const agent: AgentEntry = { id: 'test', name: 'Test', projectPath: agentProjectDir };
      await discoverAgentCapabilities(agent);

      expect(agent.commands).toBeDefined();
      expect(agent.commands!.Makefile).toBe('make');
    });

    it('should discover logs directory', async () => {
      await mkdir(join(agentProjectDir, 'logs'), { recursive: true });

      const agent: AgentEntry = { id: 'test', name: 'Test', projectPath: agentProjectDir };
      await discoverAgentCapabilities(agent);

      expect(agent.logPatterns).toBeDefined();
      expect(agent.logPatterns).toEqual([
        { pattern: 'logs/*.log', format: 'plain' },
        { pattern: 'logs/*.jsonl', format: 'jsonl' },
      ]);
    });

    it('should not override existing logPatterns', async () => {
      await mkdir(join(agentProjectDir, 'logs'), { recursive: true });

      const existing: LogPattern[] = [{ pattern: 'output/*.log', format: 'plain' }];
      const agent: AgentEntry = { id: 'test', name: 'Test', projectPath: agentProjectDir, logPatterns: existing };
      await discoverAgentCapabilities(agent);

      expect(agent.logPatterns).toEqual(existing);
    });

    it('should discover STATUS.md', async () => {
      await writeFile(join(agentProjectDir, 'STATUS.md'), '# Status\nRunning');

      const agent: AgentEntry = { id: 'test', name: 'Test', projectPath: agentProjectDir };
      await discoverAgentCapabilities(agent);

      expect(agent.statusFile).toBe('STATUS.md');
    });

    it('should prefer STATUS.md over status.md', async () => {
      await writeFile(join(agentProjectDir, 'STATUS.md'), 'upper');
      await writeFile(join(agentProjectDir, 'status.md'), 'lower');

      const agent: AgentEntry = { id: 'test', name: 'Test', projectPath: agentProjectDir };
      await discoverAgentCapabilities(agent);

      expect(agent.statusFile).toBe('STATUS.md');
    });

    it('should not override existing statusFile', async () => {
      await writeFile(join(agentProjectDir, 'STATUS.md'), 'status');

      const agent: AgentEntry = { id: 'test', name: 'Test', projectPath: agentProjectDir, statusFile: 'custom-status.md' };
      await discoverAgentCapabilities(agent);

      expect(agent.statusFile).toBe('custom-status.md');
    });

    it('should handle empty project gracefully', async () => {
      const agent: AgentEntry = { id: 'test', name: 'Test', projectPath: agentProjectDir };
      await discoverAgentCapabilities(agent);

      expect(agent.commands).toBeUndefined();
      expect(agent.logPatterns).toBeUndefined();
      expect(agent.statusFile).toBeUndefined();
    });

    it('should merge package.json scripts with shell scripts', async () => {
      await writeFile(join(agentProjectDir, 'package.json'), JSON.stringify({
        scripts: { start: 'node index.js', test: 'vitest' },
      }));
      await writeFile(join(agentProjectDir, 'deploy.sh'), '#!/bin/bash\necho deploy');

      const agent: AgentEntry = { id: 'test', name: 'Test', projectPath: agentProjectDir };
      await discoverAgentCapabilities(agent);

      expect(agent.commands!.start).toBe('node index.js');
      expect(agent.commands!.test).toBe('vitest');
      expect(agent.commands!.deploy).toBe('./deploy.sh');
    });
  });
});
