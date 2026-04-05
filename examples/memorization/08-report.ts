/**
 * Stage 8: Generate report from memorization metrics.
 *
 * Uses the Reporter framework for structured output (console/markdown/JSON).
 * Integrates with eval combine for suite reporting.
 *
 * Usage: pnpm tsx examples/memorization/08-report.ts
 *        pnpm tsx examples/memorization/08-report.ts --format md
 *        pnpm tsx examples/memorization/08-report.ts --format json
 */

import fs from 'fs';
import path from 'path';
import { resolveRun } from '../model-showdown/shared/runner-utils.js';
import { Reporter } from '../../src/reporting/reporter.js';
import type { Report } from '../../src/reporting/types.js';
import type { BookMetrics, MemorizationConfig } from './shared/types.js';

const CONFIG_PATH = path.join(process.cwd(), 'input', 'memorization', 'config.json');
const METRICS_EVAL = 'memorization-metrics';

function loadConfig(): MemorizationConfig {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function buildReport(metrics: BookMetrics[], config: MemorizationConfig): Report {
  // Group by book
  const byBook = new Map<string, BookMetrics[]>();
  for (const m of metrics) {
    const existing = byBook.get(m.bookId) || [];
    existing.push(m);
    byBook.set(m.bookId, existing);
  }

  // Summary statistics
  const baseline = metrics.filter(m => m.modelKey === 'baseline');
  const finetuned = metrics.filter(m => m.modelKey === 'finetuned');

  const avgBaselineBmc = baseline.length > 0
    ? baseline.reduce((s, m) => s + m.bmcAtK, 0) / baseline.length
    : 0;
  const avgFinetunedBmc = finetuned.length > 0
    ? finetuned.reduce((s, m) => s + m.bmcAtK, 0) / finetuned.length
    : 0;

  const highlights: string[] = [];
  if (finetuned.length > 0) {
    highlights.push(`Finetuned model achieves ${(avgFinetunedBmc * 100).toFixed(1)}% bmc@k coverage`);
    highlights.push(`Baseline model achieves ${(avgBaselineBmc * 100).toFixed(1)}% bmc@k coverage`);
    highlights.push(`Memorization increase: ${((avgFinetunedBmc - avgBaselineBmc) * 100).toFixed(1)} percentage points`);
  }

  const sections: Report['sections'] = [];

  // Leaderboard section
  sections.push({
    title: 'Memorization Leaderboard',
    description: 'bmc@k coverage by model — higher means more verbatim memorization',
    content: {
      type: 'table' as const,
      data: {
        headers: ['Model', 'bmc@k', 'Longest Span', 'Regurgitated (>20w)', 'Total Spans', 'Book'],
        rows: metrics
          .sort((a, b) => b.bmcAtK - a.bmcAtK)
          .map(m => [
            m.modelKey,
            `${(m.bmcAtK * 100).toFixed(1)}%`,
            `${m.longestSpan} words`,
            `${m.longestRegurgitated} words`,
            String(m.spanCount),
            m.bookId,
          ]),
      },
    },
  });

  // Per-book sections
  for (const [bookId, bookMetrics] of byBook) {
    sections.push({
      title: `Book: ${bookId}`,
      description: `Detailed metrics for ${bookId}`,
      content: {
        type: 'table' as const,
        data: {
          headers: ['Model', 'bmc@k', 'Covered Words', 'Total Words', 'Longest Span', 'Regurgitated Spans'],
          rows: bookMetrics.map(m => [
            m.modelKey,
            `${(m.bmcAtK * 100).toFixed(1)}%`,
            String(m.coveredWords),
            String(m.totalBookWords),
            `${m.longestSpan} words`,
            String(m.regurgitatedSpanCount),
          ]),
        },
      },
    });
  }

  // Configuration section
  sections.push({
    title: 'Configuration',
    content: {
      type: 'list' as const,
      data: {
        items: [
          `Author: ${config.author}`,
          `Train books: ${config.trainBooks.join(', ')}`,
          `Test books: ${config.testBooks.join(', ')}`,
          `Platform: ${config.platform}`,
          `Base model: ${config.baseModel}`,
          `Samples per excerpt: ${config.samplesPerExcerpt}`,
          `Temperature: ${config.temperature}`,
          `Epochs: ${config.epochs}`,
          `LoRA rank: ${config.loraRank}`,
        ],
      },
    },
  });

  return {
    id: 'memorization-report',
    title: 'Memorization Extraction Report',
    timestamp: new Date(),
    type: 'evaluation',
    summary: {
      totalItems: metrics.length,
      passed: finetuned.filter(m => m.bmcAtK > 0.5).length,
      failed: finetuned.filter(m => m.bmcAtK <= 0.5).length,
      successRate: avgFinetunedBmc,
      duration: 0,
      averageScore: avgFinetunedBmc * 100,
      highlights,
    },
    sections,
  };
}

async function main() {
  console.log('=== Stage 8: Generate Report ===\n');

  const config = loadConfig();
  const metricsRun = resolveRun(METRICS_EVAL);

  const metricsPath = path.join(metricsRun.runDir, 'all-metrics.json');
  if (!fs.existsSync(metricsPath)) {
    console.error(`Metrics not found: ${metricsPath}`);
    console.error('Run 07-measure.ts first.');
    process.exit(1);
  }

  const metrics: BookMetrics[] = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));

  const report = buildReport(metrics, config);
  const reporter = new Reporter();

  // Parse format flag
  const formatIdx = process.argv.indexOf('--format');
  const format = formatIdx >= 0 ? process.argv[formatIdx + 1] : 'console';

  const outputIdx = process.argv.indexOf('--output');
  const outputPath = outputIdx >= 0 ? process.argv[outputIdx + 1] : null;

  switch (format) {
    case 'console':
      reporter.toConsole(report);
      break;
    case 'md':
    case 'markdown': {
      const md = reporter.toMarkdown(report);
      if (outputPath) {
        fs.writeFileSync(outputPath, md);
        console.log(`Report written to: ${outputPath}`);
      } else {
        console.log(md);
      }
      break;
    }
    case 'json': {
      const json = reporter.toJson(report, true);
      if (outputPath) {
        fs.writeFileSync(outputPath, json);
        console.log(`Report written to: ${outputPath}`);
      } else {
        console.log(json);
      }
      break;
    }
    default:
      console.error(`Unknown format: ${format}. Use console, md, or json.`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
