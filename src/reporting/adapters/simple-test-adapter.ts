/**
 * Simple Test Adapter
 *
 * Helper utilities for creating reports from simple test results.
 * Use this for ad-hoc tests that don't fit the full evaluation framework.
 */

import {
  Report,
  ReportSection,
  ReportSummary,
  ReportType,
  ListItem,
  MetricItem,
} from '../types.js';

/**
 * Simple test result structure
 */
export interface SimpleTestResult {
  name: string;
  success: boolean;
  details?: string;
  duration?: number;
  metrics?: Record<string, string | number>;
}

/**
 * Options for building a simple test report
 */
export interface SimpleTestReportOptions {
  title: string;
  type?: ReportType;
  additionalSections?: ReportSection[];
  metadata?: Record<string, any>;
}

/**
 * Build a report from simple test results
 */
export function adaptSimpleTestResults(
  results: SimpleTestResult[],
  options: SimpleTestReportOptions
): Report {
  const { title, type = 'evaluation', additionalSections = [], metadata = {} } = options;

  const id = `simple-test-${Date.now()}`;
  const timestamp = new Date();

  const passed = results.filter((r) => r.success).length;
  const failed = results.length - passed;
  const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);

  // Build highlights
  const highlights: string[] = [];
  if (passed === results.length) {
    highlights.push('All tests passed');
  } else if (failed === 1) {
    const failedTest = results.find((r) => !r.success);
    highlights.push(`1 test failed: ${failedTest?.name}`);
  } else if (failed > 1) {
    highlights.push(`${failed} tests failed`);
  }

  const summary: ReportSummary = {
    totalItems: results.length,
    passed,
    failed,
    successRate: results.length > 0 ? (passed / results.length) * 100 : 0,
    duration: totalDuration,
    highlights,
  };

  // Build results section
  const resultItems: ListItem[] = results.map((r) => ({
    text: r.name,
    details: r.details || (r.success ? 'Passed' : 'Failed'),
    status: r.success ? 'success' : 'failure',
  }));

  const sections: ReportSection[] = [
    {
      title: 'Test Results',
      content: { type: 'list', data: resultItems },
    },
  ];

  // Add metrics section if any results have metrics
  const resultsWithMetrics = results.filter((r) => r.metrics);
  if (resultsWithMetrics.length > 0) {
    const metricsData: MetricItem[] = [];
    for (const result of resultsWithMetrics) {
      if (result.metrics) {
        for (const [key, value] of Object.entries(result.metrics)) {
          metricsData.push({
            label: `${result.name}: ${key}`,
            value,
          });
        }
      }
    }
    sections.push({
      title: 'Metrics',
      content: { type: 'metrics', data: metricsData },
    });
  }

  // Add any additional sections
  sections.push(...additionalSections);

  return {
    id,
    title,
    timestamp,
    type,
    summary,
    sections,
    metadata,
  };
}

/**
 * Create a single-test report
 */
export function adaptSingleTestResult(
  name: string,
  success: boolean,
  options: {
    title?: string;
    type?: ReportType;
    details?: string;
    duration?: number;
    metrics?: Record<string, string | number>;
    sections?: ReportSection[];
    metadata?: Record<string, any>;
  } = {}
): Report {
  const result: SimpleTestResult = {
    name,
    success,
    details: options.details,
    duration: options.duration,
    metrics: options.metrics,
  };

  return adaptSimpleTestResults([result], {
    title: options.title || name,
    type: options.type,
    additionalSections: options.sections,
    metadata: options.metadata,
  });
}
