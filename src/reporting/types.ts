/**
 * Unified Reporting Types
 *
 * Core interfaces for the unified reporting system.
 * All evaluation types convert their results to this common format.
 */

/**
 * Report types supported by the system
 */
export type ReportType = 'tool-test' | 'code-generation' | 'evaluation' | 'batch';

/**
 * A single row in a table section
 */
export interface TableRow {
  [key: string]: string | number | boolean | null;
}

/**
 * Column definition for tables
 */
export interface TableColumn {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
  width?: number;
  format?: (value: any) => string;
}

/**
 * Table section data
 */
export interface TableData {
  columns: TableColumn[];
  rows: TableRow[];
}

/**
 * List item with optional details
 */
export interface ListItem {
  text: string;
  details?: string;
  status?: 'success' | 'failure' | 'warning' | 'info';
}

/**
 * Metric with label and value
 */
export interface MetricItem {
  label: string;
  value: string | number;
  unit?: string;
  status?: 'good' | 'bad' | 'neutral';
}

/**
 * Section types and their data structures
 */
export type SectionData =
  | { type: 'table'; data: TableData }
  | { type: 'list'; data: ListItem[] }
  | { type: 'text'; data: string }
  | { type: 'metrics'; data: MetricItem[] };

/**
 * A section within a report
 */
export interface ReportSection {
  title: string;
  description?: string;
  content: SectionData;
}

/**
 * Summary metrics for a report
 */
export interface ReportSummary {
  /** Total number of items evaluated */
  totalItems: number;

  /** Number of items that passed */
  passed: number;

  /** Number of items that failed */
  failed: number;

  /** Success rate as percentage (0-100) */
  successRate: number;

  /** Total duration in milliseconds */
  duration: number;

  /** Average score if applicable (0-100) */
  averageScore?: number;

  /** Key takeaways or highlights */
  highlights: string[];
}

/**
 * Main Report interface
 *
 * All evaluation results are converted to this unified format
 * before being rendered to console or markdown.
 */
export interface Report {
  /** Unique identifier for this report */
  id: string;

  /** Human-readable title */
  title: string;

  /** When the evaluation was run */
  timestamp: Date;

  /** Type of evaluation that generated this report */
  type: ReportType;

  /** Summary metrics */
  summary: ReportSummary;

  /** Detailed sections */
  sections: ReportSection[];

  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Options for the Reporter class
 */
export interface ReporterOptions {
  /** Enable colored output (default: true) */
  colors?: boolean;

  /** Show verbose output (default: false) */
  verbose?: boolean;

  /** Output directory for file exports */
  outputDir?: string;
}

/**
 * Options for console rendering
 */
export interface ConsoleRenderOptions {
  /** Enable colored output */
  colors?: boolean;

  /** Maximum width for tables */
  maxWidth?: number;

  /** Show full details or summary only */
  detailed?: boolean;
}

/**
 * Options for markdown rendering
 */
export interface MarkdownRenderOptions {
  /** Include YAML frontmatter */
  frontmatter?: boolean;

  /** Include table of contents */
  toc?: boolean;

  /** Use collapsible sections for details */
  collapsible?: boolean;
}
