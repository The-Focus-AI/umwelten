import { Command } from 'commander';
import { cwd } from 'node:process';
import { resolve } from 'node:path';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
  hasSessionsIndex,
  getProjectSessionsIncludingFromDirectory,
  getProjectSessions,
  hasAnalysisIndex,
} from '../sessions/session-store.js';
import type { SessionIndexEntry } from '../sessions/types.js';
import { indexProject } from '../sessions/session-indexer.js';
import {
  searchSessions,
  formatSearchResults,
  formatSearchResultsJSON,
  getTopTopics,
  getTopTools,
  getPatterns,
} from '../sessions/session-search.js';
import type { SearchOptions } from '../sessions/analysis-types.js';
import { getAdapterRegistry } from '../sessions/adapters/index.js';
import type { NormalizedSessionEntry, SessionSource } from '../sessions/normalized-types.js';

export const sessionsCommand = new Command('sessions')
  .description('View and analyze sessions (Claude Code, Cursor)');

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
  source?: string;
  json?: boolean;
}

// Source color mapping
function getSourceColor(source: SessionSource): (text: string) => string {
  switch (source) {
    case 'claude-code':
      return chalk.blue;
    case 'cursor':
      return chalk.magenta;
    default:
      return chalk.gray;
  }
}

function getSourceLabel(source: SessionSource): string {
  switch (source) {
    case 'claude-code':
      return 'Claude';
    case 'cursor':
      return 'Cursor';
    default:
      return source;
  }
}

// List subcommand
sessionsCommand
  .command('list')
  .description('List sessions for a project (auto-detects Claude Code and Cursor)')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd())
  .option('--limit <number>', 'Number of sessions to show', '10')
  .option('--branch <branch>', 'Filter by git branch')
  .option('--sort <field>', 'Sort by field (created, modified, messages)', 'modified')
  .option('--source <source>', 'Filter by source (claude-code, cursor, all)', 'all')
  .option('--json', 'Output in JSON format')
  .action(async (options: ListOptions) => {
    try {
      const projectPath = resolve(options.project);
      const registry = getAdapterRegistry();
      const limit = parseInt(options.limit);
      const sourceFilter = options.source || 'all';

      // Collect sessions from all requested sources
      const allSessions: NormalizedSessionEntry[] = [];
      const sourceCounts: Record<string, number> = {};

      // Get adapters to query
      const adaptersToQuery =
        sourceFilter === 'all'
          ? registry.getAll()
          : [registry.get(sourceFilter as SessionSource)].filter(Boolean);

      if (adaptersToQuery.length === 0) {
        console.error(chalk.red(`Unknown source: ${sourceFilter}`));
        console.log(chalk.dim('Available sources: claude-code, cursor, all'));
        process.exit(1);
      }

      // Query each adapter
      for (const adapter of adaptersToQuery) {
        if (!adapter) continue;

        try {
          const result = await adapter.discoverSessions({
            projectPath,
            gitBranch: options.branch,
            sortBy: options.sort === 'messages' ? 'messageCount' : options.sort,
            sortOrder: 'desc',
          });

          sourceCounts[adapter.source] = result.totalCount;
          allSessions.push(...result.sessions);
        } catch {
          // Source not available for this project, skip silently
          sourceCounts[adapter.source] = 0;
        }
      }

      // Group sessions by source for interleaving
      const sessionsBySource = new Map<string, NormalizedSessionEntry[]>();
      for (const session of allSessions) {
        const list = sessionsBySource.get(session.source) || [];
        list.push(session);
        sessionsBySource.set(session.source, list);
      }

      // Sort each source's sessions
      const sortFn = (a: NormalizedSessionEntry, b: NormalizedSessionEntry) => {
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
      };

      for (const [_source, sessions] of sessionsBySource) {
        sessions.sort(sortFn);
      }

      // Interleave sessions from different sources to ensure representation
      // If we have multiple sources, ensure each gets at least a few slots
      let limitedSessions: NormalizedSessionEntry[];
      const activeSources = [...sessionsBySource.entries()].filter(([, s]) => s.length > 0);

      if (activeSources.length > 1) {
        // Multiple sources: interleave to guarantee representation
        // Reserve at least 2 slots per source, then fill remaining with most recent
        const minPerSource = Math.min(2, Math.floor(limit / activeSources.length));
        const reserved: NormalizedSessionEntry[] = [];
        const remaining: NormalizedSessionEntry[] = [];

        for (const [_source, sessions] of activeSources) {
          // Take the minimum reserved slots from each source
          reserved.push(...sessions.slice(0, minPerSource));
          // Put the rest in remaining pool
          remaining.push(...sessions.slice(minPerSource));
        }

        // Sort remaining by the sort criteria
        remaining.sort(sortFn);

        // Combine: reserved first, then fill with remaining up to limit
        limitedSessions = [...reserved, ...remaining].slice(0, limit);

        // Re-sort the final combined list so display is consistent
        limitedSessions.sort(sortFn);
      } else {
        // Single source: just sort and limit normally
        allSessions.sort(sortFn);
        limitedSessions = allSessions.slice(0, limit);
      }

      // Output JSON if requested
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              sessions: limitedSessions,
              totalCount: allSessions.length,
              sourceCounts,
            },
            null,
            2
          )
        );
        return;
      }

      // Display results
      if (limitedSessions.length === 0) {
        console.log(chalk.yellow('\nNo sessions found.'));

        // Show which sources were checked
        const checkedSources = Object.keys(sourceCounts).join(', ');
        console.log(chalk.dim(`\nChecked sources: ${checkedSources}`));
        console.log(chalk.dim('Make sure this is a project directory with sessions (Claude Code, Cursor).'));
        return;
      }

      // Show source summary
      const sourcesSummary = Object.entries(sourceCounts)
        .filter(([, count]) => count > 0)
        .map(([source, count]) => {
          const colorFn = getSourceColor(source as SessionSource);
          return colorFn(`${getSourceLabel(source as SessionSource)}: ${count}`);
        })
        .join(', ');

      console.log(
        chalk.bold(`\nFound ${allSessions.length} sessions (showing ${limitedSessions.length})`)
      );
      if (Object.keys(sourceCounts).length > 1 || sourceFilter === 'all') {
        console.log(chalk.dim(`Sources: ${sourcesSummary}`));
      }
      console.log();

      // Build table with source column
      const showSourceColumn = sourceFilter === 'all' && Object.keys(sourceCounts).filter(k => sourceCounts[k] > 0).length > 1;

      const tableHead = showSourceColumn
        ? ['Source', 'ID', 'Branch', 'Msgs', 'Modified', 'First Prompt']
        : ['ID', 'Branch', 'Msgs', 'Modified', 'First Prompt'];

      const tableWidths = showSourceColumn
        ? [8, 10, 12, 6, 10, 45]
        : [10, 15, 8, 12, 50];

      const table = new Table({
        head: tableHead,
        colWidths: tableWidths,
        style: {
          head: [],
          border: [],
        },
      });

      for (const session of limitedSessions) {
        const colorFn = getSourceColor(session.source);
        const row = showSourceColumn
          ? [
              colorFn(getSourceLabel(session.source)),
              chalk.cyan(shortSessionId(session.sourceId)),
              session.gitBranch || '-',
              session.messageCount.toString(),
              formatDate(session.modified),
              truncatePrompt(session.firstPrompt, 42),
            ]
          : [
              chalk.cyan(shortSessionId(session.sourceId)),
              session.gitBranch || '-',
              session.messageCount.toString(),
              formatDate(session.modified),
              truncatePrompt(session.firstPrompt),
            ];

        table.push(row);
      }

      console.log(table.toString());

      console.log(chalk.dim('\nTip: Use "sessions show <id>" to view details'));
      console.log(chalk.dim('     Use --source claude-code or --source cursor to filter'));
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
  .description('Show details for a specific session')
  .argument('<session-id>', 'Session ID to display')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd())
  .option('--json', 'Output in JSON format')
  .action(async (sessionId: string, options: ShowOptions) => {
    try {
      const projectPath = resolve(options.project);

      // Check if sessions index exists
      if (!(await hasSessionsIndex(projectPath))) {
        console.error(
          chalk.red(`No sessions found for project: ${projectPath}`)
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

      if (!session.fullPath) {
        console.error(chalk.red('Session file path not available (adapter session). Use sessions index with a file-based project.'));
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
      const projectPath = resolve(options.project);

      // Check if sessions index exists
      if (!(await hasSessionsIndex(projectPath))) {
        console.error(
          chalk.red(`No sessions found for project: ${projectPath}`)
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

      if (!session.fullPath) {
        console.error(chalk.red('Session file path not available (adapter session). Use sessions index with a file-based project.'));
        process.exit(1);
      }

      // Parse the session file
      const { parseSessionFile, extractTextContent } = await import('../sessions/session-parser.js');
      const messages = await parseSessionFile(session.fullPath);

      // Helper to check if a message has displayable text content
      const getTextContent = (msg: any): string => {
        if (msg.type !== 'user' && msg.type !== 'assistant') return '';
        const content = msg.message?.content;
        if (!content) return '';
        if (typeof content === 'string') return content.trim();
        if (Array.isArray(content)) {
          const texts = content
            .filter((block: any) => block.type === 'text' && block.text)
            .map((block: any) => block.text.trim())
            .filter((t: string) => t.length > 0);
          return texts.join('\n');
        }
        return '';
      };

      const hasTextContent = (msg: any): boolean => {
        return getTextContent(msg).length > 0;
      };

      // Helper to extract tool_use blocks from a message
      const getToolUseBlocks = (msg: any): any[] => {
        if (msg.type !== 'assistant') return [];
        const content = msg.message?.content;
        if (!Array.isArray(content)) return [];
        return content.filter((block: any) => block.type === 'tool_use');
      };

      const hasToolUse = (msg: any): boolean => {
        return getToolUseBlocks(msg).length > 0;
      };

      // Helper to format tool input for display
      const formatToolInput = (input: any): string => {
        if (!input) return '';
        if (typeof input === 'string') return input.slice(0, 100);

        // For objects, show key fields
        const keys = Object.keys(input);
        if (keys.length === 0) return '';

        const parts: string[] = [];
        for (const key of keys.slice(0, 3)) { // Show first 3 keys
          const value = input[key];
          let displayValue: string;
          if (typeof value === 'string') {
            displayValue = value.length > 60 ? value.slice(0, 60) + '...' : value;
          } else if (typeof value === 'object') {
            displayValue = JSON.stringify(value).slice(0, 60) + (JSON.stringify(value).length > 60 ? '...' : '');
          } else {
            displayValue = String(value);
          }
          parts.push(`${key}: ${displayValue}`);
        }
        if (keys.length > 3) {
          parts.push(`... +${keys.length - 3} more`);
        }
        return parts.join(', ');
      };

      // Helper to check if message is a tool result (user messages that are tool results)
      const isToolResult = (msg: any): boolean => {
        if (msg.type !== 'user') return false;
        const content = msg.message?.content;
        if (!Array.isArray(content)) return false;
        return content.some((block: any) => block.type === 'tool_result');
      };

      // Filter messages to only user and assistant types WITH displayable content OR tool calls
      // Exclude tool_result messages (those are shown in sessions tools)
      let filteredMessages = messages.filter(
        m => (m.type === 'user' || m.type === 'assistant') && (hasTextContent(m) || hasToolUse(m)) && !isToolResult(m)
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

      let displayedCount = 0;
      for (const msg of filteredMessages) {
        if (msg.type !== 'user' && msg.type !== 'assistant') {
          continue;
        }

        const content = msg.message.content;
        const texts = extractTextContent(content);
        const toolUses = getToolUseBlocks(msg);

        // Collect non-empty text content first
        const displayTexts = texts.map(t => t.trim()).filter(t => t.length > 0);

        // Skip messages with no displayable text AND no tool calls
        if (displayTexts.length === 0 && toolUses.length === 0) {
          continue;
        }

        displayedCount++;
        const timestamp = msg.timestamp ? formatDate(msg.timestamp) : 'unknown';
        const role = msg.type === 'user' ? chalk.green('User') : chalk.blue('Assistant');

        console.log(chalk.bold(`[${timestamp}] ${role}:`));

        // Display text content
        for (const text of displayTexts) {
          // Truncate very long messages for readability
          const maxLength = 500;
          if (text.length > maxLength) {
            console.log(text.slice(0, maxLength) + '...');
            console.log(chalk.dim(`(${text.length - maxLength} more characters)`));
          } else {
            console.log(text);
          }
        }

        // Display tool calls inline
        if (toolUses.length > 0) {
          if (displayTexts.length > 0) {
            console.log(''); // Add spacing if there was text before tools
          }
          for (const tool of toolUses) {
            const toolName = tool.name || 'unknown';
            const inputSummary = formatToolInput(tool.input);
            console.log(chalk.magenta(`  ↳ ${toolName}`) + (inputSummary ? chalk.dim(` (${inputSummary})`) : ''));
          }
        }

        console.log(''); // Empty line between messages
      }

      if (displayedCount === 0) {
        console.log(chalk.yellow('No text messages found in this session.'));
        console.log(chalk.dim('This session may contain only tool calls. Use "sessions tools <id>" to view them.'));
      } else {
        console.log(chalk.dim(`Displayed ${displayedCount} message(s)\n`));
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
      const projectPath = resolve(options.project);

      // Check if sessions index exists
      if (!(await hasSessionsIndex(projectPath))) {
        console.error(
          chalk.red(`No sessions found for project: ${projectPath}`)
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

      if (!session.fullPath) {
        console.error(chalk.red('Session file path not available (adapter session). Use sessions index with a file-based project.'));
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
      const projectPath = resolve(options.project);

      // Check if sessions index exists
      if (!(await hasSessionsIndex(projectPath))) {
        console.error(
          chalk.red(`No sessions found for project: ${projectPath}`)
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

      if (!session.fullPath) {
        console.error(chalk.red('Session file path not available (adapter session). Use sessions index with a file-based project.'));
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

      // Overview
      console.log(chalk.bold('\nSession overview\n'));

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
        chalk.dim('\nTip: Use "sessions show <id>" to view full details')
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
              console.log(chalk.cyan.bold('📡 Session started'));
              console.log(chalk.dim(`ID: ${message.session_id?.split('-')[0] || 'unknown'}`));
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
          console.log(chalk.bold.cyan('\n📊 Session summary (short)\n'));

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
        console.log(chalk.cyan.bold('📊 Session summary'));
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

// TUI subcommand
interface TuiOptions {
  project: string;
  file?: string;
  session?: string;
}

sessionsCommand
  .command('tui')
  .description('Interactive session TUI: overview, live stream, file, or session by ID')
  .argument('[file-or-session-id]', 'Session JSONL file path or session ID to open')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd())
  .option('--file <path>', 'Open session from JSONL file path')
  .option('--session <id>', 'Open session by ID (from sessions list)')
  .action(async (fileOrSessionId: string | undefined, options: TuiOptions) => {
    try {
      const { stdin } = await import('node:process');
      const projectPath = resolve(options.project);
      const hasStdin = !stdin.isTTY;

      let filePath: string | undefined = options.file;
      let sessionId: string | undefined = options.session;

      if (fileOrSessionId) {
        if (options.file) filePath = options.file;
        else if (options.session) sessionId = options.session;
        else if (fileOrSessionId.includes('/') || fileOrSessionId.endsWith('.jsonl')) {
          filePath = resolve(fileOrSessionId);
        } else {
          sessionId = fileOrSessionId;
        }
      }

      const { runSessionTui } = await import('../ui/tui/index.js');
      await runSessionTui({
        projectPath,
        filePath,
        sessionId,
        hasStdin,
      });
    } catch (error) {
      console.error(chalk.red('Error starting TUI:'), error);
      process.exit(1);
    }
  });

// Browse subcommand (session browser: search, first messages, index summary)
interface BrowseOptions {
  project: string;
}

sessionsCommand
  .command('browse')
  .description('Session browser: search, first messages, and index summary (Enter to open detail)')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd())
  .action(async (options: BrowseOptions) => {
    try {
      const projectPath = resolve(options.project);
      const { runBrowserTui } = await import('../ui/tui/browser/index.js');
      const selectedId = await runBrowserTui({
        projectPath,
        onSelectSession: id => {
          // selectedId is returned; print after TUI exits
        },
      });
      if (selectedId) {
        console.log(chalk.dim('\nTo view full session:'));
        console.log(chalk.cyan(`  umwelten sessions show ${selectedId}`));
      }
    } catch (error) {
      console.error(chalk.red('Error starting browser:'), error);
      process.exit(1);
    }
  });

// Export subcommand
interface ExportOptions {
  project: string;
  format: 'markdown' | 'json';
  output?: string;
  includeToolCalls?: boolean;
  includeMetadata?: boolean;
}

sessionsCommand
  .command('export')
  .description('Export session to markdown or JSON format')
  .argument('<session-id>', 'Session ID to export')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd())
  .option('-f, --format <format>', 'Output format (markdown, json)', 'markdown')
  .option('-o, --output <file>', 'Output file (prints to stdout if not specified)')
  .option('--no-tool-calls', 'Exclude tool calls from export')
  .option('--no-metadata', 'Exclude metadata from export')
  .action(async (sessionId: string, options: ExportOptions) => {
    try {
      const projectPath = resolve(options.project);

      // Check if sessions index exists
      if (!(await hasSessionsIndex(projectPath))) {
        console.error(
          chalk.red(`No sessions found for project: ${projectPath}`)
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

      if (!session.fullPath) {
        console.error(chalk.red('Session file path not available (adapter session). Use sessions index with a file-based project.'));
        process.exit(1);
      }

      // Parse the session file
      const { parseSessionFile, summarizeSession, extractToolCalls, extractTextContent } = await import('../sessions/session-parser.js');
      const messages = await parseSessionFile(session.fullPath);
      const summary = summarizeSession(messages);
      const toolCalls = extractToolCalls(messages);

      // Generate export content based on format
      let exportContent: string;

      if (options.format === 'json') {
        // JSON export
        const jsonExport: any = {
          sessionId: session.sessionId,
          metadata: options.includeMetadata !== false ? {
            projectPath: session.projectPath,
            gitBranch: session.gitBranch,
            created: session.created,
            modified: session.modified,
            isSidechain: session.isSidechain,
            messageCount: session.messageCount,
            firstPrompt: session.firstPrompt,
          } : undefined,
          summary: {
            totalMessages: summary.totalMessages,
            userMessages: summary.userMessages,
            assistantMessages: summary.assistantMessages,
            toolCalls: summary.toolCalls,
            duration: summary.duration,
            tokenUsage: summary.tokenUsage,
            estimatedCost: summary.estimatedCost,
          },
          conversation: messages
            .filter(m => m.type === 'user' || m.type === 'assistant')
            .map(msg => {
              if (msg.type === 'user' || msg.type === 'assistant') {
                const content = msg.message.content;
                const texts = extractTextContent(content);

                return {
                  type: msg.type,
                  role: msg.message.role,
                  timestamp: msg.timestamp,
                  uuid: msg.uuid,
                  content: texts.join('\n'),
                  usage: msg.type === 'assistant' ? msg.message.usage : undefined,
                };
              }
              return msg;
            }),
          toolCalls: options.includeToolCalls !== false ? toolCalls : undefined,
        };

        // Remove undefined fields
        if (jsonExport.metadata === undefined) delete jsonExport.metadata;
        if (jsonExport.toolCalls === undefined) delete jsonExport.toolCalls;

        exportContent = JSON.stringify(jsonExport, null, 2);
      } else {
        // Markdown export
        const lines: string[] = [];

        // Header
        lines.push(`# Session: ${session.sessionId}`);
        lines.push('');

        // Metadata section
        if (options.includeMetadata !== false) {
          lines.push('## Metadata');
          lines.push('');
          lines.push(`- **Project Path**: ${session.projectPath}`);
          lines.push(`- **Git Branch**: ${session.gitBranch}`);
          lines.push(`- **Created**: ${new Date(session.created).toLocaleString()}`);
          lines.push(`- **Modified**: ${new Date(session.modified).toLocaleString()}`);
          if (summary.duration) {
            const durationStr = formatDuration(summary.duration);
            lines.push(`- **Duration**: ${durationStr}`);
          }
          lines.push(`- **Sidechain**: ${session.isSidechain ? 'Yes' : 'No'}`);
          lines.push('');
        }

        // Summary section
        lines.push('## Summary');
        lines.push('');
        lines.push(`- **Total Messages**: ${summary.totalMessages}`);
        lines.push(`- **User Messages**: ${summary.userMessages}`);
        lines.push(`- **Assistant Messages**: ${summary.assistantMessages}`);
        lines.push(`- **Tool Calls**: ${summary.toolCalls}`);
        lines.push(`- **Input Tokens**: ${summary.tokenUsage.input_tokens.toLocaleString()}`);
        lines.push(`- **Output Tokens**: ${summary.tokenUsage.output_tokens.toLocaleString()}`);
        if (summary.tokenUsage.cache_read_input_tokens) {
          lines.push(`- **Cache Read Tokens**: ${summary.tokenUsage.cache_read_input_tokens.toLocaleString()}`);
        }
        if (summary.tokenUsage.cache_creation_input_tokens) {
          lines.push(`- **Cache Write Tokens**: ${summary.tokenUsage.cache_creation_input_tokens.toLocaleString()}`);
        }
        lines.push(`- **Estimated Cost**: $${summary.estimatedCost.toFixed(4)}`);
        lines.push('');

        // Conversation section
        lines.push('## Conversation');
        lines.push('');

        const conversationMessages = messages.filter(m => m.type === 'user' || m.type === 'assistant');
        for (const msg of conversationMessages) {
          if (msg.type !== 'user' && msg.type !== 'assistant') {
            continue;
          }

          const timestamp = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : 'unknown';
          const role = msg.type === 'user' ? 'User' : 'Assistant';

          lines.push(`### ${role} (${timestamp})`);
          lines.push('');

          const content = msg.message.content;
          const texts = extractTextContent(content);

          for (const text of texts) {
            lines.push(text);
            lines.push('');
          }

          // Add token usage for assistant messages
          if (msg.type === 'assistant' && msg.message.usage) {
            const usage = msg.message.usage;
            lines.push(`*Tokens: ${usage.input_tokens} in, ${usage.output_tokens} out*`);
            if (usage.cache_read_input_tokens) {
              lines.push(`*Cache: ${usage.cache_read_input_tokens} tokens read*`);
            }
            lines.push('');
          }
        }

        // Tool calls section
        if (options.includeToolCalls !== false && toolCalls.length > 0) {
          lines.push('## Tool Calls');
          lines.push('');

          for (const toolCall of toolCalls) {
            const timestamp = toolCall.timestamp ? new Date(toolCall.timestamp).toLocaleString() : 'unknown';
            lines.push(`### ${toolCall.name} (${timestamp})`);
            lines.push('');
            lines.push('**Input:**');
            lines.push('');
            lines.push('```json');
            lines.push(JSON.stringify(toolCall.input, null, 2));
            lines.push('```');
            lines.push('');
          }
        }

        exportContent = lines.join('\n');
      }

      // Output to file or stdout
      if (options.output) {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(options.output, exportContent, 'utf-8');
        console.log(chalk.green(`✓ Exported session to ${options.output}`));
      } else {
        console.log(exportContent);
      }
    } catch (error) {
      console.error(chalk.red('Error exporting session:'), error);
      process.exit(1);
    }
  });

// Index subcommand
interface IndexCommandOptions {
  project: string;
  model?: string;
  force?: boolean;
  batchSize?: string;
  verbose?: boolean;
}

sessionsCommand
  .command('index')
  .description('Index sessions using LLM analysis for intelligent search')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd())
  .option('-m, --model <model>', 'Model for analysis (format: provider:model)', 'google:gemini-3-flash-preview')
  .option('--force', 'Force reindex all sessions', false)
  .option('-b, --batch-size <size>', 'Number of sessions to process concurrently', '5')
  .option('-v, --verbose', 'Show detailed progress', false)
  .action(async (options: IndexCommandOptions) => {
    try {
      const projectPath = resolve(options.project);

      // Use same discovery as list (adapters) so index sees every session list shows
      const registry = getAdapterRegistry();
      const adapters = registry.getAll();
      const allNormalized: NormalizedSessionEntry[] = [];
      for (const adapter of adapters) {
        if (!adapter) continue;
        try {
          const result = await adapter.discoverSessions({
            projectPath,
            sortBy: 'modified',
            sortOrder: 'desc',
          });
          allNormalized.push(...result.sessions);
        } catch {
          // Source not available for this project
        }
      }

      // Build indexable entries for all sources: Claude (file-based) and Cursor/others (adapter-based)
      const sessionsOverride: SessionIndexEntry[] = allNormalized.map(s => {
        const hasFullPath =
          s.source === 'claude-code' &&
          s.sourceData != null &&
          typeof (s.sourceData as any).fullPath === 'string' &&
          typeof (s.sourceData as any).fileMtime === 'number';

        const fileMtime = hasFullPath
          ? (s.sourceData as any).fileMtime
          : new Date(s.modified).getTime();
        const sessionId = hasFullPath ? s.sourceId : s.id;

        return {
          sessionId,
          ...(hasFullPath && {
            fullPath: (s.sourceData as any).fullPath,
          }),
          fileMtime,
          firstPrompt: s.firstPrompt ?? '',
          messageCount: s.messageCount ?? 0,
          created: s.created ?? '',
          modified: s.modified ?? '',
          gitBranch: s.gitBranch ?? 'main',
          projectPath: s.projectPath ?? projectPath,
          isSidechain: s.isSidechain ?? false,
          ...(!hasFullPath && { source: s.source }),
        };
      });

      if (sessionsOverride.length === 0) {
        console.error(chalk.red(`No sessions found for project: ${projectPath}`));
        process.exit(1);
      }

      const bySource = sessionsOverride.reduce(
        (acc, s) => {
          const src = s.fullPath ? 'claude-code' : (s.source ?? 'unknown');
          acc[src] = (acc[src] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
      const sourceSummary = Object.entries(bySource)
        .map(([k, n]) => `${n} ${k}`)
        .join(', ');

      console.log(chalk.bold('Indexing sessions...'));
      console.log(chalk.dim(`Project: ${projectPath}`));
      console.log(chalk.dim(`Sessions: ${sessionsOverride.length} (${sourceSummary})`));
      console.log(chalk.dim(`Model: ${options.model}`));
      console.log('');

      const batchSize = parseInt(options.batchSize || '5', 10);

      const result = await indexProject({
        projectPath,
        model: options.model,
        force: options.force,
        batchSize,
        verbose: options.verbose,
        sessionsOverride,
      });

      console.log('');
      console.log(chalk.green('✓ Indexing complete'));
      console.log(`  Indexed: ${result.indexed} sessions`);
      console.log(`  Skipped: ${result.skipped} sessions (already indexed)`);
      if (result.failed > 0) {
        console.log(chalk.yellow(`  Failed: ${result.failed} sessions`));
      }

      // Show index location
      if (await hasAnalysisIndex(projectPath)) {
        console.log('');
        console.log(chalk.dim('Use "sessions search" to search indexed sessions'));
      }
    } catch (error) {
      console.error(chalk.red('Error indexing sessions:'), error);
      process.exit(1);
    }
  });

// Search subcommand
interface SearchCommandOptions {
  project: string;
  tags?: string;
  topic?: string;
  tool?: string;
  type?: string;
  success?: string;
  branch?: string;
  limit?: string;
  json?: boolean;
}

sessionsCommand
  .command('search')
  .description('Search indexed sessions by keywords, tags, topics, or filters')
  .argument('[query]', 'Search query (optional)')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd())
  .option('--tags <tags>', 'Filter by tags (comma-separated)')
  .option('--topic <topic>', 'Filter by topic')
  .option('--tool <tool>', 'Filter by tool usage')
  .option('--type <type>', 'Filter by solution type (bug-fix, feature, refactor, exploration, question, other)')
  .option('--success <indicator>', 'Filter by success (yes, partial, no, unclear)')
  .option('--branch <branch>', 'Filter by git branch')
  .option('-l, --limit <limit>', 'Max results', '10')
  .option('--json', 'Output as JSON', false)
  .action(async (query: string | undefined, options: SearchCommandOptions) => {
    try {
      const projectPath = resolve(options.project);

      // Check if analysis index exists
      if (!(await hasAnalysisIndex(projectPath))) {
        console.error(
          chalk.red(`No analysis index found for project: ${projectPath}`)
        );
        console.log(
          chalk.dim('\nTip: Run "sessions index" first to create the analysis index.')
        );
        process.exit(1);
      }

      const searchOptions: SearchOptions = {
        projectPath,
        tags: options.tags ? options.tags.split(',').map(t => t.trim()) : undefined,
        topic: options.topic,
        tool: options.tool,
        solutionType: options.type,
        successIndicator: options.success,
        branch: options.branch,
        limit: parseInt(options.limit || '10', 10),
        json: options.json,
      };

      const results = await searchSessions(query, searchOptions);

      if (options.json) {
        console.log(formatSearchResultsJSON(results));
      } else {
        console.log(formatSearchResults(results));
      }
    } catch (error) {
      console.error(chalk.red('Error searching sessions:'), error);
      process.exit(1);
    }
  });

// Analyze subcommand
interface AnalyzeCommandOptions {
  project: string;
  type: 'topics' | 'tools' | 'patterns' | 'timeline';
  json?: boolean;
}

sessionsCommand
  .command('analyze')
  .description('Aggregate analysis across all indexed sessions')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd())
  .option('-t, --type <type>', 'Analysis type: topics, tools, patterns, timeline', 'topics')
  .option('--json', 'Output as JSON', false)
  .action(async (options: AnalyzeCommandOptions) => {
    try {
      const projectPath = resolve(options.project);

      // Check if analysis index exists
      if (!(await hasAnalysisIndex(projectPath))) {
        console.error(
          chalk.red(`No analysis index found for project: ${projectPath}`)
        );
        console.log(
          chalk.dim('\nTip: Run "sessions index" first to create the analysis index.')
        );
        process.exit(1);
      }

      if (options.type === 'topics') {
        const topics = await getTopTopics(projectPath, 20);

        if (options.json) {
          console.log(JSON.stringify(topics, null, 2));
        } else {
          console.log(chalk.bold(`Top Topics (${topics.length} found):`));
          console.log('');
          for (let i = 0; i < topics.length; i++) {
            console.log(`${i + 1}. ${topics[i].topic} (${topics[i].count} sessions)`);
          }
        }
      } else if (options.type === 'tools') {
        const tools = await getTopTools(projectPath, 20);

        if (options.json) {
          console.log(JSON.stringify(tools, null, 2));
        } else {
          console.log(chalk.bold(`Tool Usage Analysis (${tools.length} tools):`));
          console.log('');

          // Calculate total sessions for percentage
          const { readAnalysisIndex } = await import('../sessions/session-store.js');
          const index = await readAnalysisIndex(projectPath);
          const totalSessions = index.entries.length;

          for (let i = 0; i < tools.length; i++) {
            const percentage = ((tools[i].count / totalSessions) * 100).toFixed(1);
            console.log(`${i + 1}. ${tools[i].tool} - ${tools[i].count} sessions (${percentage}%)`);
          }
        }
      } else if (options.type === 'patterns') {
        const patterns = await getPatterns(projectPath);

        if (options.json) {
          console.log(JSON.stringify(patterns, null, 2));
        } else {
          console.log(chalk.bold(`Session Patterns (${patterns.totalSessions} sessions):`));
          console.log('');

          console.log(chalk.bold('Solution Types:'));
          for (const st of patterns.solutionTypes) {
            console.log(`  ${st.type}: ${st.count} sessions`);
          }
          console.log('');

          console.log(chalk.bold('Success Rates:'));
          for (const sr of patterns.successRates) {
            console.log(`  ${sr.indicator}: ${sr.count} sessions (${sr.percentage.toFixed(1)}%)`);
          }
          console.log('');

          console.log(chalk.bold('Languages:'));
          for (const lang of patterns.languages.slice(0, 10)) {
            console.log(`  ${lang.language}: ${lang.count} sessions`);
          }
        }
      } else {
        console.error(chalk.red(`Unknown analysis type: ${options.type}`));
        console.log(chalk.dim('Available types: topics, tools, patterns, timeline'));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('Error analyzing sessions:'), error);
      process.exit(1);
    }
  });
