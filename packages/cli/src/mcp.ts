import { Command } from 'commander';
import chalk from 'chalk';
import {
  createQuickMCPConnection,
} from '@umwelten/protocols/mcp/integration/stimulus.js';
import { createSSEConfig, createWebSocketConfig } from '@umwelten/protocols/mcp/client/client.js';
import type { TransportConfig } from '@umwelten/protocols/mcp/types/transport.js';
import { createMarkdownChatObserver } from '@umwelten/core/cognition/observers.js';

/**
 * CLI Commands for MCP (Model Context Protocol) functionality
 * 
 * Provides commands for:
 * - Connecting to external MCP servers
 * - Testing MCP connections
 * - Managing MCP tools and resources
 * - Creating MCP servers
 */

// =============================================================================
// MCP Client Commands
// =============================================================================

export const mcpCommand = new Command('mcp')
  .description('Model Context Protocol (MCP) client and server commands');

type MCPConnectionOptions = {
  transport?: string;
  command?: string;
  args?: string[];
  env?: string[];
  url?: string;
  header?: string[];
  protocol?: string[];
};

function parseKeyValueOptions(values?: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const entry of values || []) {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1);

    if (key) {
      parsed[key] = value;
    }
  }

  return parsed;
}

function addConnectionOptions(command: Command): Command {
  return command
    .option('--transport <type>', 'Transport type: stdio, sse, websocket', 'stdio')
    .option('-c, --command <command>', 'Server command to execute for stdio transport')
    .option('-a, --args <args...>', 'Arguments to pass to the server command')
    .option('-e, --env <env...>', 'Environment variables for stdio transport (KEY=VALUE format)')
    .option('--url <url>', 'Remote server URL for sse/websocket transport')
    .option('-H, --header <header...>', 'Headers for remote transports (KEY=VALUE format)')
    .option('--protocol <protocol...>', 'WebSocket subprotocols');
}

function resolveTransportConfig(options: MCPConnectionOptions): TransportConfig {
  const transport = (options.transport || 'stdio').toLowerCase();

  switch (transport) {
    case 'stdio':
      if (!options.command) {
        throw new Error('The --command option is required for stdio transport');
      }

      return {
        type: 'stdio',
        command: options.command,
        args: options.args,
        env: parseKeyValueOptions(options.env),
      };

    case 'sse':
      if (!options.url) {
        throw new Error('The --url option is required for sse transport');
      }

      return createSSEConfig(options.url, parseKeyValueOptions(options.header));

    case 'websocket':
      if (!options.url) {
        throw new Error('The --url option is required for websocket transport');
      }

      return createWebSocketConfig(
        options.url,
        options.protocol,
        parseKeyValueOptions(options.header),
      );

    default:
      throw new Error(`Unsupported transport type: ${transport}`);
  }
}

function describeConnection(options: MCPConnectionOptions): string {
  const transport = (options.transport || 'stdio').toLowerCase();

  if (transport === 'stdio') {
    return `Transport: stdio\n${chalk.gray(`Command: ${options.command} ${(options.args || []).join(' ')}`)}`;
  }

  return `Transport: ${transport}\n${chalk.gray(`URL: ${options.url}`)}`;
}

// MCP Connect Command
addConnectionOptions(
  mcpCommand
  .command('connect')
  .description('Connect to an MCP server and list available tools/resources')
  .option('--timeout <seconds>', 'Connection timeout in seconds', '30')
)
  .action(async (options) => {
    try {
      console.log(chalk.blue('🔌 Connecting to MCP server...'));
      console.log(describeConnection(options));

      const manager = await createQuickMCPConnection(resolveTransportConfig(options));

      console.log(chalk.green('✅ Connected to MCP server!'));

      // Get server info
      const serverInfo = manager.getServerInfo();
      if (serverInfo.info) {
        console.log(chalk.yellow('\n📋 Server Information:'));
        console.log(`  Name: ${serverInfo.info.name}`);
        console.log(`  Version: ${serverInfo.info.version}`);
      }

      // List available tools
      const tools = manager.getAvailableTools();
      console.log(chalk.yellow(`\n🔧 Available Tools (${tools.length}):`));
      if (tools.length === 0) {
        console.log(chalk.gray('  No tools available'));
      } else {
        for (const tool of tools) {
          console.log(`  ${chalk.cyan(tool.name)}: ${tool.description}`);
          if (tool.metadata?.tags) {
            console.log(chalk.gray(`    Tags: ${tool.metadata.tags.join(', ')}`));
          }
        }
      }

      // List available resources
      const resources = manager.getAvailableResources();
      console.log(chalk.yellow(`\n📚 Available Resources (${resources.length}):`));
      if (resources.length === 0) {
        console.log(chalk.gray('  No resources available'));
      } else {
        for (const resource of resources) {
          console.log(`  ${chalk.cyan(resource.uri)}: ${resource.name}`);
          if (resource.description) {
            console.log(chalk.gray(`    ${resource.description}`));
          }
        }
      }

      await manager.disconnect();
      console.log(chalk.green('\n✨ Disconnected from MCP server'));

    } catch (error) {
      console.error(chalk.red('❌ Failed to connect to MCP server:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// MCP Test Tool Command
addConnectionOptions(
  mcpCommand
  .command('test-tool')
  .description('Test a specific tool from an MCP server')
  .requiredOption('-t, --tool <toolName>', 'Name of the tool to test')
  .option('-p, --params <params>', 'Tool parameters as JSON string', '{}')
)
  .action(async (options) => {
    try {
      console.log(chalk.blue(`🧪 Testing tool "${options.tool}"...`));

      const manager = await createQuickMCPConnection(resolveTransportConfig(options));

      // Parse tool parameters
      let toolParams: Record<string, any> = {};
      try {
        toolParams = JSON.parse(options.params);
      } catch (error) {
        console.error(chalk.red('❌ Invalid JSON in tool parameters'));
        process.exit(1);
      }

      // Check if tool exists
      if (!manager.hasToolAvailable(options.tool)) {
        console.error(chalk.red(`❌ Tool "${options.tool}" not found`));
        
        const availableTools = manager.getAvailableTools();
        if (availableTools.length > 0) {
          console.log(chalk.yellow('\n🔧 Available tools:'));
          for (const tool of availableTools) {
            console.log(`  ${chalk.cyan(tool.name)}`);
          }
        }
        
        await manager.disconnect();
        process.exit(1);
      }

      // Execute the tool
      const tool = manager.getTool(options.tool)!;
      console.log(chalk.gray(`Executing with parameters: ${JSON.stringify(toolParams)}`));

      const startTime = Date.now();
      const result = await tool.execute(toolParams, {
        toolCallId: `test-${Date.now()}`,
        messages: [],
      });
      const executionTime = Date.now() - startTime;

      console.log(chalk.green('\n✅ Tool execution completed!'));
      console.log(chalk.yellow('📋 Result:'));
      console.log(chalk.gray(`Execution time: ${executionTime}ms`));
      console.log(chalk.gray(`Success: ${result.metadata?.success}`));
      
      if (result.metadata?.warnings) {
        console.log(chalk.yellow(`Warnings: ${result.metadata.warnings.join(', ')}`));
      }
      
      console.log('\n📄 Output:');
      console.log(result.result);

      await manager.disconnect();

    } catch (error) {
      console.error(chalk.red('❌ Tool execution failed:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// MCP Read Resource Command
addConnectionOptions(
  mcpCommand
  .command('read-resource')
  .description('Read a resource from an MCP server')
  .requiredOption('-u, --uri <uri>', 'URI of the resource to read')
)
  .action(async (options) => {
    try {
      console.log(chalk.blue(`📖 Reading resource "${options.uri}"...`));

      const manager = await createQuickMCPConnection(resolveTransportConfig(options));

      const content = await manager.readResource(options.uri);

      console.log(chalk.green('✅ Resource read successfully!'));
      console.log(chalk.yellow('\n📄 Content:'));
      console.log(content);

      await manager.disconnect();

    } catch (error) {
      console.error(chalk.red('❌ Failed to read resource:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// =============================================================================
// MCP Chat Command — connect to a remote MCP server and chat
// =============================================================================

mcpCommand
  .command('chat')
  .description('Connect to a remote MCP server with OAuth and start an interactive chat')
  .requiredOption('--url <url>', 'Remote MCP server URL (e.g. https://oura-mcp.fly.dev/mcp)')
  .option('-p, --provider <name>', 'LLM provider', 'google')
  .option('-m, --model <name>', 'Model name', 'gemini-3-flash-preview')
  .option('--scope <scope>', 'OAuth scope', 'mcp')
  .option('--oauth-port <port>', 'Local port for OAuth callback', '3339')
  .option('--logout', 'Clear stored OAuth credentials for this server')
  .option('--one-shot <prompt>', 'Send a single prompt and exit')
  .option('--max-steps <n>', 'Max LLM+tool steps per turn', '100')
  .action(async (opts: {
    url: string;
    provider: string;
    model: string;
    scope: string;
    oauthPort: string;
    logout?: boolean;
    oneShot?: string;
    maxSteps: string;
  }) => {
    const { RemoteMcpClient } = await import('@umwelten/protocols/mcp/client/remote.js');
    const { Interaction } = await import('@umwelten/core/interaction/core/interaction.js');
    const { Stimulus } = await import('@umwelten/core/stimulus/stimulus.js');
    const { createInterface } = await import('node:readline');
    const { join } = await import('node:path');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { homedir } = await import('node:os');
    const { writeSessionTranscript } = await import('@umwelten/habitat/transcript.js');
    const { estimateContextSize } = await import('@umwelten/core/context/estimate-size.js');
    const { listCompactionStrategies } = await import('@umwelten/core/context/registry.js');

    const mcp = new RemoteMcpClient({
      serverUrl: opts.url,
      scope: opts.scope,
      oauthPort: parseInt(opts.oauthPort, 10),
    });

    if (opts.logout) {
      await mcp.resetAuth();
      console.log(`Cleared OAuth credentials for ${opts.url}`);
      console.log(`Auth file was: ${mcp.authStorePath}`);
      return;
    }

    // Set up session directory for transcript persistence
    let sessionId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const sessionsBase = join(homedir(), '.umwelten', 'mcp-sessions');
    let sessionDir = join(sessionsBase, sessionId);
    mkdirSync(sessionDir, { recursive: true });

    // Write session metadata
    writeFileSync(join(sessionDir, 'meta.json'), JSON.stringify({
      id: sessionId,
      server: opts.url,
      provider: opts.provider,
      model: opts.model,
      createdAt: new Date().toISOString(),
    }, null, 2));

    console.log(`Connecting to ${opts.url}...`);
    await mcp.connect();

    const toolNames = mcp.getToolNames();
    console.log(`Connected. ${chalk.green(String(toolNames.length))} tools available:`);
    // Show tool names in a compact grid, with short descriptions
    for (const name of toolNames) {
      const desc = mcp.getToolDescription(name);
      // Truncate description to first sentence or 80 chars
      const shortDesc = desc
        ? desc.split(/\.\s/)[0].slice(0, 80) + (desc.length > 80 ? '...' : '')
        : '';
      console.log(`  ${chalk.green(name)}${shortDesc ? ` ${chalk.dim('—')} ${chalk.dim(shortDesc)}` : ''}`);
    }
    console.log('');
    console.log(chalk.dim(`Session: ${sessionDir}`));
    console.log('');

    const today = new Date().toISOString().split('T')[0];
    const stimulus = new Stimulus({
      role: `You are a helpful assistant with access to remote MCP tools. Use them to answer questions. Today's date is ${today}.`,
      tools: mcp.getTools(),
    });

    const interaction = new Interaction(
      { name: opts.model, provider: opts.provider },
      stimulus,
    );
    interaction.setMaxSteps(parseInt(opts.maxSteps, 10));

    // Save transcript after each turn
    const saveTranscript = async () => {
      try {
        await writeSessionTranscript(sessionDir, interaction.getMessages());
      } catch {
        // Non-fatal — don't interrupt the chat
      }
    };

    // One-shot mode
    if (opts.oneShot) {
      interaction.addMessage({ role: 'user', content: opts.oneShot });
      const obs = await createMarkdownChatObserver();
      await interaction.streamText(undefined, obs);
      obs.end();
      process.stdout.write('\n');
      await saveTranscript();
      await mcp.disconnect();
      return;
    }

    // REPL mode with abort support
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    let currentAbort: AbortController | null = null;
    let isStreaming = false;

    // Listen for raw keypress events for Escape during streaming
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false); // readline manages raw mode
    }

    // Intercept Escape key — readline emits 'keypress' events
    const onKeypress = (_ch: string, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
      if (!isStreaming) return;
      if (key?.name === 'escape' || key?.sequence === '\x1b') {
        if (currentAbort) {
          process.stdout.write(chalk.dim('\n  ⏹ aborted\n'));
          currentAbort.abort();
          currentAbort = null;
        }
      }
    };
    process.stdin.on('keypress', onKeypress);

    // Context size helper
    const getContextStatus = (): string => {
      const est = estimateContextSize(interaction.getMessages());
      const msgs = est.messageCount;
      const tokens = est.estimatedTokens;
      if (tokens > 1000) {
        return `${msgs} msgs ~${(tokens / 1000).toFixed(1)}k tokens`;
      }
      return `${msgs} msgs ~${tokens} tokens`;
    };

    // Prompt with context info
    const getPrompt = (): string => {
      const ctx = getContextStatus();
      return `${chalk.dim(`[${ctx}]`)} ${chalk.bold('You: ')}`;
    };

    const showHelp = () => {
      console.log(`
${chalk.bold('Commands:')}
  ${chalk.green('/help')}       Show this help
  ${chalk.green('/tools')}      List available MCP tools
  ${chalk.green('/context')}    Show context size details
  ${chalk.green('/compact')}    Compact context (reduce token usage)
  ${chalk.green('/new')}        Start fresh conversation (same session)
  ${chalk.green('/fork')}       Fork: save current session, start fresh in new one
  ${chalk.green('/logout')}     Clear OAuth credentials
  ${chalk.green('/quit')}       Save and exit

  ${chalk.dim('Press Escape or Ctrl+C during generation to abort.')}
`);
    };

    const handleCommand = async (input: string): Promise<boolean> => {
      const [cmd, ...args] = input.split(/\s+/);

      switch (cmd) {
        case '/exit':
        case '/quit':
        case '/q':
          await saveTranscript();
          console.log(chalk.dim(`Session saved: ${sessionDir}`));
          await mcp.disconnect();
          rl.close();
          process.exit(0);

        case '/help':
        case '/?':
          showHelp();
          return true;

        case '/tools':
          for (const name of toolNames) {
            const desc = mcp.getToolDescription(name);
            console.log(`  ${chalk.green(name)}${desc ? ` ${chalk.dim('—')} ${chalk.dim(desc)}` : ''}`);
          }
          console.log('');
          return true;

        case '/context': {
          const est = estimateContextSize(interaction.getMessages());
          console.log(`  Messages: ${est.messageCount}`);
          console.log(`  Characters: ${est.characterCount.toLocaleString()}`);
          console.log(`  Estimated tokens: ~${est.estimatedTokens.toLocaleString()}`);
          console.log('');
          return true;
        }

        case '/compact': {
          const strategies = await listCompactionStrategies();
          if (args[0] === 'list') {
            console.log(`  Available strategies:`);
            for (const s of strategies) {
              console.log(`    ${chalk.green(s.id)} — ${s.description ?? ''}`);
            }
            console.log(`\n  Usage: ${chalk.dim('/compact [strategy-id]')}`);
            console.log('');
            return true;
          }
          const strategyId = args[0] || strategies[0]?.id;
          if (!strategyId) {
            console.log(chalk.red('  No compaction strategies available.\n'));
            return true;
          }

          // Snapshot messages before compaction
          const messagesBefore = [...interaction.getMessages()];
          const beforeEst = estimateContextSize(messagesBefore);
          console.log(`  Compacting with ${chalk.green(strategyId)}...`);

          const result = await interaction.compactContext(strategyId);
          if (!result) {
            console.log(chalk.dim('  Nothing to compact (too few messages).\n'));
            return true;
          }

          // Show the replacement summary
          const afterEst = estimateContextSize(interaction.getMessages());
          console.log(`  ${beforeEst.estimatedTokens} → ${afterEst.estimatedTokens} tokens`);
          console.log(`  (${result.segmentEnd - result.segmentStart + 1} messages → ${result.replacementCount})\n`);

          // Show the replacement content
          const replacementMsgs = interaction.getMessages().slice(
            result.segmentStart,
            result.segmentStart + result.replacementCount,
          );
          console.log(chalk.dim('  ── replacement ──'));
          for (const msg of replacementMsgs) {
            const content = typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content);
            // Show first ~20 lines
            const lines = content.split('\n');
            const preview = lines.slice(0, 20);
            for (const line of preview) {
              console.log(chalk.dim(`  │ `) + line);
            }
            if (lines.length > 20) {
              console.log(chalk.dim(`  │ ... (${lines.length - 20} more lines)`));
            }
          }
          console.log(chalk.dim('  ── end ──\n'));

          // Ask: accept, edit, or revert
          const answer = await new Promise<string>((resolve) => {
            rl.question(
              `  ${chalk.bold('Accept')} (a), ${chalk.bold('edit')} (e), or ${chalk.bold('revert')} (r)? `,
              resolve,
            );
          });

          const choice = answer.trim().toLowerCase();
          if (choice === 'r' || choice === 'revert') {
            // Restore original messages
            (interaction as any).messages = messagesBefore;
            console.log(chalk.dim('  Reverted.\n'));
          } else if (choice === 'e' || choice === 'edit') {
            // Let user provide replacement text
            console.log(chalk.dim('  Enter replacement summary (end with empty line):'));
            const editLines: string[] = [];
            const collectEdit = (): Promise<void> => new Promise((resolve) => {
              const readLine = () => {
                rl.question(chalk.dim('  │ '), (line) => {
                  if (line === '') {
                    resolve();
                  } else {
                    editLines.push(line);
                    readLine();
                  }
                });
              };
              readLine();
            });
            await collectEdit();
            if (editLines.length > 0) {
              const editedContent = editLines.join('\n');
              const newMessages = [
                ...interaction.getMessages().slice(0, result.segmentStart),
                { role: 'assistant' as const, content: editedContent },
                ...interaction.getMessages().slice(result.segmentStart + result.replacementCount),
              ];
              (interaction as any).messages = newMessages;
              console.log(chalk.dim('  Updated.\n'));
            } else {
              console.log(chalk.dim('  No input — keeping compacted version.\n'));
            }
          } else {
            console.log(chalk.dim('  Accepted.\n'));
          }
          return true;
        }

        case '/new':
          await saveTranscript();
          interaction.clearContext();
          console.log(chalk.dim('  Conversation cleared. Starting fresh.\n'));
          return true;

        case '/fork': {
          await saveTranscript();
          console.log(chalk.dim(`  Saved: ${sessionDir}`));
          const prevSessionId = sessionId;
          sessionId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          sessionDir = join(sessionsBase, sessionId);
          mkdirSync(sessionDir, { recursive: true });
          writeFileSync(join(sessionDir, 'meta.json'), JSON.stringify({
            id: sessionId,
            server: opts.url,
            provider: opts.provider,
            model: opts.model,
            createdAt: new Date().toISOString(),
            forkedFrom: prevSessionId,
          }, null, 2));
          interaction.clearContext();
          console.log(chalk.dim(`  Forked to: ${sessionDir}`));
          console.log(chalk.dim('  Conversation cleared.\n'));
          return true;
        }

        case '/logout':
          await mcp.resetAuth();
          console.log('  Cleared credentials. Restart to re-auth.\n');
          return true;

        default:
          if (input.startsWith('/')) {
            console.log(chalk.dim(`  Unknown command: ${cmd}. Type /help for commands.\n`));
            return true;
          }
          return false;
      }
    };

    const runTurn = async (input: string) => {
      const obs = await createMarkdownChatObserver();
      try {
        interaction.addMessage({ role: 'user', content: input });
        console.log('');
        currentAbort = new AbortController();
        isStreaming = true;
        const response = await interaction.streamText(currentAbort.signal, obs);
        obs.end();
        const text = typeof response.content === 'string' ? response.content : String(response.content ?? '');
        if (text && !text.endsWith('\n')) process.stdout.write('\n');
      } catch (error: any) {
        obs.end();
        if (error?.name === 'AbortError' || currentAbort?.signal.aborted) {
          // Already printed abort message
        } else {
          console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        }
      } finally {
        isStreaming = false;
        currentAbort = null;
        await saveTranscript();
      }
    };

    showHelp();

    const ask = () => {
      rl.question(getPrompt(), async (line) => {
        const input = line.trim();
        if (!input) { ask(); return; }

        if (await handleCommand(input)) { ask(); return; }

        await runTurn(input);
        console.log('');
        ask();
      });
    };

    // Save on Ctrl+C too
    process.on('SIGINT', async () => {
      if (currentAbort) {
        currentAbort.abort();
        process.stdout.write(chalk.dim('\n  ⏹ aborted\n'));
        isStreaming = false;
        currentAbort = null;
        await saveTranscript();
        console.log('');
        ask();
        return;
      }
      await saveTranscript();
      console.log(chalk.dim(`\nSession saved: ${sessionDir}`));
      await mcp.disconnect();
      process.exit(0);
    });

    ask();
  });

// =============================================================================
// Utility Commands
// =============================================================================

// MCP List Connections Command
mcpCommand
  .command('list')
  .description('List available MCP commands and usage examples')
  .action(() => {
    console.log(chalk.blue('🔧 MCP (Model Context Protocol) Commands\n'));
    
    console.log(chalk.yellow('📡 Client Commands:'));
    console.log('  mcp connect        - Connect to an MCP server and list capabilities');
    console.log('  mcp test-tool      - Test a specific tool from an MCP server');
    console.log('  mcp read-resource  - Read a resource from an MCP server');
    console.log('  mcp chat           - Connect to a remote MCP server with OAuth and chat\n');

    console.log(chalk.yellow('💡 Usage Examples:'));
    console.log(chalk.gray('  # Connect to a local MCP server'));
    console.log('  npm run cli mcp connect -c "node my-server.js"');
    console.log('');
    console.log(chalk.gray('  # Connect to a remote SSE MCP server'));
    console.log('  npm run cli mcp connect --transport sse --url "https://example.com/sse" -H "Authorization=Bearer $TOKEN"');
    console.log('');
    console.log(chalk.gray('  # Test a tool with parameters'));
    console.log('  npm run cli mcp test-tool -c "node server.js" -t "add" -p \'{"a":5,"b":3}\'');
    console.log('');
    console.log(chalk.gray('  # Read a resource'));
    console.log('  npm run cli mcp read-resource -c "node server.js" -u "file:///path/to/file"');
    console.log('');
    console.log(chalk.gray('  # Chat with a remote OAuth-protected MCP server'));
    console.log('  npm run cli mcp chat --url https://oura-mcp.fly.dev/mcp');
  });

export default mcpCommand;