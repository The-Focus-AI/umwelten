/**
 * Tool Test Adapter
 *
 * Converts ToolTestResult[] to the unified Report format.
 */

import { ToolTestResult } from '../../evaluation/tool-testing/types.js';
import {
  Report,
  ReportSection,
  ReportSummary,
  TableData,
  ListItem,
} from '../types.js';

/**
 * Convert tool test results to a unified Report
 */
export function adaptToolTestResults(
  results: ToolTestResult[],
  title: string = 'Tool Conversation Evaluation'
): Report {
  const id = `tool-test-${Date.now()}`;
  const timestamp = new Date();

  // Calculate summary
  const summary = calculateSummary(results);

  // Build sections
  const sections: ReportSection[] = [];

  // Results table
  sections.push(buildResultsSection(results));

  // Failures section (if any)
  const failedResults = results.filter(r => !r.passed);
  if (failedResults.length > 0) {
    sections.push(buildFailuresSection(failedResults));
  }

  // Timing breakdown
  sections.push(buildTimingSection(results));

  return {
    id,
    title,
    timestamp,
    type: 'tool-test',
    summary,
    sections,
    metadata: {
      scenarioCount: new Set(results.map(r => r.scenario)).size,
      modelCount: new Set(results.map(r => r.model.name)).size,
    },
  };
}

/**
 * Calculate summary metrics from results
 */
function calculateSummary(results: ToolTestResult[]): ReportSummary {
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  const successRate = results.length > 0 ? (passed / results.length) * 100 : 0;

  const totalDuration = results.reduce((sum, r) => sum + r.timing.total, 0);

  const scores = results
    .filter(r => r.score !== undefined)
    .map(r => r.score!);
  const averageScore = scores.length > 0
    ? scores.reduce((sum, s) => sum + s, 0) / scores.length
    : undefined;

  // Generate highlights
  const highlights: string[] = [];

  if (successRate === 100) {
    highlights.push('All scenarios passed');
  } else if (failed === 1) {
    const failedScenario = results.find(r => !r.passed);
    highlights.push(`1 scenario failed: ${failedScenario?.scenario}`);
  } else if (failed > 1) {
    highlights.push(`${failed} scenarios failed`);
  }

  if (averageScore !== undefined && averageScore >= 90) {
    highlights.push(`High average score: ${averageScore.toFixed(1)}%`);
  }

  const fastestResult = results.reduce((min, r) =>
    r.timing.total < min.timing.total ? r : min, results[0]);
  const slowestResult = results.reduce((max, r) =>
    r.timing.total > max.timing.total ? r : max, results[0]);

  if (fastestResult && slowestResult && results.length > 1) {
    const range = (slowestResult.timing.total - fastestResult.timing.total) / 1000;
    if (range > 5) {
      highlights.push(`Timing varied by ${range.toFixed(1)}s across scenarios`);
    }
  }

  return {
    totalItems: results.length,
    passed,
    failed,
    successRate,
    duration: totalDuration,
    averageScore,
    highlights,
  };
}

/**
 * Build the main results table section
 */
function buildResultsSection(results: ToolTestResult[]): ReportSection {
  const tableData: TableData = {
    columns: [
      { key: 'scenario', label: 'Scenario', align: 'left' },
      { key: 'model', label: 'Model', align: 'left' },
      { key: 'status', label: 'Status', align: 'center' },
      { key: 'score', label: 'Score', align: 'right' },
      { key: 'time', label: 'Time', align: 'right' },
    ],
    rows: results.map(r => ({
      scenario: r.scenario,
      model: r.model.name,
      status: r.passed,
      score: r.score !== undefined ? `${r.score}%` : '-',
      time: `${(r.timing.total / 1000).toFixed(1)}s`,
    })),
  };

  return {
    title: 'Results',
    content: { type: 'table', data: tableData },
  };
}

/**
 * Build the failures section
 */
function buildFailuresSection(failedResults: ToolTestResult[]): ReportSection {
  const items: ListItem[] = [];

  for (const result of failedResults) {
    // Get failure reasons from steps
    const failures: string[] = [];
    for (const step of result.steps) {
      if (!step.passed) {
        failures.push(...step.failures);
      }
    }

    // Also include top-level errors
    failures.push(...result.errors);

    items.push({
      text: `${result.scenario} (${result.model.name})`,
      details: failures.length > 0 ? failures.join('; ') : 'Unknown failure',
      status: 'failure',
    });
  }

  return {
    title: 'Failures',
    content: { type: 'list', data: items },
  };
}

/**
 * Build timing breakdown section
 */
function buildTimingSection(results: ToolTestResult[]): ReportSection {
  const tableData: TableData = {
    columns: [
      { key: 'scenario', label: 'Scenario', align: 'left' },
      { key: 'model', label: 'Model', align: 'left' },
      { key: 'steps', label: 'Steps', align: 'center' },
      { key: 'avgStepTime', label: 'Avg Step', align: 'right' },
      { key: 'totalTime', label: 'Total', align: 'right' },
    ],
    rows: results.map(r => {
      const stepCount = r.steps.length;
      const avgStepTime = stepCount > 0
        ? r.timing.total / stepCount
        : 0;

      return {
        scenario: r.scenario,
        model: r.model.name,
        steps: stepCount,
        avgStepTime: `${(avgStepTime / 1000).toFixed(1)}s`,
        totalTime: `${(r.timing.total / 1000).toFixed(1)}s`,
      };
    }),
  };

  return {
    title: 'Timing',
    content: { type: 'table', data: tableData },
  };
}
