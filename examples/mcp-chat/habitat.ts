import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Habitat } from '../../src/habitat/index.js';
import { currentTimeTool } from '../../src/habitat/tools/time-tools.js';
import { TezLabMCPManager } from './tezlab-mcp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface MCPChatRuntime {
  habitat: Habitat;
  tezlab: TezLabMCPManager;
}

function envFlag(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export async function createMCPChatRuntime(): Promise<MCPChatRuntime> {
  const tezlab = new TezLabMCPManager({
    serverUrl: process.env.MCP_CHAT_SERVER_URL,
    scope: process.env.MCP_CHAT_SCOPE || 'mcp',
    allowCommands: envFlag('MCP_CHAT_ALLOW_COMMANDS', false),
    oauthPort: process.env.MCP_CHAT_OAUTH_PORT
      ? Number(process.env.MCP_CHAT_OAUTH_PORT)
      : undefined,
    oauthTimeoutMs: process.env.MCP_CHAT_OAUTH_TIMEOUT_MS
      ? Number(process.env.MCP_CHAT_OAUTH_TIMEOUT_MS)
      : undefined,
    authStorePath: process.env.MCP_CHAT_AUTH_STORE,
  });

  const habitat = await Habitat.create({
    envPrefix: 'MCP_CHAT',
    defaultWorkDirName: '.mcp-chat',
    defaultSessionsDirName: '.mcp-chat-sessions',
    stimulusTemplatePath: join(__dirname, 'MCP_CHAT_PROMPT.md'),
    skipBuiltinTools: true,
    skipWorkDirTools: true,
    skipSkills: true,
    registerCustomTools: async (instance) => {
      instance.addTool('current_time', currentTimeTool);
      await tezlab.connect();
      instance.addTools(tezlab.getTools());
    },
  });

  return { habitat, tezlab };
}