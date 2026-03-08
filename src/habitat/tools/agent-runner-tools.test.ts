import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { Interaction } from '../../interaction/core/interaction.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import { createAgentRunnerTools, type AgentRunnerToolsContext } from './agent-runner-tools.js';
import type { AgentEntry, LogPattern } from '../types.js';

const execFileAsync = promisify(execFile);

async function createGitRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'README.md'), '# Test Repo\n');
  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: dir,
  });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], {
    cwd: dir,
  });
  await execFileAsync('git', ['add', '.'], { cwd: dir });
  await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: dir });
}

describe('agent-runner-tools', () => {
  let tempDir: string;
  let workDir: string;
  let agentProjectDir: string;
  let sourceRepoDir: string;
  let agents: AgentEntry[];
  let mockHabitatAgent: {
    ask: ReturnType<typeof vi.fn>;
    getInteraction: ReturnType<typeof vi.fn>;
  };
  let ctx: AgentRunnerToolsContext;
  let tools: Record<string, any>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'agent-runner-test-'));
    workDir = join(tempDir, 'work');
    agentProjectDir = join(tempDir, 'project');
    sourceRepoDir = join(tempDir, 'source-repo');
    await mkdir(workDir, { recursive: true });
    await mkdir(agentProjectDir, { recursive: true });
    await createGitRepo(sourceRepoDir);

    agents = [];
    const mockStimulus = new Stimulus({ role: 'test agent' });
    const mockInteraction = {
      modelDetails: { provider: 'google', name: 'gemini-3-flash-preview' },
      getStimulus: () => mockStimulus,
    };
    mockHabitatAgent = {
      ask: vi.fn().mockResolvedValue('Mock agent response'),
      getInteraction: vi.fn(() => mockInteraction as any),
    };

    ctx = {
      getWorkDir: () => workDir,
      getAgent: (id) => agents.find(a => a.id === id || a.name === id),
      getAgents: () => agents,
      addAgent: async (agent) => { agents.push(agent); },
      updateAgent: async (id, updates) => {
        const agent = agents.find(a => a.id === id);
        if (agent) Object.assign(agent, updates);
      },
      getOrCreateHabitatAgent: async () => mockHabitatAgent,
      startBridge: async () => { throw new Error('Mock: no bridge in test'); },
      getBridgeAgent: () => undefined,
      getAllBridgeAgents: () => [],
      destroyBridgeAgent: async () => {},
      listBridgeAgents: () => [],
      getAgentDir: (id: string) => join(workDir, 'agents', id),
      ensureAgentDir: async (id: string) => {
        await mkdir(join(workDir, 'agents', id, 'logs'), { recursive: true });
      },
      saveBridgeState: async () => {},
      loadBridgeState: async () => null,
      loadAllBridgeStates: async () => [],
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
      const result = await tools.agent_clone.execute({
        gitUrl: sourceRepoDir,
        name: 'My Cool Agent',
      }, { messages: [], toolCallId: 'test' });

      expect(result.registered).toBe(true);
      expect(result.cloned).toBe(true);
      expect(result.agent.id).toBe('my-cool-agent');
      expect(result.agent.projectPath).toBe(
        join(workDir, 'agents', 'my-cool-agent', 'repo')
      );

      const readme = await readFile(
        join(workDir, 'agents', 'my-cool-agent', 'repo', 'README.md'),
        'utf-8'
      );
      expect(readme).toContain('Test Repo');
    });

    it('should return clone error when git clone fails', async () => {
      const result = await tools.agent_clone.execute({
        gitUrl: '/path/that/does/not/exist',
        name: 'Broken Agent',
      }, { messages: [], toolCallId: 'test' });

      expect(result.error).toBe('AGENT_CLONE_FAILED');
      expect(agents).toHaveLength(0);
    });
  });

  describe('agent_register_directory', () => {
    it('should register an existing local directory and store memory in the project when requested', async () => {
      const result = await tools.agent_register_directory.execute({
        projectPath: agentProjectDir,
        memoryInProject: true,
      }, { messages: [], toolCallId: 'test' });

      expect(result.registered).toBe(true);
      expect(result.reused).toBe(false);
      expect(result.agent.projectPath).toBe(agentProjectDir);
      expect(result.agent.memoryPath).toBe(join(agentProjectDir, 'MEMORY.md'));
      expect(agents[0]?.memoryPath).toBe(join(agentProjectDir, 'MEMORY.md'));
    });

    it('should reuse an existing agent for the same project path', async () => {
      agents.push({
        id: 'youtube-feed',
        name: 'youtube-feed',
        projectPath: agentProjectDir,
      });

      const result = await tools.agent_register_directory.execute({
        projectPath: agentProjectDir,
        memoryInProject: true,
      }, { messages: [], toolCallId: 'test' });

      expect(result.registered).toBe(false);
      expect(result.reused).toBe(true);
      expect(result.agent.id).toBe('youtube-feed');
      expect(agents).toHaveLength(1);
      expect(agents[0]?.memoryPath).toBe(join(agentProjectDir, 'MEMORY.md'));
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

  describe('agent_configure', () => {
    it('should configure an agent and persist MEMORY.md', async () => {
      agents.push({
        id: 'test-agent',
        name: 'Test Agent',
        projectPath: agentProjectDir,
        memoryPath: join(agentProjectDir, 'MEMORY.md'),
      });

      const generateTextSpy = vi
        .spyOn(Interaction.prototype, 'generateText')
        .mockResolvedValue({
          content: JSON.stringify({
            purpose: 'Generate TRMNL images',
            summary: 'Runs shell entrypoints to build and publish an image.',
            entrypoints: ['setup.sh', 'run.sh', 'bin/update-display'],
            setupCommand: './setup.sh',
            runCommand: './run.sh',
            requiredEnvVars: [
              { name: 'GEMINI_API_KEY', reason: 'Image generation API key', required: true },
            ],
            requiredCliTools: [
              { name: 'claude', reason: 'setup.sh and parse-data use it', required: true },
              { name: 'magick', reason: 'process-image uses it', required: true },
              { name: 'git', reason: 'run.sh commits and pushes output', required: true },
            ],
            authRequirements: [
              {
                system: 'Claude CLI authentication',
                reason: 'setup.sh and parse-data invoke claude',
                required: true,
                secretRefs: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'],
                cliTools: ['claude'],
                notes: ['An already authenticated host session may also satisfy this on the host.'],
              },
              {
                system: 'GitHub push credentials',
                reason: 'run.sh runs git push to publish output',
                required: true,
                secretRefs: ['GITHUB_TOKEN'],
                cliTools: ['git'],
                notes: ['Host SSH keys or a git credential helper may satisfy this instead of GITHUB_TOKEN.'],
              },
            ],
            hostIntegrations: [
              {
                name: 'chrome-driver plugin cache',
                reason: 'fetch-mohawk-raw references a local extract binary',
                path: '/Users/wschenk/.claude/plugins/cache/focus-marketplace/chrome-driver/0.2.0/bin/extract',
                required: true,
              },
            ],
            logPatterns: [{ pattern: 'logs/*.log', format: 'plain' }],
            recommendedRuntime: 'host',
            notes: ['Uses hardcoded host paths.'],
          }),
        } as any);

      try {
        const result = await tools.agent_configure.execute({
          agentId: 'test-agent',
        }, { messages: [], toolCallId: 'test' });

        expect(result.configured).toBe(true);
        expect(result.contract.runCommand).toBe('./run.sh');
        expect(agents[0].commands).toEqual({
          setup: './setup.sh',
          run: './run.sh',
        });
        expect(agents[0].secrets).toEqual([
          'GEMINI_API_KEY',
          'ANTHROPIC_API_KEY',
          'CLAUDE_CODE_OAUTH_TOKEN',
          'GITHUB_TOKEN',
        ]);
        expect(agents[0].logPatterns).toEqual([
          { pattern: 'logs/*.log', format: 'plain' },
        ]);

        const memory = await readFile(
          join(agentProjectDir, 'MEMORY.md'),
          'utf-8'
        );
        expect(memory).toContain('# Test Agent MEMORY');
        expect(memory).toContain('Generate TRMNL images');
        expect(memory).toContain('- run: ./run.sh');
        expect(memory).toContain('GEMINI_API_KEY');
        expect(memory).toContain('ANTHROPIC_API_KEY');
        expect(memory).toContain('GITHUB_TOKEN');
        expect(memory).toContain('Claude CLI authentication');
      } finally {
        generateTextSpy.mockRestore();
      }
    });

    it('should recover when the model wraps the contract in markdown', async () => {
      agents.push({ id: 'test-agent', name: 'Test Agent', projectPath: agentProjectDir });

      const generateTextSpy = vi
        .spyOn(Interaction.prototype, 'generateText')
        .mockResolvedValue({
          content: [
            '```json',
            JSON.stringify({
              purpose: 'Generate TRMNL images',
              summary: 'Runs the repo shell scripts on the host.',
              entrypoints: ['run.sh'],
              setupCommand: './setup.sh',
              runCommand: './run.sh',
              requiredEnvVars: [
                { name: 'GEMINI_API_KEY', reason: 'Gemini image generation', required: true },
              ],
              requiredCliTools: [
                { name: 'claude', reason: 'setup.sh invokes claude', required: true },
              ],
              authRequirements: [
                {
                  system: 'Claude CLI authentication',
                  reason: 'claude must be authenticated before setup can work',
                  required: true,
                  secretRefs: ['ANTHROPIC_API_KEY'],
                  cliTools: ['claude'],
                  notes: [],
                },
              ],
              hostIntegrations: [],
              logPatterns: [],
              recommendedRuntime: 'host',
              notes: [],
            }),
            '```',
          ].join('\n'),
        } as any);

      try {
        const result = await tools.agent_configure.execute({
          agentId: 'test-agent',
        }, { messages: [], toolCallId: 'test' });

        expect(result.configured).toBe(true);
        expect(agents[0].secrets).toEqual(['GEMINI_API_KEY', 'ANTHROPIC_API_KEY']);
      } finally {
        generateTextSpy.mockRestore();
      }
    });
  });

  describe('tool registration', () => {
    it('should include all expected tools', () => {
      expect(tools.agent_register_directory).toBeDefined();
      expect(tools.agent_clone).toBeDefined();
      expect(tools.agent_logs).toBeDefined();
      expect(tools.agent_status).toBeDefined();
      expect(tools.agent_ask).toBeDefined();
      expect(tools.agent_configure).toBeDefined();
      expect(tools.bridge_start).toBeDefined();
      expect(tools.bridge_stop).toBeDefined();
      expect(tools.bridge_list).toBeDefined();
      expect(tools.bridge_ls).toBeDefined();
      expect(tools.bridge_read).toBeDefined();
      expect(tools.bridge_exec).toBeDefined();
    });

    it('should not include removed tools', () => {
      expect(tools.bridge_diagnose).toBeUndefined();
      expect(tools.bridge_apply_provisioning).toBeUndefined();
      expect(tools.bridge_monitor).toBeUndefined();
    });
  });
});
