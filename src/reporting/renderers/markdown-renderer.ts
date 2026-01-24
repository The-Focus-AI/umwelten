/**
 * Markdown Renderer
 *
 * Renders reports to GitHub-flavored markdown with
 * YAML frontmatter, tables, and collapsible sections.
 */

import {
  Report,
  ReportSection,
  ReportSummary,
  TableData,
  ListItem,
  MetricItem,
  MarkdownRenderOptions,
} from '../types.js';

const DEFAULT_OPTIONS: Required<MarkdownRenderOptions> = {
  frontmatter: true,
  toc: false,
  collapsible: false,
};

export class MarkdownRenderer {
  private options: Required<MarkdownRenderOptions>;

  constructor(options: MarkdownRenderOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Render a report to markdown string
   */
  render(report: Report): string {
    const lines: string[] = [];

    if (this.options.frontmatter) {
      lines.push(...this.renderFrontmatter(report));
    }

    lines.push(`# ${report.title}`);
    lines.push('');

    if (this.options.toc) {
      lines.push(...this.renderToc(report));
    }

    lines.push(...this.renderSummary(report.summary));

    for (const section of report.sections) {
      lines.push(...this.renderSection(section));
    }

    lines.push(...this.renderFooter(report));

    return lines.join('\n');
  }

  /**
   * Render YAML frontmatter
   */
  private renderFrontmatter(report: Report): string[] {
    const lines: string[] = ['---'];

    lines.push(`title: "${report.title}"`);
    lines.push(`date: ${report.timestamp.toISOString()}`);
    lines.push(`type: ${report.type}`);
    lines.push(`passed: ${report.summary.passed}`);
    lines.push(`failed: ${report.summary.failed}`);
    lines.push(`success_rate: ${report.summary.successRate.toFixed(1)}%`);

    if (report.summary.averageScore !== undefined) {
      lines.push(`average_score: ${report.summary.averageScore.toFixed(1)}%`);
    }

    if (report.metadata) {
      for (const [key, value] of Object.entries(report.metadata)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          lines.push(`${key}: ${value}`);
        }
      }
    }

    lines.push('---');
    lines.push('');

    return lines;
  }

  /**
   * Render table of contents
   */
  private renderToc(report: Report): string[] {
    const lines: string[] = [
      '## Table of Contents',
      '',
      '- [Summary](#summary)',
    ];

    for (const section of report.sections) {
      const anchor = section.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      lines.push(`- [${section.title}](#${anchor})`);
    }

    lines.push('');
    return lines;
  }

  /**
   * Render summary section
   */
  private renderSummary(summary: ReportSummary): string[] {
    const lines: string[] = [
      '## Summary',
      '',
      '| Metric | Value |',
      '|--------|-------|',
      `| Total | ${summary.totalItems} |`,
      `| Passed | ${summary.passed} |`,
      `| Failed | ${summary.failed} |`,
      `| Success Rate | ${summary.successRate.toFixed(1)}% |`,
      `| Duration | ${this.formatDuration(summary.duration)} |`,
    ];

    if (summary.averageScore !== undefined) {
      lines.push(`| Average Score | ${summary.averageScore.toFixed(1)}% |`);
    }

    lines.push('');

    if (summary.highlights.length > 0) {
      lines.push('### Highlights');
      lines.push('');
      for (const highlight of summary.highlights) {
        lines.push(`- ${highlight}`);
      }
      lines.push('');
    }

    return lines;
  }

  /**
   * Render a report section
   */
  private renderSection(section: ReportSection): string[] {
    const lines: string[] = [];

    lines.push(`## ${section.title}`);
    lines.push('');

    if (section.description) {
      lines.push(section.description);
      lines.push('');
    }

    switch (section.content.type) {
      case 'table':
        lines.push(...this.renderTable(section.content.data));
        break;
      case 'list':
        lines.push(...this.renderList(section.content.data));
        break;
      case 'text':
        lines.push(...this.renderText(section.content.data));
        break;
      case 'metrics':
        lines.push(...this.renderMetrics(section.content.data));
        break;
    }

    return lines;
  }

  /**
   * Render a table
   */
  private renderTable(table: TableData): string[] {
    if (table.rows.length === 0) {
      return ['*No data*', ''];
    }

    const lines: string[] = [];

    // Header row
    const headers = table.columns.map(col => col.label);
    lines.push('| ' + headers.join(' | ') + ' |');

    // Alignment row
    const alignments = table.columns.map(col => {
      switch (col.align) {
        case 'center': return ':---:';
        case 'right': return '---:';
        default: return '---';
      }
    });
    lines.push('| ' + alignments.join(' | ') + ' |');

    // Data rows
    for (const row of table.rows) {
      const cells = table.columns.map(col => {
        const value = row[col.key];
        if (col.format) {
          return col.format(value);
        }
        if (value === true) return '✓';
        if (value === false) return '✗';
        return String(value ?? '');
      });
      lines.push('| ' + cells.join(' | ') + ' |');
    }

    lines.push('');
    return lines;
  }

  /**
   * Render a list
   */
  private renderList(items: ListItem[]): string[] {
    const lines: string[] = [];

    for (const item of items) {
      let marker = '-';
      if (item.status === 'success') marker = '- ✓';
      else if (item.status === 'failure') marker = '- ✗';
      else if (item.status === 'warning') marker = '- ⚠️';

      lines.push(`${marker} ${item.text}`);
      if (item.details) {
        lines.push(`  - ${item.details}`);
      }
    }

    lines.push('');
    return lines;
  }

  /**
   * Render text content
   */
  private renderText(text: string): string[] {
    return [text, ''];
  }

  /**
   * Render metrics
   */
  private renderMetrics(metrics: MetricItem[]): string[] {
    const lines: string[] = [
      '| Metric | Value |',
      '|--------|-------|',
    ];

    for (const metric of metrics) {
      let value = String(metric.value);
      if (metric.unit) {
        value += metric.unit;
      }
      lines.push(`| ${metric.label} | ${value} |`);
    }

    lines.push('');
    return lines;
  }

  /**
   * Render footer
   */
  private renderFooter(report: Report): string[] {
    return [
      '---',
      '',
      `*Generated on ${report.timestamp.toLocaleString()}*`,
      '',
    ];
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
