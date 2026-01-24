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

// Placeholder for show subcommand
sessionsCommand
  .command('show')
  .description('Show detailed information about a specific session')
  .argument('<session-id>', 'Session ID to display')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd())
  .option('--json', 'Output in JSON format')
  .action(async (sessionId, options) => {
    console.log(chalk.yellow('Sessions show command - to be implemented'));
    console.log('Session ID:', sessionId);
    console.log('Options:', options);
  });

// Placeholder for messages subcommand
sessionsCommand
  .command('messages')
  .description('Display conversation messages from a session')
  .argument('<session-id>', 'Session ID to display messages from')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd())
  .option('--user-only', 'Show only user messages')
  .option('--assistant-only', 'Show only assistant messages')
  .option('--json', 'Output in JSON format')
  .action(async (sessionId, options) => {
    console.log(chalk.yellow('Sessions messages command - to be implemented'));
    console.log('Session ID:', sessionId);
    console.log('Options:', options);
  });

// Placeholder for tools subcommand
sessionsCommand
  .command('tools')
  .description('Show tool calls from a session')
  .argument('<session-id>', 'Session ID to extract tool calls from')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd())
  .option('--tool <name>', 'Filter by tool name')
  .option('--json', 'Output in JSON format')
  .action(async (sessionId, options) => {
    console.log(chalk.yellow('Sessions tools command - to be implemented'));
    console.log('Session ID:', sessionId);
    console.log('Options:', options);
  });

// Placeholder for stats subcommand
sessionsCommand
  .command('stats')
  .description('Show statistics and costs for a session')
  .argument('<session-id>', 'Session ID to analyze')
  .option('-p, --project <path>', 'Project path (defaults to current directory)', cwd())
  .option('--json', 'Output in JSON format')
  .action(async (sessionId, options) => {
    console.log(chalk.yellow('Sessions stats command - to be implemented'));
    console.log('Session ID:', sessionId);
    console.log('Options:', options);
  });
