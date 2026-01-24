/**
 * Console Renderer
 *
 * Renders reports to the terminal with rich formatting,
 * colors, tables, and box drawing characters.
 */

import {
  Report,
  ReportSection,
  ReportSummary,
  TableData,
  ListItem,
  MetricItem,
  ConsoleRenderOptions,
} from '../types.js';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

// Box drawing characters
const box = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  cross: '┼',
  teeDown: '┬',
  teeUp: '┴',
  teeRight: '├',
  teeLeft: '┤',
};

const DEFAULT_OPTIONS: Required<ConsoleRenderOptions> = {
  colors: true,
  maxWidth: 80,
  detailed: true,
};

export class ConsoleRenderer {
  private options: Required<ConsoleRenderOptions>;

  constructor(options: ConsoleRenderOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Render a report to the console
   */
  render(report: Report): void {
    this.renderHeader(report);
    this.renderSummary(report.summary);

    for (const section of report.sections) {
      this.renderSection(section);
    }

    this.renderFooter();
  }

  /**
   * Render the report header with title and timestamp
   */
  private renderHeader(report: Report): void {
    const width = this.options.maxWidth;
    const title = report.title;
    const date = report.timestamp.toLocaleString();

    console.log();
    console.log(this.color('cyan', box.topLeft + box.horizontal.repeat(width - 2) + box.topRight));
    console.log(this.color('cyan', box.vertical) + '  ' + this.color('bold', title).padEnd(width - 4 + this.colorLen('bold')) + this.color('cyan', box.vertical));
    console.log(this.color('cyan', box.vertical) + '  ' + this.color('gray', date).padEnd(width - 4 + this.colorLen('gray')) + this.color('cyan', box.vertical));
    console.log(this.color('cyan', box.bottomLeft + box.horizontal.repeat(width - 2) + box.bottomRight));
    console.log();
  }

  /**
   * Render the summary section
   */
  private renderSummary(summary: ReportSummary): void {
    console.log(this.color('bold', 'Summary'));
    console.log(this.color('gray', '─'.repeat(this.options.maxWidth)));

    // Main metrics line
    const statusColor = summary.successRate >= 80 ? 'green' : summary.successRate >= 50 ? 'yellow' : 'red';
    const metrics = [
      `Total: ${summary.totalItems}`,
      `${this.color('green', `Passed: ${summary.passed}`)}`,
      `${this.color('red', `Failed: ${summary.failed}`)}`,
      `${this.color(statusColor, `${summary.successRate.toFixed(1)}%`)}`,
    ];
    console.log('  ' + metrics.join('  │  '));

    // Duration and score
    const extras = [`Duration: ${this.formatDuration(summary.duration)}`];
    if (summary.averageScore !== undefined) {
      extras.push(`Avg Score: ${summary.averageScore.toFixed(1)}%`);
    }
    console.log('  ' + extras.join('  │  '));

    // Highlights
    if (summary.highlights.length > 0) {
      console.log();
      for (const highlight of summary.highlights) {
        console.log('  ' + this.color('cyan', '•') + ' ' + highlight);
      }
    }

    console.log();
  }

  /**
   * Render a report section
   */
  private renderSection(section: ReportSection): void {
    console.log(this.color('bold', section.title));
    console.log(this.color('gray', '─'.repeat(this.options.maxWidth)));

    if (section.description) {
      console.log(this.color('gray', section.description));
      console.log();
    }

    switch (section.content.type) {
      case 'table':
        this.renderTable(section.content.data);
        break;
      case 'list':
        this.renderList(section.content.data);
        break;
      case 'text':
        this.renderText(section.content.data);
        break;
      case 'metrics':
        this.renderMetrics(section.content.data);
        break;
    }

    console.log();
  }

  /**
   * Render a table
   */
  private renderTable(table: TableData): void {
    if (table.rows.length === 0) {
      console.log('  ' + this.color('gray', '(no data)'));
      return;
    }

    // Calculate column widths
    const widths: Record<string, number> = {};
    for (const col of table.columns) {
      widths[col.key] = col.width || Math.max(
        col.label.length,
        ...table.rows.map(row => String(row[col.key] ?? '').length)
      );
    }

    // Header row
    const headerCells = table.columns.map(col =>
      this.pad(col.label, widths[col.key], col.align || 'left')
    );
    console.log('  ' + this.color('bold', headerCells.join('  ')));

    // Separator
    const separatorCells = table.columns.map(col =>
      '─'.repeat(widths[col.key])
    );
    console.log('  ' + this.color('gray', separatorCells.join('  ')));

    // Data rows
    for (const row of table.rows) {
      const cells = table.columns.map(col => {
        let value = row[col.key];
        let formatted = col.format ? col.format(value) : String(value ?? '');

        // Color status values
        if (formatted === '✓' || formatted === 'true') {
          formatted = this.color('green', formatted);
        } else if (formatted === '✗' || formatted === 'false') {
          formatted = this.color('red', formatted);
        }

        return this.pad(formatted, widths[col.key], col.align || 'left');
      });
      console.log('  ' + cells.join('  '));
    }
  }

  /**
   * Render a list
   */
  private renderList(items: ListItem[]): void {
    for (const item of items) {
      let marker = '•';
      if (item.status === 'success') {
        marker = this.color('green', '✓');
      } else if (item.status === 'failure') {
        marker = this.color('red', '✗');
      } else if (item.status === 'warning') {
        marker = this.color('yellow', '⚠');
      }

      console.log(`  ${marker} ${item.text}`);
      if (item.details) {
        console.log(`    ${this.color('gray', item.details)}`);
      }
    }
  }

  /**
   * Render plain text
   */
  private renderText(text: string): void {
    const lines = text.split('\n');
    for (const line of lines) {
      console.log('  ' + line);
    }
  }

  /**
   * Render metrics
   */
  private renderMetrics(metrics: MetricItem[]): void {
    for (const metric of metrics) {
      let valueStr = String(metric.value);
      if (metric.unit) {
        valueStr += metric.unit;
      }

      if (metric.status === 'good') {
        valueStr = this.color('green', valueStr);
      } else if (metric.status === 'bad') {
        valueStr = this.color('red', valueStr);
      }

      console.log(`  ${metric.label}: ${valueStr}`);
    }
  }

  /**
   * Render footer
   */
  private renderFooter(): void {
    console.log(this.color('gray', '─'.repeat(this.options.maxWidth)));
    console.log();
  }

  /**
   * Apply color if colors are enabled
   */
  private color(name: keyof typeof colors, text: string): string {
    if (!this.options.colors) return text;
    return colors[name] + text + colors.reset;
  }

  /**
   * Get the length of color codes (for padding calculations)
   */
  private colorLen(name: keyof typeof colors): number {
    if (!this.options.colors) return 0;
    return colors[name].length + colors.reset.length;
  }

  /**
   * Pad a string to a width with alignment
   */
  private pad(text: string, width: number, align: 'left' | 'center' | 'right'): string {
    // Strip ANSI codes for length calculation
    const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');
    const padding = width - stripped.length;

    if (padding <= 0) return text;

    switch (align) {
      case 'right':
        return ' '.repeat(padding) + text;
      case 'center':
        const left = Math.floor(padding / 2);
        const right = padding - left;
        return ' '.repeat(left) + text + ' '.repeat(right);
      default:
        return text + ' '.repeat(padding);
    }
  }

  /**
   * Format duration in milliseconds to human readable
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
  }
}
