import { Command } from 'commander';
import { cwd } from 'node:process';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
  hasSessionsIndex,
  getProjectSessions,
  filterSessions,
} from '../sessions/session-store.js';
import type { SessionIndexEntry } from '../sessions/types.js';

export const sessionsCommand = new Command('sessions')
  .description('View and analyze Claude Code session data')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd());

// Helper functions
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffHours < 1) {
    const minutes = Math.floor(diffMs / (1000 * 60));
    return `${minutes}m ago`;
  } else if (diffHours < 24) {
    return `${Math.floor(diffHours)}h ago`;
  } else if (diffDays < 7) {
    return `${Math.floor(diffDays)}d ago`;
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function truncatePrompt(prompt: string, maxLength: number = 50): string {
  if (prompt.length <= maxLength) return prompt;
  return prompt.slice(0, maxLength - 3) + '...';
}

function shortSessionId(sessionId: string): string {
  return sessionId.split('-')[0];
}

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

interface ListOptions {
  project: string;
  limit: string;
  branch?: string;
  sort: 'created' | 'modified' | 'messages';
  json?: boolean;
}

// List subcommand
sessionsCommand
  .command('list')
  .description('List all sessions for a project')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd())
  .option('--limit <number>', 'Number of sessions to show', '10')
  .option('--branch <branch>', 'Filter by git branch')
  .option('--sort <field>', 'Sort by field (created, modified, messages)', 'modified')
  .option('--json', 'Output in JSON format')
  .action(async (options: ListOptions) => {
    try {
      const projectPath = options.project;

      // Check if sessions index exists
      if (!(await hasSessionsIndex(projectPath))) {
        console.error(
          chalk.red(`No Claude sessions found for project: ${projectPath}`)
        );
        console.log(
          chalk.dim('\nMake sure this is a Claude Code project directory.')
        );
        process.exit(1);
      }

      // Get all sessions
      let sessions = await getProjectSessions(projectPath);

      // Filter by branch if specified
      if (options.branch) {
        sessions = await filterSessions(projectPath, {
          gitBranch: options.branch,
        });
      }

      // Sort sessions
      sessions.sort((a, b) => {
        switch (options.sort) {
          case 'created':
            return new Date(b.created).getTime() - new Date(a.created).getTime();
          case 'modified':
            return new Date(b.modified).getTime() - new Date(a.modified).getTime();
          case 'messages':
            return b.messageCount - a.messageCount;
          default:
            return 0;
        }
      });

      // Limit results
      const limit = parseInt(options.limit);
      const limitedSessions = sessions.slice(0, limit);

      // Output JSON if requested
      if (options.json) {
        console.log(JSON.stringify(limitedSessions, null, 2));
        return;
      }

      // Display table
      if (limitedSessions.length === 0) {
        console.log(chalk.yellow('\nNo sessions found.'));
        return;
      }

      console.log(
        chalk.bold(`\nFound ${sessions.length} sessions (showing ${limitedSessions.length})\n`)
      );

      const table = new Table({
        head: ['ID', 'Branch', 'Messages', 'Modified', 'First Prompt'],
        colWidths: [10, 15, 10, 12, 50],
        style: {
          head: [],
          border: [],
        },
      });

      for (const session of limitedSessions) {
        table.push([
          chalk.cyan(shortSessionId(session.sessionId)),
          session.gitBranch,
          session.messageCount.toString(),
          formatDate(session.modified),
          truncatePrompt(session.firstPrompt),
        ]);
      }

      console.log(table.toString());

      console.log(
        chalk.dim('\nTip: Use "sessions show <id>" to view session details')
      );
      console.log(
        chalk.dim('     Use --branch <name> to filter by git branch')
      );
    } catch (error) {
      console.error(chalk.red('Error listing sessions:'), error);
      process.exit(1);
    }
  });

// Show subcommand
interface ShowOptions {
  project: string;
  json?: boolean;
}

sessionsCommand
  .command('show')
  .description('Show detailed information about a specific session')
  .argument('<session-id>', 'Session ID to display')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd())
  .option('--json', 'Output in JSON format')
  .action(async (sessionId: string, options: ShowOptions) => {
    try {
      const projectPath = options.project;

      // Check if sessions index exists
      if (!(await hasSessionsIndex(projectPath))) {
        console.error(
          chalk.red(`No Claude sessions found for project: ${projectPath}`)
        );
        process.exit(1);
      }

      // Get all sessions and find matching one (support partial IDs)
      const sessions = await getProjectSessions(projectPath);
      const session = sessions.find(s =>
        s.sessionId === sessionId || s.sessionId.startsWith(sessionId)
      );

      if (!session) {
        console.error(chalk.red(`Session not found: ${sessionId}`));
        console.log(
          chalk.dim('\nTip: Use "sessions list" to see available sessions')
        );
        process.exit(1);
      }

      // Parse the session file to get detailed information
      const { parseSessionFile, summarizeSession } = await import('../sessions/session-parser.js');
      const messages = await parseSessionFile(session.fullPath);
      const summary = summarizeSession(messages);

      // Calculate duration in a human-readable format
      const durationStr = summary.duration
        ? formatDuration(summary.duration)
        : 'N/A';

      // Output JSON if requested
      if (options.json) {
        const output = {
          sessionId: session.sessionId,
          projectPath: session.projectPath,
          gitBranch: session.gitBranch,
          created: session.created,
          modified: session.modified,
          duration: durationStr,
          isSidechain: session.isSidechain,
          messageCount: session.messageCount,
          userMessages: summary.userMessages,
          assistantMessages: summary.assistantMessages,
          toolCalls: summary.toolCalls,
          tokenUsage: summary.tokenUsage,
          estimatedCost: summary.estimatedCost,
          firstPrompt: session.firstPrompt,
        };
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Display formatted output
      console.log(chalk.bold(`\nSession: ${chalk.cyan(session.sessionId)}\n`));

      const table = new Table({
        colWidths: [25, 50],
        style: {
          head: [],
          border: [],
        },
      });

      table.push(
        [chalk.bold('Project Path'), session.projectPath],
        [chalk.bold('Git Branch'), session.gitBranch],
        [chalk.bold('Created'), formatDate(session.created)],
        [chalk.bold('Modified'), formatDate(session.modified)],
        [chalk.bold('Duration'), durationStr],
        [chalk.bold('Sidechain'), session.isSidechain ? 'Yes' : 'No'],
        ['', ''],
        [chalk.bold('Total Messages'), session.messageCount.toString()],
        [chalk.bold('User Messages'), summary.userMessages.toString()],
        [chalk.bold('Assistant Messages'), summary.assistantMessages.toString()],
        [chalk.bold('Tool Calls'), summary.toolCalls.toString()],
        ['', ''],
        [chalk.bold('Input Tokens'), summary.tokenUsage.input_tokens.toLocaleString()],
        [chalk.bold('Output Tokens'), summary.tokenUsage.output_tokens.toLocaleString()],
        [
          chalk.bold('Cache Write Tokens'),
          (summary.tokenUsage.cache_creation_input_tokens || 0).toLocaleString(),
        ],
        [
          chalk.bold('Cache Read Tokens'),
          (summary.tokenUsage.cache_read_input_tokens || 0).toLocaleString(),
        ],
        ['', ''],
        [
          chalk.bold('Estimated Cost'),
          chalk.green(`$${summary.estimatedCost.toFixed(4)}`),
        ]
      );

      console.log(table.toString());

      console.log(chalk.bold('\nFirst Prompt:'));
      console.log(chalk.dim(truncatePrompt(session.firstPrompt, 100)));

      console.log(
        chalk.dim('\nTip: Use "sessions messages <id>" to view the conversation')
      );
      console.log(
        chalk.dim('     Use "sessions tools <id>" to view tool calls')
      );
    } catch (error) {
      console.error(chalk.red('Error showing session:'), error);
      process.exit(1);
    }
  });

// Messages subcommand
interface MessagesOptions {
  project: string;
  userOnly?: boolean;
  assistantOnly?: boolean;
  limit?: string;
  json?: boolean;
}

sessionsCommand
  .command('messages')
  .description('Display conversation messages from a session')
  .argument('<session-id>', 'Session ID to display messages from')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd())
  .option('--user-only', 'Show only user messages')
  .option('--assistant-only', 'Show only assistant messages')
  .option('--limit <number>', 'Number of messages to show (most recent first)')
  .option('--json', 'Output in JSON format')
  .action(async (sessionId: string, options: MessagesOptions) => {
    try {
      const projectPath = options.project;

      // Check if sessions index exists
      if (!(await hasSessionsIndex(projectPath))) {
        console.error(
          chalk.red(`No Claude sessions found for project: ${projectPath}`)
        );
        process.exit(1);
      }

      // Get all sessions and find matching one (support partial IDs)
      const sessions = await getProjectSessions(projectPath);
      const session = sessions.find(s =>
        s.sessionId === sessionId || s.sessionId.startsWith(sessionId)
      );

      if (!session) {
        console.error(chalk.red(`Session not found: ${sessionId}`));
        console.log(
          chalk.dim('\nTip: Use "sessions list" to see available sessions')
        );
        process.exit(1);
      }

      // Parse the session file
      const { parseSessionFile, extractTextContent } = await import('../sessions/session-parser.js');
      const messages = await parseSessionFile(session.fullPath);

      // Filter messages to only user and assistant types
      let filteredMessages = messages.filter(
        m => m.type === 'user' || m.type === 'assistant'
      );

      // Apply user/assistant filters
      if (options.userOnly) {
        filteredMessages = filteredMessages.filter(m => m.type === 'user');
      } else if (options.assistantOnly) {
        filteredMessages = filteredMessages.filter(m => m.type === 'assistant');
      }

      // Apply limit (show most recent first)
      if (options.limit) {
        const limit = parseInt(options.limit);
        // Take the last N messages (most recent)
        filteredMessages = filteredMessages.slice(-limit);
      }

      // Output JSON if requested
      if (options.json) {
        const output = filteredMessages.map(msg => {
          if (msg.type === 'user' || msg.type === 'assistant') {
            const content = msg.message.content;
            const texts = extractTextContent(content);

            return {
              type: msg.type,
              role: msg.message.role,
              timestamp: msg.timestamp,
              uuid: msg.uuid,
              content: texts.join('\n'),
              rawContent: content,
            };
          }
          return msg;
        });
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Display formatted output
      if (filteredMessages.length === 0) {
        console.log(chalk.yellow('\nNo messages found.'));
        return;
      }

      console.log(chalk.bold(`\nSession: ${chalk.cyan(session.sessionId)}`));
      console.log(chalk.dim(`Showing ${filteredMessages.length} message(s)\n`));

      for (const msg of filteredMessages) {
        if (msg.type !== 'user' && msg.type !== 'assistant') {
          continue;
        }

        const timestamp = msg.timestamp ? formatDate(msg.timestamp) : 'unknown';
        const role = msg.type === 'user' ? chalk.green('User') : chalk.blue('Assistant');

        console.log(chalk.bold(`[${timestamp}] ${role}:`));

        const content = msg.message.content;
        const texts = extractTextContent(content);

        for (const text of texts) {
          // Truncate very long messages for readability
          const maxLength = 500;
          if (text.length > maxLength) {
            console.log(chalk.dim(text.slice(0, maxLength) + '...'));
            console.log(chalk.dim(`(${text.length - maxLength} more characters)`));
          } else {
            console.log(text);
          }
        }

        console.log(''); // Empty line between messages
      }

      console.log(
        chalk.dim('Tip: Use --limit <number> to show specific number of messages')
      );
      console.log(
        chalk.dim('     Use --user-only or --assistant-only to filter by role')
      );
      console.log(
        chalk.dim('     Use --json to get full message content')
      );
    } catch (error) {
      console.error(chalk.red('Error displaying messages:'), error);
      process.exit(1);
    }
  });

// Tools subcommand
interface ToolsOptions {
  project: string;
  tool?: string;
  json?: boolean;
}

sessionsCommand
  .command('tools')
  .description('Show tool calls from a session')
  .argument('<session-id>', 'Session ID to extract tool calls from')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd())
  .option('--tool <name>', 'Filter by tool name')
  .option('--json', 'Output in JSON format')
  .action(async (sessionId: string, options: ToolsOptions) => {
    try {
      const projectPath = options.project;

      // Check if sessions index exists
      if (!(await hasSessionsIndex(projectPath))) {
        console.error(
          chalk.red(`No Claude sessions found for project: ${projectPath}`)
        );
        process.exit(1);
      }

      // Get all sessions and find matching one (support partial IDs)
      const sessions = await getProjectSessions(projectPath);
      const session = sessions.find(s =>
        s.sessionId === sessionId || s.sessionId.startsWith(sessionId)
      );

      if (!session) {
        console.error(chalk.red(`Session not found: ${sessionId}`));
        console.log(
          chalk.dim('\nTip: Use "sessions list" to see available sessions')
        );
        process.exit(1);
      }

      // Parse the session file and extract tool calls
      const { parseSessionFile, extractToolCalls } = await import('../sessions/session-parser.js');
      const messages = await parseSessionFile(session.fullPath);
      let toolCalls = extractToolCalls(messages);

      // Filter by tool name if specified
      if (options.tool) {
        toolCalls = toolCalls.filter(tc => tc.name === options.tool);
      }

      // Output JSON if requested
      if (options.json) {
        console.log(JSON.stringify(toolCalls, null, 2));
        return;
      }

      // Display formatted output
      if (toolCalls.length === 0) {
        if (options.tool) {
          console.log(chalk.yellow(`\nNo tool calls found for tool: ${options.tool}`));
        } else {
          console.log(chalk.yellow('\nNo tool calls found in this session.'));
        }
        return;
      }

      console.log(chalk.bold(`\nSession: ${chalk.cyan(session.sessionId)}`));
      console.log(chalk.dim(`Found ${toolCalls.length} tool call(s)\n`));

      const table = new Table({
        head: ['Time', 'Tool', 'Input'],
        colWidths: [12, 20, 70],
        style: {
          head: [],
          border: [],
        },
        wordWrap: true,
      });

      for (const toolCall of toolCalls) {
        const timestamp = toolCall.timestamp ? formatDate(toolCall.timestamp) : 'unknown';

        // Format input parameters - show as compact JSON
        let inputStr = '';
        if (toolCall.input && typeof toolCall.input === 'object') {
          // Get key parameter names for common tools
          const keys = Object.keys(toolCall.input);
          if (keys.length === 0) {
            inputStr = '{}';
          } else {
            // Show first few keys with truncated values
            const maxKeys = 3;
            const displayKeys = keys.slice(0, maxKeys);
            const parts = displayKeys.map(key => {
              const value = toolCall.input[key];
              let valueStr = String(value);
              if (valueStr.length > 40) {
                valueStr = valueStr.slice(0, 37) + '...';
              }
              return `${key}: ${valueStr}`;
            });

            if (keys.length > maxKeys) {
              parts.push(`... +${keys.length - maxKeys} more`);
            }

            inputStr = parts.join('\n');
          }
        } else {
          inputStr = String(toolCall.input);
        }

        table.push([
          timestamp,
          chalk.cyan(toolCall.name),
          chalk.dim(inputStr),
        ]);
      }

      console.log(table.toString());

      console.log(
        chalk.dim('\nTip: Use --tool <name> to filter by specific tool')
      );
      console.log(
        chalk.dim('     Use --json to get full tool call details')
      );
    } catch (error) {
      console.error(chalk.red('Error extracting tool calls:'), error);
      process.exit(1);
    }
  });

// Stats subcommand
interface StatsOptions {
  project: string;
  json?: boolean;
}

sessionsCommand
  .command('stats')
  .description('Show token usage statistics and costs for a session')
  .argument('<session-id>', 'Session ID to analyze')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd())
  .option('--json', 'Output in JSON format')
  .action(async (sessionId: string, options: StatsOptions) => {
    try {
      const projectPath = options.project;

      // Check if sessions index exists
      if (!(await hasSessionsIndex(projectPath))) {
        console.error(
          chalk.red(`No Claude sessions found for project: ${projectPath}`)
        );
        process.exit(1);
      }

      // Get all sessions and find matching one (support partial IDs)
      const sessions = await getProjectSessions(projectPath);
      const session = sessions.find(s =>
        s.sessionId === sessionId || s.sessionId.startsWith(sessionId)
      );

      if (!session) {
        console.error(chalk.red(`Session not found: ${sessionId}`));
        console.log(
          chalk.dim('\nTip: Use "sessions list" to see available sessions')
        );
        process.exit(1);
      }

      // Parse the session file to get detailed information
      const { parseSessionFile, summarizeSession } = await import('../sessions/session-parser.js');
      const messages = await parseSessionFile(session.fullPath);
      const summary = summarizeSession(messages);

      // Calculate cache efficiency
      const totalInputTokens = summary.tokenUsage.input_tokens +
        (summary.tokenUsage.cache_creation_input_tokens || 0) +
        (summary.tokenUsage.cache_read_input_tokens || 0);

      const cacheHitRate = totalInputTokens > 0
        ? ((summary.tokenUsage.cache_read_input_tokens || 0) / totalInputTokens) * 100
        : 0;

      // Calculate cost breakdown
      const INPUT_PRICE_PER_MTK = 3.0;
      const OUTPUT_PRICE_PER_MTK = 15.0;
      const CACHE_WRITE_PRICE_PER_MTK = 3.75;
      const CACHE_READ_PRICE_PER_MTK = 0.3;

      const inputCost = (summary.tokenUsage.input_tokens / 1_000_000) * INPUT_PRICE_PER_MTK;
      const outputCost = (summary.tokenUsage.output_tokens / 1_000_000) * OUTPUT_PRICE_PER_MTK;
      const cacheWriteCost = ((summary.tokenUsage.cache_creation_input_tokens || 0) / 1_000_000) * CACHE_WRITE_PRICE_PER_MTK;
      const cacheReadCost = ((summary.tokenUsage.cache_read_input_tokens || 0) / 1_000_000) * CACHE_READ_PRICE_PER_MTK;

      // Output JSON if requested
      if (options.json) {
        const output = {
          sessionId: session.sessionId,
          tokenUsage: {
            input: summary.tokenUsage.input_tokens,
            output: summary.tokenUsage.output_tokens,
            cacheWrite: summary.tokenUsage.cache_creation_input_tokens || 0,
            cacheRead: summary.tokenUsage.cache_read_input_tokens || 0,
            total: totalInputTokens + summary.tokenUsage.output_tokens,
          },
          cacheStats: {
            hitRate: cacheHitRate,
            writeTokens: summary.tokenUsage.cache_creation_input_tokens || 0,
            readTokens: summary.tokenUsage.cache_read_input_tokens || 0,
          },
          costs: {
            input: inputCost,
            output: outputCost,
            cacheWrite: cacheWriteCost,
            cacheRead: cacheReadCost,
            total: summary.estimatedCost,
          },
          messages: {
            total: summary.totalMessages,
            user: summary.userMessages,
            assistant: summary.assistantMessages,
            toolCalls: summary.toolCalls,
          },
        };
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      // Display formatted output
      console.log(chalk.bold(`\nToken Usage & Cost Statistics`));
      console.log(chalk.dim(`Session: ${chalk.cyan(session.sessionId)}\n`));

      // Token Usage Table
      const tokenTable = new Table({
        head: ['Token Type', 'Count', 'Cost'],
        colWidths: [25, 20, 15],
        style: {
          head: [],
          border: [],
        },
      });

      tokenTable.push(
        [
          'Input Tokens',
          summary.tokenUsage.input_tokens.toLocaleString(),
          chalk.dim(`$${inputCost.toFixed(4)}`),
        ],
        [
          'Output Tokens',
          summary.tokenUsage.output_tokens.toLocaleString(),
          chalk.dim(`$${outputCost.toFixed(4)}`),
        ],
        [
          chalk.yellow('Cache Write Tokens'),
          (summary.tokenUsage.cache_creation_input_tokens || 0).toLocaleString(),
          chalk.dim(`$${cacheWriteCost.toFixed(4)}`),
        ],
        [
          chalk.green('Cache Read Tokens'),
          (summary.tokenUsage.cache_read_input_tokens || 0).toLocaleString(),
          chalk.dim(`$${cacheReadCost.toFixed(4)}`),
        ],
        ['', '', ''],
        [
          chalk.bold('Total'),
          chalk.bold((totalInputTokens + summary.tokenUsage.output_tokens).toLocaleString()),
          chalk.bold.green(`$${summary.estimatedCost.toFixed(4)}`),
        ]
      );

      console.log(tokenTable.toString());

      // Cache Statistics
      console.log(chalk.bold('\nCache Performance\n'));

      const cacheStatsTable = new Table({
        colWidths: [35, 25],
        style: {
          head: [],
          border: [],
        },
      });

      cacheStatsTable.push(
        [
          'Cache Hit Rate',
          `${cacheHitRate.toFixed(2)}%`,
        ],
        [
          'Tokens Written to Cache',
          (summary.tokenUsage.cache_creation_input_tokens || 0).toLocaleString(),
        ],
        [
          'Tokens Read from Cache',
          (summary.tokenUsage.cache_read_input_tokens || 0).toLocaleString(),
        ]
      );

      console.log(cacheStatsTable.toString());

      // Session Overview
      console.log(chalk.bold('\nSession Overview\n'));

      const overviewTable = new Table({
        colWidths: [35, 25],
        style: {
          head: [],
          border: [],
        },
      });

      overviewTable.push(
        ['Total Messages', summary.totalMessages.toString()],
        ['User Messages', summary.userMessages.toString()],
        ['Assistant Messages', summary.assistantMessages.toString()],
        ['Tool Calls', summary.toolCalls.toString()]
      );

      console.log(overviewTable.toString());

      console.log(
        chalk.dim('\nTip: Use "sessions show <id>" to view full session details')
      );
      console.log(
        chalk.dim('     Use --json to get structured output')
      );
    } catch (error) {
      console.error(chalk.red('Error calculating stats:'), error);
      process.exit(1);
    }
  });

// Format subcommand
interface FormatOptions {
  assistantOnly?: boolean;
  userOnly?: boolean;
  tools?: boolean; // Default true, can be disabled with --no-tools
  quiet?: boolean;
  short?: boolean; // Compact table view
}

sessionsCommand
  .command('format')
  .description('Format JSONL session stream from stdin to readable text with rich metrics')
  .option('--assistant-only', 'Show only assistant messages')
  .option('--user-only', 'Show only user messages')
  .option('--no-tools', 'Hide tool calls and execution details')
  .option('--quiet', 'Minimal output - just conversation')
  .option('--short', 'Compact table view with key metrics')
  .action(async (options: FormatOptions) => {
    try {
      const { createInterface } = await import('node:readline');
      const { stdin } = await import('node:process');

      // Check if stdin is being piped
      if (stdin.isTTY) {
        console.error(chalk.red('Error: This command requires input from stdin'));
        console.log(chalk.dim('\nUsage: claude -p "prompt" --output-format stream-json | umwelten sessions format'));
        console.log(chalk.dim('       cat session.jsonl | umwelten sessions format'));
        process.exit(1);
      }

      const rl = createInterface({
        input: stdin,
        crlfDelay: Infinity,
      });

      // Default to showing tools unless explicitly disabled
      const showTools = options.tools !== false;
      const isQuiet = options.quiet === true;
      const isShort = options.short === true;

      // Session tracking
      let sessionStartTime: number | null = null;
      let lastMessageTime: number | null = null;
      let messageCount = 0;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCacheRead = 0;
      let totalCacheWrite = 0;
      const toolCalls: Array<{ name: string; timestamp: number; resultSize?: number; duration?: number }> = [];
      const pendingTools = new Map<string, { name: string; timestamp: number }>();
      let sessionMetadata: any = null;
      let finalResult: any = null;
      const modelUsageMap = new Map<string, any>();

      // For short table view
      const shortViewMessages: Array<{ type: string; content: string; time: number; tokens?: number; cost?: number }> = [];

      // Pricing (Claude Sonnet 4.5)
      const INPUT_PRICE_PER_MTK = 3.0;
      const OUTPUT_PRICE_PER_MTK = 15.0;
      const CACHE_WRITE_PRICE_PER_MTK = 3.75;
      const CACHE_READ_PRICE_PER_MTK = 0.3;

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const message = JSON.parse(line);
          const now = Date.now();

          // Track session start
          if (message.type === 'system' && message.subtype === 'init') {
            sessionStartTime = now;
            sessionMetadata = message;

            if (!isShort && !options.userOnly && !options.assistantOnly) {
              console.log(chalk.dim('━'.repeat(80)));
              console.log(chalk.cyan.bold('📡 Session Started'));
              console.log(chalk.dim(`Session ID: ${message.session_id?.split('-')[0] || 'unknown'}`));
              console.log(chalk.dim(`Model: ${message.model || 'unknown'}`));
              console.log(chalk.dim(`CWD: ${message.cwd || 'unknown'}`));
              console.log(chalk.dim(`Claude Code: v${message.claude_code_version || 'unknown'}`));

              if (message.agents && message.agents.length > 0) {
                console.log(chalk.dim(`Agents: ${message.agents.slice(0, 5).join(', ')}${message.agents.length > 5 ? ` +${message.agents.length - 5} more` : ''}`));
              }

              if (message.plugins && message.plugins.length > 0) {
                console.log(chalk.dim(`Plugins: ${message.plugins.length} loaded`));
              }

              if (message.mcp_servers && message.mcp_servers.length > 0) {
                console.log(chalk.dim(`MCP Servers: ${message.mcp_servers.length}`));
              }

              console.log(chalk.dim('━'.repeat(80)));
            }
          }

          // Filter based on options
          if (options.userOnly && message.type !== 'user') continue;
          if (options.assistantOnly && message.type !== 'assistant') continue;

          // Handle different message types
          if (message.type === 'user' && !message.message?.content?.some((b: any) => b.type === 'tool_result')) {
            messageCount++;
            const timeSinceLast = lastMessageTime ? now - lastMessageTime : 0;
            lastMessageTime = now;

            if (!isShort) {
              console.log(chalk.bold.green(`\n👤 User`) + (timeSinceLast > 1000 ? chalk.dim(` (+${(timeSinceLast / 1000).toFixed(1)}s)`) : ''));

              const content = message.message?.content;
              if (typeof content === 'string') {
                console.log(content);
              } else if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'text') {
                    console.log(block.text);
                  }
                }
              }
            }
          } else if (message.type === 'assistant') {
            const timeSinceLast = lastMessageTime ? now - lastMessageTime : 0;
            lastMessageTime = now;

            const content = message.message?.content;
            const usage = message.message?.usage;

            // Track tokens
            if (usage) {
              totalInputTokens += usage.input_tokens || 0;
              totalOutputTokens += usage.output_tokens || 0;
              totalCacheRead += usage.cache_read_input_tokens || 0;
              totalCacheWrite += usage.cache_creation_input_tokens || 0;
            }

            // Check if this is a text response or tool call
            const hasText = Array.isArray(content) && content.some((b: any) => b.type === 'text' && b.text);
            const toolUses = Array.isArray(content) ? content.filter((b: any) => b.type === 'tool_use') : [];

            if (hasText) {
              messageCount++;

              if (!isShort) {
                console.log(chalk.bold.blue(`\n🤖 Assistant`) + (timeSinceLast > 1000 ? chalk.dim(` (+${(timeSinceLast / 1000).toFixed(1)}s)`) : ''));

                if (typeof content === 'string') {
                  console.log(content);
                } else if (Array.isArray(content)) {
                  for (const block of content) {
                    if (block.type === 'text') {
                      console.log(block.text);
                    }
                  }
                }

                // Show token usage inline
                if (usage && (showTools || !isQuiet)) {
                  const inputCost = (usage.input_tokens / 1_000_000) * INPUT_PRICE_PER_MTK;
                  const outputCost = (usage.output_tokens / 1_000_000) * OUTPUT_PRICE_PER_MTK;
                  const cacheReadCost = ((usage.cache_read_input_tokens || 0) / 1_000_000) * CACHE_READ_PRICE_PER_MTK;
                  const totalCost = inputCost + outputCost + cacheReadCost;

                  console.log(chalk.dim(`\n  💰 Cost: $${totalCost.toFixed(4)} | ` +
                    `📊 Tokens: ${usage.output_tokens} out, ${usage.input_tokens} in` +
                    (usage.cache_read_input_tokens ? chalk.green(` | ⚡ ${usage.cache_read_input_tokens.toLocaleString()} cached`) : '')));
                }
              }
            }

            // Handle tool calls
            for (const toolUse of toolUses) {
              if (!isShort && (showTools || !isQuiet)) {
                console.log(chalk.yellow(`\n🔧 Tool: ${chalk.bold(toolUse.name)}`));

                // Show compact input
                const inputStr = JSON.stringify(toolUse.input, null, 2);
                const inputLines = inputStr.split('\n');
                if (inputLines.length > 10) {
                  console.log(chalk.dim(`   ${inputLines.slice(0, 5).join('\n   ')}`));
                  console.log(chalk.dim(`   ... (${inputLines.length - 10} more lines)`));
                  console.log(chalk.dim(`   ${inputLines.slice(-5).join('\n   ')}`));
                } else {
                  console.log(chalk.dim(`   ${inputStr.split('\n').join('\n   ')}`));
                }
              }

              // Track pending tool call
              pendingTools.set(toolUse.id, { name: toolUse.name, timestamp: now });
            }
          } else if (message.type === 'tool_result') {
            const toolUseId = message.tool_use_id || message.message?.content?.[0]?.tool_use_id;
            const pending = pendingTools.get(toolUseId);

            if (pending && !isShort && (showTools || !isQuiet)) {
              const duration = now - pending.timestamp;

              // Get result size
              let resultSize = 0;
              const content = message.message?.content;
              if (typeof content === 'string') {
                resultSize = content.length;
              } else if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'text') {
                    resultSize += block.text?.length || 0;
                  } else if (block.content) {
                    resultSize += typeof block.content === 'string' ? block.content.length : JSON.stringify(block.content).length;
                  }
                }
              }

              toolCalls.push({ name: pending.name, timestamp: pending.timestamp, resultSize, duration });
              pendingTools.delete(toolUseId);

              console.log(chalk.green(`   ✓ Completed in ${duration}ms`) +
                (resultSize > 0 ? chalk.dim(` | ${(resultSize / 1024).toFixed(1)} KB result`) : ''));
            }
          } else if (message.type === 'result') {
            finalResult = message;

            if (!isShort && message.subtype === 'success' && !!isQuiet) {
              // Don't show success messages in quiet mode
            } else if (!isShort && !isQuiet) {
              console.log(chalk.dim(`\n[Result: ${message.subtype || 'unknown'}]`));
              if (message.result) {
                console.log(chalk.dim(`  ${message.result}`));
              }
            }
          }
        } catch (parseError) {
          if (!isQuiet) {
            console.error(chalk.red(`Failed to parse line: ${parseError}`));
          }
        }
      }

      // Print summary
      const totalDuration = sessionStartTime ? Date.now() - sessionStartTime : 0;
      const actualDuration = finalResult?.duration_ms || totalDuration;
      const apiDuration = finalResult?.duration_api_ms || 0;
      const numTurns = finalResult?.num_turns || 0;
      const actualCost = finalResult?.total_cost_usd || null;

      const totalCost =
        (totalInputTokens / 1_000_000) * INPUT_PRICE_PER_MTK +
        (totalOutputTokens / 1_000_000) * OUTPUT_PRICE_PER_MTK +
        (totalCacheRead / 1_000_000) * CACHE_READ_PRICE_PER_MTK +
        (totalCacheWrite / 1_000_000) * CACHE_WRITE_PRICE_PER_MTK;

      // SHORT TABLE VIEW
      if (isShort) {
        if (finalResult) {
          console.log(chalk.bold.cyan('\n📊 Session Summary (Short View)\n'));

          const summaryTable = new Table({
            head: ['Metric', 'Value'],
            colWidths: [30, 50],
            style: {
              head: [],
              border: [],
            },
          });

          summaryTable.push(
            ['Session ID', sessionMetadata?.session_id?.split('-')[0] || 'unknown'],
            ['Model', sessionMetadata?.model || 'unknown'],
            ['Duration', `${(actualDuration / 1000).toFixed(1)}s (API: ${(apiDuration / 1000).toFixed(1)}s)`],
            ['Turns', numTurns.toString()],
            ['Messages', messageCount.toString()],
            ['Tool Calls', toolCalls.length.toString()],
            ['Total Tokens', (totalInputTokens + totalOutputTokens + totalCacheRead + totalCacheWrite).toLocaleString()],
            ['Cost', chalk.green(`$${(actualCost || totalCost).toFixed(4)}`)],
          );

          console.log(summaryTable.toString());

          // Model usage breakdown if multiple models
          if (finalResult.modelUsage && Object.keys(finalResult.modelUsage).length > 1) {
            console.log(chalk.bold('\n🤖 Models Used:\n'));

            const modelTable = new Table({
              head: ['Model', 'In/Out Tokens', 'Cache', 'Cost'],
              colWidths: [30, 20, 20, 15],
              style: {
                head: [],
                border: [],
              },
            });

            for (const [modelName, usage] of Object.entries(finalResult.modelUsage)) {
              const u = usage as any;
              modelTable.push([
                modelName.replace('claude-', ''),
                `${u.inputTokens}/${u.outputTokens}`,
                u.cacheReadInputTokens ? `${u.cacheReadInputTokens.toLocaleString()}` : '0',
                chalk.green(`$${u.costUSD.toFixed(4)}`),
              ]);
            }

            console.log(modelTable.toString());
          }

          // Tool usage table
          if (toolCalls.length > 0) {
            console.log(chalk.bold('\n🔧 Tool Usage:\n'));

            const toolTable = new Table({
              head: ['Tool', 'Calls', 'Avg Time', 'Total Size'],
              colWidths: [20, 10, 15, 15],
              style: {
                head: [],
                border: [],
              },
            });

            const toolStats = new Map<string, { count: number; totalDuration: number; totalSize: number }>();
            for (const call of toolCalls) {
              const stats = toolStats.get(call.name) || { count: 0, totalDuration: 0, totalSize: 0 };
              stats.count++;
              stats.totalDuration += call.duration || 0;
              stats.totalSize += call.resultSize || 0;
              toolStats.set(call.name, stats);
            }

            for (const [name, stats] of toolStats) {
              const avgDuration = stats.totalDuration / stats.count;
              toolTable.push([
                name,
                stats.count.toString(),
                avgDuration > 0 ? `${avgDuration.toFixed(0)}ms` : '-',
                stats.totalSize > 0 ? `${(stats.totalSize / 1024).toFixed(1)} KB` : '-',
              ]);
            }

            console.log(toolTable.toString());
          }
        } else {
          console.log(chalk.yellow('\nNo session data available yet.'));
        }
      }
      // DETAILED VIEW
      else if (messageCount > 0 || toolCalls.length > 0) {
        console.log(chalk.dim('\n' + '━'.repeat(80)));
        console.log(chalk.cyan.bold('📊 Session Summary'));
        console.log(chalk.dim('━'.repeat(80)));

        if (actualDuration > 0) {
          const wallClock = (actualDuration / 1000).toFixed(1);
          const api = apiDuration > 0 ? ` (API: ${(apiDuration / 1000).toFixed(1)}s)` : '';
          console.log(chalk.white(`⏱️  Duration: ${chalk.bold(wallClock)}s${chalk.dim(api)}`));
        }

        if (numTurns > 0) {
          console.log(chalk.white(`🔄 Conversation Turns: ${chalk.bold(numTurns)}`));
        }

        if (messageCount > 0) {
          console.log(chalk.white(`💬 Messages: ${chalk.bold(messageCount)}`));
        }

        if (toolCalls.length > 0) {
          console.log(chalk.white(`🔧 Tool Calls: ${chalk.bold(toolCalls.length)}`));

          // Group by tool name
          const toolStats = new Map<string, { count: number; totalDuration: number; totalSize: number }>();
          for (const call of toolCalls) {
            const stats = toolStats.get(call.name) || { count: 0, totalDuration: 0, totalSize: 0 };
            stats.count++;
            stats.totalDuration += call.duration || 0;
            stats.totalSize += call.resultSize || 0;
            toolStats.set(call.name, stats);
          }

          for (const [name, stats] of toolStats) {
            const avgDuration = stats.totalDuration / stats.count;
            console.log(chalk.dim(`   • ${name}: ${stats.count}x` +
              (avgDuration > 0 ? `, avg ${avgDuration.toFixed(0)}ms` : '') +
              (stats.totalSize > 0 ? `, ${(stats.totalSize / 1024).toFixed(1)} KB` : '')));
          }
        }

        // Model usage breakdown if available
        if (finalResult?.modelUsage && Object.keys(finalResult.modelUsage).length > 0) {
          console.log(chalk.white(`\n🤖 Models Used:`));

          for (const [modelName, usage] of Object.entries(finalResult.modelUsage)) {
            const u = usage as any;
            const shortName = modelName.replace('claude-', '').replace('-20250929', '').replace('-20251001', '');
            console.log(chalk.dim(`   • ${shortName}:`));
            console.log(chalk.dim(`     - Tokens: ${u.inputTokens} in, ${u.outputTokens} out` +
              (u.cacheReadInputTokens ? chalk.green(`, ${u.cacheReadInputTokens.toLocaleString()} cached`) : '')));
            console.log(chalk.dim(`     - Cost: ${chalk.green(`$${u.costUSD.toFixed(4)}`)}`));
          }
        }

        if (totalInputTokens > 0 || totalOutputTokens > 0) {
          console.log(chalk.white(`\n📊 Total Tokens:`));
          console.log(chalk.dim(`   • Input: ${totalInputTokens.toLocaleString()}`));
          console.log(chalk.dim(`   • Output: ${totalOutputTokens.toLocaleString()}`));
          if (totalCacheRead > 0) {
            console.log(chalk.green(`   • Cache Read: ${totalCacheRead.toLocaleString()}`));
          }
          if (totalCacheWrite > 0) {
            console.log(chalk.yellow(`   • Cache Write: ${totalCacheWrite.toLocaleString()}`));
          }
          console.log(chalk.dim(`   • Total: ${(totalInputTokens + totalOutputTokens + totalCacheRead + totalCacheWrite).toLocaleString()}`));
        }

        const displayCost = actualCost !== null ? actualCost : totalCost;
        if (displayCost > 0) {
          const costLabel = actualCost !== null ? 'Actual Cost' : 'Estimated Cost';
          console.log(chalk.white(`\n💰 ${costLabel}: ${chalk.bold.green(`$${displayCost.toFixed(4)}`)}`));
        }

        // Permission denials if any
        if (finalResult?.permission_denials && finalResult.permission_denials.length > 0) {
          console.log(chalk.yellow(`\n⚠️  Permission Denials: ${finalResult.permission_denials.length}`));
        }

        // Web usage if any
        if (finalResult?.usage?.server_tool_use) {
          const webSearch = finalResult.usage.server_tool_use.web_search_requests || 0;
          const webFetch = finalResult.usage.server_tool_use.web_fetch_requests || 0;
          if (webSearch > 0 || webFetch > 0) {
            console.log(chalk.white(`\n🌐 Web Usage:`));
            if (webSearch > 0) console.log(chalk.dim(`   • Search Requests: ${webSearch}`));
            if (webFetch > 0) console.log(chalk.dim(`   • Fetch Requests: ${webFetch}`));
          }
        }

        console.log(chalk.dim('━'.repeat(80)));
      } else if (!!isQuiet) {
        console.log(chalk.yellow('\nNo messages found in stream.'));
      }
    } catch (error) {
      console.error(chalk.red('Error formatting stream:'), error);
      process.exit(1);
    }
  });
