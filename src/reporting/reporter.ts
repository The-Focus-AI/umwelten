/**
 * Reporter
 *
 * Main class for generating and rendering reports from evaluation results.
 */

import fs from 'fs/promises';
import path from 'path';
import { ToolTestResult } from '../evaluation/tool-testing/types.js';
import {
  Report,
  ReporterOptions,
  ConsoleRenderOptions,
  MarkdownRenderOptions,
} from './types.js';
import { adaptToolTestResults } from './adapters/index.js';
import { ConsoleRenderer } from './renderers/console-renderer.js';
import { MarkdownRenderer } from './renderers/markdown-renderer.js';

const DEFAULT_OPTIONS: Required<ReporterOptions> = {
  colors: true,
  verbose: false,
  outputDir: './reports',
};

export class Reporter {
  private options: Required<ReporterOptions>;
  private consoleRenderer: ConsoleRenderer;
  private markdownRenderer: MarkdownRenderer;

  constructor(options: ReporterOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.consoleRenderer = new ConsoleRenderer({ colors: this.options.colors });
    this.markdownRenderer = new MarkdownRenderer({ frontmatter: true });
  }

  /**
   * Create a report from tool test results
   */
  fromToolTest(results: ToolTestResult[], title?: string): Report {
    return adaptToolTestResults(results, title);
  }

  /**
   * Render a report to the console
   */
  toConsole(report: Report, options?: ConsoleRenderOptions): void {
    const renderer = options
      ? new ConsoleRenderer(options)
      : this.consoleRenderer;
    renderer.render(report);
  }

  /**
   * Render a report to markdown string
   */
  toMarkdown(report: Report, options?: MarkdownRenderOptions): string {
    const renderer = options
      ? new MarkdownRenderer(options)
      : this.markdownRenderer;
    return renderer.render(report);
  }

  /**
   * Render a report to JSON string
   */
  toJson(report: Report, pretty: boolean = true): string {
    return JSON.stringify(report, null, pretty ? 2 : 0);
  }

  /**
   * Save a report to a file
   */
  async toFile(
    report: Report,
    filename?: string,
    format: 'md' | 'json' = 'md'
  ): Promise<string> {
    // Generate filename if not provided
    if (!filename) {
      const dateStr = report.timestamp.toISOString().split('T')[0];
      const typeStr = report.type;
      filename = `${dateStr}-${typeStr}-report.${format}`;
    }

    // Ensure output directory exists
    await fs.mkdir(this.options.outputDir, { recursive: true });

    const filepath = path.join(this.options.outputDir, filename);

    // Generate content based on format
    let content: string;
    if (format === 'md') {
      content = this.toMarkdown(report);
    } else {
      content = this.toJson(report);
    }

    await fs.writeFile(filepath, content, 'utf-8');

    return filepath;
  }

  /**
   * Generate console output and optionally save to file
   */
  async report(
    report: Report,
    options: {
      console?: boolean;
      file?: boolean;
      format?: 'md' | 'json';
      filename?: string;
    } = {}
  ): Promise<string | undefined> {
    const {
      console: toConsole = true,
      file = false,
      format = 'md',
      filename,
    } = options;

    if (toConsole) {
      this.toConsole(report);
    }

    if (file) {
      return await this.toFile(report, filename, format);
    }

    return undefined;
  }
}
