/**
 * Unified Reporting System
 *
 * Provides consistent report generation and rendering for all evaluation types.
 *
 * @example
 * ```typescript
 * import { Reporter } from './reporting';
 *
 * // Create reporter
 * const reporter = new Reporter();
 *
 * // Generate report from tool test results
 * const report = reporter.fromToolTest(results, 'My Evaluation');
 *
 * // Output to console
 * reporter.toConsole(report);
 *
 * // Save to markdown file
 * await reporter.toFile(report, 'my-report.md', 'md');
 * ```
 */

export { Reporter } from './reporter.js';

// Types
export type {
  Report,
  ReportType,
  ReportSection,
  ReportSummary,
  TableData,
  TableColumn,
  TableRow,
  ListItem,
  MetricItem,
  SectionData,
  ReporterOptions,
  ConsoleRenderOptions,
  MarkdownRenderOptions,
} from './types.js';

// Adapters
export {
  adaptToolTestResults,
  adaptSimpleTestResults,
  adaptSingleTestResult,
  type SimpleTestResult,
  type SimpleTestReportOptions,
} from './adapters/index.js';

// Renderers
export { ConsoleRenderer, MarkdownRenderer } from './renderers/index.js';
