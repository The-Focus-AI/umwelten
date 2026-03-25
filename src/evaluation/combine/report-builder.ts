/**
 * Report Builder for Suite Results
 *
 * Converts a SuiteResult into the unified Report format.
 * Builds both summary leaderboards and detailed per-dimension breakdowns
 * showing every task, every model's answer, and why it scored what it did.
 */

import type { Report, ReportSection, TableColumn, TableRow } from '../../reporting/types.js';
import type { SuiteResult, ModelScorecard, TaskResult } from './types.js';

export interface SuiteReportOptions {
  title?: string;
  focusModels?: string[];  // substring match for deep-dive section
  /** Include full per-task breakdowns (default: true) */
  detailed?: boolean;
}

/**
 * Build a Report from a SuiteResult.
 */
export function buildSuiteReport(
  suiteResult: SuiteResult,
  options?: SuiteReportOptions
): Report {
  const title = options?.title || 'Evaluation Suite — Combined Results';
  const sections: ReportSection[] = [];
  const detailed = options?.detailed !== false; // default true

  // Gather dimension names in order from runInfo
  const dimNames = suiteResult.runInfo.map(ri => ri.evalName);
  const dimLabels = new Map(suiteResult.runInfo.map(ri => [ri.evalName, ri.label]));

  // ---- 1. Overall Leaderboard ----
  sections.push(buildLeaderboard(suiteResult.scorecards, dimNames, dimLabels));

  // ---- 2. Provider Breakdown ----
  sections.push(buildProviderBreakdown(suiteResult.scorecards));

  // ---- 3. Detailed per-dimension sections ----
  if (detailed) {
    for (const ri of suiteResult.runInfo) {
      const taskResults = suiteResult.taskResults.get(ri.evalName) || [];
      const modelKeys = new Set(suiteResult.scorecards.map(sc => sc.modelKey));
      // Only include results for models in the combined scorecards
      const filteredResults = taskResults.filter(tr => modelKeys.has(tr.modelKey));

      const detailSections = buildDimensionDetail(ri.evalName, ri.label, filteredResults, suiteResult.scorecards);
      sections.push(...detailSections);
    }
  }

  // ---- 4. Cost Efficiency ----
  sections.push(buildCostEfficiency(suiteResult.scorecards));

  // ---- 5. Speed Leaderboard ----
  sections.push(buildSpeedLeaderboard(suiteResult.scorecards));

  // ---- 6. Focus Model Comparison (optional) ----
  if (options?.focusModels && options.focusModels.length > 0) {
    const focusSection = buildFocusComparison(
      suiteResult.scorecards,
      options.focusModels,
      dimNames,
      dimLabels
    );
    if (focusSection) sections.push(focusSection);
  }

  // ---- 7. Run Info ----
  sections.push(buildRunInfo(suiteResult));

  // Summary
  const totalModels = suiteResult.scorecards.length;
  const totalCost = suiteResult.scorecards.reduce((s, sc) => s + sc.totalCost, 0);
  const topModel = suiteResult.scorecards[0];

  return {
    id: `suite-${Date.now()}`,
    title,
    timestamp: suiteResult.timestamp,
    type: 'suite',
    summary: {
      totalItems: totalModels,
      passed: totalModels,
      failed: 0,
      successRate: 100,
      duration: suiteResult.scorecards.reduce((s, sc) => s + sc.totalDurationMs, 0),
      averageScore: totalModels > 0
        ? suiteResult.scorecards.reduce((s, sc) => s + sc.combinedPct, 0) / totalModels
        : 0,
      highlights: [
        `${totalModels} models compared across ${dimNames.length} dimensions`,
        topModel ? `Top model: ${topModel.model} (${topModel.combinedPct.toFixed(1)}%)` : 'No models',
        `Total cost: $${totalCost.toFixed(4)}`,
      ],
    },
    sections,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Overall Leaderboard
// ─────────────────────────────────────────────────────────────────────────────

function buildLeaderboard(
  scorecards: ModelScorecard[],
  dimNames: string[],
  dimLabels: Map<string, string>
): ReportSection {
  const columns: TableColumn[] = [
    { key: 'rank', label: 'Rank', align: 'right', width: 4 },
    { key: 'model', label: 'Model', align: 'left', width: 48 },
    { key: 'provider', label: 'Provider', align: 'left', width: 12 },
  ];

  for (const dn of dimNames) {
    const label = dimLabels.get(dn) || dn;
    columns.push({ key: dn, label, align: 'right', width: 8 });
  }

  columns.push(
    { key: 'combined', label: 'Combined %', align: 'right', width: 10 },
    { key: 'cost', label: 'Cost $', align: 'right', width: 8 },
    { key: 'time', label: 'Time (s)', align: 'right', width: 8 },
  );

  const rows: TableRow[] = scorecards.map((sc, i) => {
    const row: TableRow = {
      rank: i + 1,
      model: sc.model,
      provider: sc.provider,
    };
    for (const dn of dimNames) {
      const ds = sc.dimensions.get(dn);
      row[dn] = ds ? `${ds.rawScore}/${ds.maxScore}` : 'N/A';
    }
    row.combined = `${sc.combinedPct.toFixed(1)}%`;
    row.cost = sc.totalCost > 0 ? `$${sc.totalCost.toFixed(4)}` : 'Free';
    row.time = (sc.totalDurationMs / 1000).toFixed(1);
    return row;
  });

  return {
    title: 'Overall Leaderboard',
    description: 'Models ranked by combined score across all dimensions',
    content: { type: 'table', data: { columns, rows } },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider Breakdown
// ─────────────────────────────────────────────────────────────────────────────

function buildProviderBreakdown(scorecards: ModelScorecard[]): ReportSection {
  // Group by provider
  const byProvider = new Map<string, ModelScorecard[]>();
  for (const sc of scorecards) {
    const list = byProvider.get(sc.provider) || [];
    list.push(sc);
    byProvider.set(sc.provider, list);
  }

  const columns: TableColumn[] = [
    { key: 'provider', label: 'Provider', align: 'left', width: 14 },
    { key: 'models', label: 'Models', align: 'right', width: 6 },
    { key: 'avgScore', label: 'Avg Score %', align: 'right', width: 10 },
    { key: 'bestModel', label: 'Best Model', align: 'left', width: 40 },
    { key: 'bestScore', label: 'Best %', align: 'right', width: 8 },
    { key: 'totalCost', label: 'Total Cost', align: 'right', width: 10 },
  ];

  const rows: TableRow[] = [];
  for (const [provider, models] of [...byProvider.entries()].sort((a, b) => {
    const avgA = a[1].reduce((s, m) => s + m.combinedPct, 0) / a[1].length;
    const avgB = b[1].reduce((s, m) => s + m.combinedPct, 0) / b[1].length;
    return avgB - avgA;
  })) {
    const avg = models.reduce((s, m) => s + m.combinedPct, 0) / models.length;
    const best = models.reduce((a, b) => a.combinedPct > b.combinedPct ? a : b);
    const cost = models.reduce((s, m) => s + m.totalCost, 0);
    rows.push({
      provider,
      models: models.length,
      avgScore: `${avg.toFixed(1)}%`,
      bestModel: best.model,
      bestScore: `${best.combinedPct.toFixed(1)}%`,
      totalCost: cost > 0 ? `$${cost.toFixed(4)}` : 'Free',
    });
  }

  return {
    title: 'Provider Breakdown',
    description: 'Performance summary by inference provider',
    content: { type: 'table', data: { columns, rows } },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dimension Detail Builders
// ─────────────────────────────────────────────────────────────────────────────

function buildDimensionDetail(
  evalName: string,
  label: string,
  taskResults: TaskResult[],
  scorecards: ModelScorecard[]
): ReportSection[] {
  if (evalName.includes('reasoning')) return buildReasoningDetail(label, taskResults, scorecards);
  if (evalName.includes('knowledge')) return buildKnowledgeDetail(label, taskResults, scorecards);
  if (evalName.includes('instruction')) return buildInstructionDetail(label, taskResults, scorecards);
  if (evalName.includes('coding')) return buildCodingDetail(label, taskResults, scorecards);
  if (evalName.includes('mcp')) return buildMcpDetail(label, taskResults, scorecards);
  return [buildGenericDetail(label, taskResults, scorecards)];
}

// ── Reasoning Detail ─────────────────────────────────────────────────────────

function buildReasoningDetail(
  label: string,
  taskResults: TaskResult[],
  scorecards: ModelScorecard[]
): ReportSection[] {
  const sections: ReportSection[] = [];

  // Get unique puzzles
  const puzzles = [...new Set(taskResults.map(tr => tr.taskId))].sort();

  // Per-puzzle breakdown: model × puzzle matrix
  const columns: TableColumn[] = [
    { key: 'model', label: 'Model', align: 'left', width: 40 },
  ];
  for (const p of puzzles) {
    columns.push({ key: p, label: p, align: 'center', width: 14 });
  }
  columns.push({ key: 'total', label: 'Total/20', align: 'right', width: 8 });

  // Sort models by total reasoning score
  const modelOrder = [...scorecards].sort((a, b) => {
    const aDs = a.dimensions.get('model-showdown-reasoning');
    const bDs = b.dimensions.get('model-showdown-reasoning');
    return (bDs?.rawScore || 0) - (aDs?.rawScore || 0);
  });

  const rows: TableRow[] = modelOrder.map(sc => {
    const row: TableRow = { model: sc.model };
    let total = 0;
    for (const p of puzzles) {
      const tr = taskResults.find(t => t.taskId === p && t.modelKey === sc.modelKey);
      if (tr) {
        const correct = tr.raw.correct || tr.raw.judge?.correct;
        const quality = tr.score;
        const marker = correct ? `${quality}/5` : `${quality}/5 x`;
        row[p] = marker;
        total += quality;
      } else {
        row[p] = '-';
      }
    }
    row.total = `${total}/20`;
    return row;
  });

  sections.push({
    title: `${label} — Per-Puzzle Breakdown`,
    description: 'Score per puzzle (x = incorrect answer). Each puzzle scored 1-5 on reasoning quality.',
    content: { type: 'table', data: { columns, rows } },
  });

  // Detail: which models fell for traps?
  const trapItems = taskResults
    .filter(tr => tr.raw.judge?.fell_for_trap === true)
    .map(tr => ({
      text: `${parseModelKey(tr.modelKey).model} on "${tr.taskId}": fell for the intuitive trap`,
      details: tr.raw.judge?.explanation || '',
      status: 'failure' as const,
    }));

  const correctItems = taskResults
    .filter(tr => tr.raw.correct && tr.score === 5)
    .map(tr => ({
      text: `${parseModelKey(tr.modelKey).model} on "${tr.taskId}": perfect score (5/5)`,
      status: 'success' as const,
    }));

  if (trapItems.length > 0 || correctItems.length > 0) {
    sections.push({
      title: `${label} — Notable Results`,
      description: 'Models that fell for traps vs. achieved perfect reasoning',
      content: { type: 'list', data: [...trapItems, ...correctItems] },
    });
  }

  return sections;
}

// ── Knowledge Detail ─────────────────────────────────────────────────────────

function buildKnowledgeDetail(
  label: string,
  taskResults: TaskResult[],
  scorecards: ModelScorecard[]
): ReportSection[] {
  const sections: ReportSection[] = [];

  // Group by category (from questionId prefix or category field)
  const categories = new Map<string, TaskResult[]>();
  for (const tr of taskResults) {
    const cat = tr.raw.category || tr.taskId.replace(/-\d+$/, '');
    const list = categories.get(cat) || [];
    list.push(tr);
    categories.set(cat, list);
  }

  // Per-category accuracy table
  const catNames = [...categories.keys()].sort();
  const columns: TableColumn[] = [
    { key: 'model', label: 'Model', align: 'left', width: 40 },
  ];
  for (const cat of catNames) {
    columns.push({ key: cat, label: cat, align: 'right', width: 10 });
  }
  columns.push({ key: 'total', label: 'Total/30', align: 'right', width: 8 });

  const modelOrder = [...scorecards].sort((a, b) => {
    const aDs = a.dimensions.get('model-showdown-knowledge');
    const bDs = b.dimensions.get('model-showdown-knowledge');
    return (bDs?.rawScore || 0) - (aDs?.rawScore || 0);
  });

  const rows: TableRow[] = modelOrder.map(sc => {
    const row: TableRow = { model: sc.model };
    let total = 0;
    for (const cat of catNames) {
      const catResults = categories.get(cat) || [];
      const modelResults = catResults.filter(tr => tr.modelKey === sc.modelKey);
      const correct = modelResults.filter(tr => tr.raw.correct).length;
      const count = modelResults.length;
      row[cat] = `${correct}/${count}`;
      total += correct;
    }
    row.total = `${total}/30`;
    return row;
  });

  sections.push({
    title: `${label} — By Category`,
    description: 'Correct answers per knowledge category',
    content: { type: 'table', data: { columns, rows } },
  });

  // Hardest questions: which questions did the most models get wrong?
  const questionIds = [...new Set(taskResults.map(tr => tr.taskId))].sort();
  const hardQuestions: { qid: string; wrongCount: number; totalModels: number; correctAnswer: string; wrongModels: string[] }[] = [];

  for (const qid of questionIds) {
    const qResults = taskResults.filter(tr => tr.taskId === qid);
    const wrong = qResults.filter(tr => !tr.raw.correct);
    if (wrong.length > 0) {
      const correctAnswer = qResults[0]?.raw.correctAnswer || '?';
      hardQuestions.push({
        qid,
        wrongCount: wrong.length,
        totalModels: qResults.length,
        correctAnswer,
        wrongModels: wrong.map(tr => parseModelKey(tr.modelKey).model),
      });
    }
  }

  hardQuestions.sort((a, b) => b.wrongCount - a.wrongCount);

  if (hardQuestions.length > 0) {
    const items = hardQuestions.slice(0, 15).map(hq => ({
      text: `${hq.qid}: ${hq.wrongCount}/${hq.totalModels} models wrong (answer: ${hq.correctAnswer})`,
      details: `Wrong: ${hq.wrongModels.join(', ')}`,
      status: (hq.wrongCount > hq.totalModels / 2 ? 'failure' : 'warning') as 'failure' | 'warning',
    }));

    sections.push({
      title: `${label} — Hardest Questions`,
      description: 'Questions that tripped up the most models',
      content: { type: 'list', data: items },
    });
  }

  return sections;
}

// ── Instruction Detail ───────────────────────────────────────────────────────

function buildInstructionDetail(
  label: string,
  taskResults: TaskResult[],
  scorecards: ModelScorecard[]
): ReportSection[] {
  const sections: ReportSection[] = [];

  const taskIds = [...new Set(taskResults.map(tr => tr.taskId))].sort();

  // Per-task score matrix
  const columns: TableColumn[] = [
    { key: 'model', label: 'Model', align: 'left', width: 40 },
  ];
  for (const tid of taskIds) {
    const taskName = taskResults.find(tr => tr.taskId === tid)?.raw.taskName || tid;
    columns.push({ key: tid, label: taskName, align: 'right', width: 12 });
  }
  columns.push({ key: 'total', label: 'Total/30', align: 'right', width: 8 });

  const modelOrder = [...scorecards].sort((a, b) => {
    const aDs = a.dimensions.get('model-showdown-instruction');
    const bDs = b.dimensions.get('model-showdown-instruction');
    return (bDs?.rawScore || 0) - (aDs?.rawScore || 0);
  });

  const rows: TableRow[] = modelOrder.map(sc => {
    const row: TableRow = { model: sc.model };
    let total = 0;
    for (const tid of taskIds) {
      const tr = taskResults.find(t => t.taskId === tid && t.modelKey === sc.modelKey);
      if (tr) {
        row[tid] = `${tr.score}/5`;
        total += tr.score;
      } else {
        row[tid] = '-';
      }
    }
    row.total = `${total}/30`;
    return row;
  });

  sections.push({
    title: `${label} — Per-Task Scores`,
    description: 'Each task scored 0-5 on constraint compliance',
    content: { type: 'table', data: { columns, rows } },
  });

  // Failure details: which models lost points and why
  const failItems = taskResults
    .filter(tr => tr.score < 5)
    .sort((a, b) => a.score - b.score)
    .slice(0, 20)
    .map(tr => {
      const taskName = tr.raw.taskName || tr.taskId;
      const details = tr.raw.details || '';
      return {
        text: `${parseModelKey(tr.modelKey).model} on "${taskName}": ${tr.score}/5`,
        details: details || undefined,
        status: (tr.score <= 2 ? 'failure' : 'warning') as 'failure' | 'warning',
      };
    });

  if (failItems.length > 0) {
    sections.push({
      title: `${label} — Constraint Violations`,
      description: 'Where models lost points (worst first, top 20)',
      content: { type: 'list', data: failItems },
    });
  }

  return sections;
}

// ── Coding Detail ────────────────────────────────────────────────────────────

function buildCodingDetail(
  label: string,
  taskResults: TaskResult[],
  scorecards: ModelScorecard[]
): ReportSection[] {
  const sections: ReportSection[] = [];

  // Parse challenge-language from taskId (e.g., "business-days-go" → challenge="business-days", lang="go")
  interface CodingTask {
    taskId: string;
    challenge: string;
    language: string;
  }

  const parsedTasks: CodingTask[] = [];
  const taskIds = [...new Set(taskResults.map(tr => tr.taskId))].sort();
  for (const tid of taskIds) {
    // Use the raw data to get language, or parse from the taskId
    const sample = taskResults.find(tr => tr.taskId === tid);
    const lang = sample?.raw.language || tid.split('-').pop() || '?';
    const challenge = sample?.raw.challengeId || tid.replace(new RegExp(`-${lang}$`), '');
    parsedTasks.push({ taskId: tid, challenge, language: lang });
  }

  // Group by challenge
  const challenges = [...new Set(parsedTasks.map(pt => pt.challenge))].sort();
  const languages = [...new Set(parsedTasks.map(pt => pt.language))].sort();

  // Per-challenge × language matrix
  const columns: TableColumn[] = [
    { key: 'model', label: 'Model', align: 'left', width: 40 },
  ];
  for (const ch of challenges) {
    for (const lang of languages) {
      columns.push({ key: `${ch}-${lang}`, label: `${ch} (${lang})`, align: 'right', width: 10 });
    }
  }
  columns.push({ key: 'total', label: 'Total/126', align: 'right', width: 9 });

  const modelOrder = [...scorecards].sort((a, b) => {
    const aDs = a.dimensions.get('model-showdown-coding');
    const bDs = b.dimensions.get('model-showdown-coding');
    return (bDs?.rawScore || 0) - (aDs?.rawScore || 0);
  });

  const rows: TableRow[] = modelOrder.map(sc => {
    const row: TableRow = { model: sc.model };
    let total = 0;
    for (const ch of challenges) {
      for (const lang of languages) {
        const tid = parsedTasks.find(pt => pt.challenge === ch && pt.language === lang)?.taskId;
        const tr = tid ? taskResults.find(t => t.taskId === tid && t.modelKey === sc.modelKey) : undefined;
        if (tr) {
          const compiled = tr.raw.compiled ? 'C' : 'x';
          const ran = tr.raw.ran ? 'R' : 'x';
          const verify = tr.raw.verifyScore ?? 0;
          row[`${ch}-${lang}`] = `${tr.score}/7 ${compiled}${ran}`;
          total += tr.score;
        } else {
          row[`${ch}-${lang}`] = '-';
        }
      }
    }
    row.total = `${total}/126`;
    return row;
  });

  sections.push({
    title: `${label} — Challenge Matrix`,
    description: 'Score per challenge/language (C=compiled, R=ran, x=failed). Each: compile(1) + run(1) + verify(0-5) = /7',
    content: { type: 'table', data: { columns, rows } },
  });

  // Compilation & execution summary
  const compileStats = {
    total: taskResults.length,
    compiled: taskResults.filter(tr => tr.raw.compiled).length,
    ran: taskResults.filter(tr => tr.raw.ran).length,
    perfect: taskResults.filter(tr => tr.score === 7).length,
    zero: taskResults.filter(tr => tr.score === 0).length,
  };

  sections.push({
    title: `${label} — Execution Summary`,
    content: {
      type: 'metrics',
      data: [
        { label: 'Total submissions', value: compileStats.total },
        { label: 'Compiled successfully', value: `${compileStats.compiled}/${compileStats.total} (${(compileStats.compiled / compileStats.total * 100).toFixed(0)}%)`, status: compileStats.compiled > compileStats.total * 0.8 ? 'good' : 'bad' },
        { label: 'Ran successfully', value: `${compileStats.ran}/${compileStats.total} (${(compileStats.ran / compileStats.total * 100).toFixed(0)}%)`, status: compileStats.ran > compileStats.total * 0.7 ? 'good' : 'bad' },
        { label: 'Perfect scores (7/7)', value: compileStats.perfect, status: 'good' },
        { label: 'Total failures (0/7)', value: compileStats.zero, status: compileStats.zero > 0 ? 'bad' : 'good' },
      ],
    },
  });

  // Failures: which model/challenge combos failed to compile or produce correct output
  const failures = taskResults
    .filter(tr => !tr.raw.compiled || !tr.raw.ran || tr.score <= 2)
    .sort((a, b) => a.score - b.score)
    .slice(0, 25)
    .map(tr => {
      const lang = tr.raw.language || '?';
      const challenge = tr.raw.challengeId || tr.taskId;
      const model = parseModelKey(tr.modelKey).model;
      let reason = '';
      if (!tr.raw.compiled) reason = 'DID NOT COMPILE';
      else if (!tr.raw.ran) reason = 'COMPILED BUT CRASHED';
      else reason = `verify ${tr.raw.verifyScore}/5: ${tr.raw.verifyDetails || 'partial'}`;

      const stderr = tr.raw.stderr ? `\nstderr: ${tr.raw.stderr.slice(0, 200)}` : '';
      return {
        text: `${model} — ${challenge} (${lang}): ${tr.score}/7 — ${reason}`,
        details: stderr || undefined,
        status: (tr.score === 0 ? 'failure' : 'warning') as 'failure' | 'warning',
      };
    });

  if (failures.length > 0) {
    sections.push({
      title: `${label} — Failures & Partial Scores`,
      description: 'Challenges where models failed to compile, run, or pass verification (worst first, top 25)',
      content: { type: 'list', data: failures },
    });
  }

  // Language comparison: which language did models do best in?
  const langColumns: TableColumn[] = [
    { key: 'language', label: 'Language', align: 'left', width: 12 },
    { key: 'avgScore', label: 'Avg Score', align: 'right', width: 10 },
    { key: 'compileRate', label: 'Compile %', align: 'right', width: 10 },
    { key: 'runRate', label: 'Run %', align: 'right', width: 10 },
    { key: 'perfectRate', label: 'Perfect %', align: 'right', width: 10 },
  ];

  const langRows: TableRow[] = languages.map(lang => {
    const langResults = taskResults.filter(tr => (tr.raw.language || tr.taskId.split('-').pop()) === lang);
    const avg = langResults.length > 0 ? langResults.reduce((s, tr) => s + tr.score, 0) / langResults.length : 0;
    const compiled = langResults.filter(tr => tr.raw.compiled).length;
    const ran = langResults.filter(tr => tr.raw.ran).length;
    const perfect = langResults.filter(tr => tr.score === 7).length;
    return {
      language: lang,
      avgScore: `${avg.toFixed(1)}/7`,
      compileRate: `${(compiled / langResults.length * 100).toFixed(0)}%`,
      runRate: `${(ran / langResults.length * 100).toFixed(0)}%`,
      perfectRate: `${(perfect / langResults.length * 100).toFixed(0)}%`,
    };
  });

  sections.push({
    title: `${label} — Language Comparison`,
    description: 'How well models performed across programming languages',
    content: { type: 'table', data: { columns: langColumns, rows: langRows } },
  });

  return sections;
}

// ── MCP Detail ──────────────────────────────────────────────────────────────

function buildMcpDetail(
  label: string,
  taskResults: TaskResult[],
  scorecards: ModelScorecard[]
): ReportSection[] {
  const sections: ReportSection[] = [];

  const columns: TableColumn[] = [
    { key: 'model', label: 'Model', align: 'left', width: 40 },
    { key: 'toolScore', label: 'Tool Score', align: 'right', width: 10 },
    { key: 'judgeScore', label: 'Judge Score', align: 'right', width: 10 },
    { key: 'total', label: 'Total/16', align: 'right', width: 8 },
    { key: 'toolsCalled', label: 'Tools Called', align: 'left', width: 40 },
    { key: 'time', label: 'Time', align: 'right', width: 8 },
    { key: 'cost', label: 'Cost', align: 'right', width: 8 },
  ];

  const modelOrder = [...scorecards].sort((a, b) => {
    const aDs = a.dimensions.get('model-showdown-mcp');
    const bDs = b.dimensions.get('model-showdown-mcp');
    return (bDs?.rawScore || 0) - (aDs?.rawScore || 0);
  });

  const rows: TableRow[] = modelOrder.map(sc => {
    const tr = taskResults.find(t => t.modelKey === sc.modelKey);
    if (!tr) return { model: sc.model, toolScore: '-', judgeScore: '-', total: '-', toolsCalled: '-', time: '-', cost: '-' };

    const toolScore = tr.raw.toolUsage?.tool_score ?? 0;
    const judgeScore = tr.raw.judge?.overall_score ?? 0;
    const calls = (tr.raw.toolUsage?.calls || []) as Array<{ name: string }>;
    const toolNames = [...new Set(calls.map((c: { name: string }) => c.name))].join(', ');

    return {
      model: sc.model,
      toolScore: `${toolScore}/6`,
      judgeScore: `${judgeScore}/10`,
      total: `${tr.score}/16`,
      toolsCalled: toolNames || 'none',
      time: `${(tr.durationMs / 1000).toFixed(1)}s`,
      cost: tr.cost > 0 ? `$${tr.cost.toFixed(4)}` : 'Free',
    };
  });

  sections.push({
    title: `${label} — Detailed Results`,
    description: 'Tool score (0-6) + LLM judge quality score (1-10) = /16. Models must discover and use MCP tools to analyze real data.',
    content: { type: 'table', data: { columns, rows } },
  });

  // Judge explanations
  const judgeItems = taskResults
    .filter(tr => tr.raw.judge?.explanation)
    .sort((a, b) => b.score - a.score)
    .map(tr => ({
      text: `${parseModelKey(tr.modelKey).model}: ${tr.score}/16`,
      details: tr.raw.judge.explanation.slice(0, 300),
      status: (tr.score >= 14 ? 'success' : tr.score >= 10 ? 'warning' : 'failure') as 'success' | 'warning' | 'failure',
    }));

  if (judgeItems.length > 0) {
    sections.push({
      title: `${label} — Judge Explanations`,
      description: 'Why each model received its judge score',
      content: { type: 'list', data: judgeItems },
    });
  }

  return sections;
}

// ── Generic Detail (fallback) ────────────────────────────────────────────────

function buildGenericDetail(
  label: string,
  taskResults: TaskResult[],
  scorecards: ModelScorecard[]
): ReportSection {
  const taskIds = [...new Set(taskResults.map(tr => tr.taskId))].sort();

  const columns: TableColumn[] = [
    { key: 'model', label: 'Model', align: 'left', width: 40 },
  ];
  for (const tid of taskIds) {
    columns.push({ key: tid, label: tid, align: 'right', width: 8 });
  }
  columns.push({ key: 'total', label: 'Total', align: 'right', width: 8 });

  const rows: TableRow[] = scorecards.map(sc => {
    const row: TableRow = { model: sc.model };
    let total = 0;
    for (const tid of taskIds) {
      const tr = taskResults.find(t => t.taskId === tid && t.modelKey === sc.modelKey);
      row[tid] = tr ? tr.score : '-';
      total += tr?.score || 0;
    }
    row.total = total;
    return row;
  });

  return {
    title: `${label} — Per-Task Breakdown`,
    content: { type: 'table', data: { columns, rows } },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost & Speed
// ─────────────────────────────────────────────────────────────────────────────

function buildCostEfficiency(scorecards: ModelScorecard[]): ReportSection {
  const sorted = [...scorecards].sort((a, b) => {
    const aEff = a.totalCost > 0 ? a.combinedPct / a.totalCost : Infinity;
    const bEff = b.totalCost > 0 ? b.combinedPct / b.totalCost : Infinity;
    return bEff - aEff;
  });

  const columns: TableColumn[] = [
    { key: 'rank', label: 'Rank', align: 'right', width: 4 },
    { key: 'model', label: 'Model', align: 'left', width: 48 },
    { key: 'combined', label: 'Combined %', align: 'right', width: 10 },
    { key: 'cost', label: 'Total Cost', align: 'right', width: 10 },
    { key: 'efficiency', label: 'Score/$', align: 'right', width: 10 },
  ];

  const rows: TableRow[] = sorted.map((sc, i) => {
    const eff = sc.totalCost > 0 ? sc.combinedPct / sc.totalCost : Infinity;
    return {
      rank: i + 1,
      model: sc.model,
      combined: `${sc.combinedPct.toFixed(1)}%`,
      cost: sc.totalCost > 0 ? `$${sc.totalCost.toFixed(4)}` : 'Free',
      efficiency: sc.totalCost > 0 ? eff.toFixed(1) : 'Free',
    };
  });

  return {
    title: 'Cost Efficiency',
    description: 'Models ranked by score per dollar spent',
    content: { type: 'table', data: { columns, rows } },
  };
}

function buildSpeedLeaderboard(scorecards: ModelScorecard[]): ReportSection {
  const sorted = [...scorecards].sort((a, b) => a.totalDurationMs - b.totalDurationMs);

  const columns: TableColumn[] = [
    { key: 'rank', label: 'Rank', align: 'right', width: 4 },
    { key: 'model', label: 'Model', align: 'left', width: 48 },
    { key: 'combined', label: 'Combined %', align: 'right', width: 10 },
    { key: 'time', label: 'Total Time', align: 'right', width: 10 },
    { key: 'efficiency', label: 'Score/sec', align: 'right', width: 10 },
  ];

  const rows: TableRow[] = sorted.map((sc, i) => {
    const secs = sc.totalDurationMs / 1000;
    const eff = secs > 0 ? sc.combinedPct / secs : 0;
    return {
      rank: i + 1,
      model: sc.model,
      combined: `${sc.combinedPct.toFixed(1)}%`,
      time: `${secs.toFixed(1)}s`,
      efficiency: eff.toFixed(2),
    };
  });

  return {
    title: 'Speed Leaderboard',
    description: 'Models ranked by total response time (fastest first)',
    content: { type: 'table', data: { columns, rows } },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Focus & Run Info
// ─────────────────────────────────────────────────────────────────────────────

function buildFocusComparison(
  scorecards: ModelScorecard[],
  focusModels: string[],
  dimNames: string[],
  dimLabels: Map<string, string>
): ReportSection | null {
  const matches = scorecards.filter(sc =>
    focusModels.some(f =>
      sc.model.toLowerCase().includes(f.toLowerCase()) ||
      sc.modelKey.toLowerCase().includes(f.toLowerCase())
    )
  );

  if (matches.length === 0) return null;

  const columns: TableColumn[] = [
    { key: 'model', label: 'Model', align: 'left', width: 48 },
    { key: 'provider', label: 'Provider', align: 'left', width: 12 },
  ];

  for (const dn of dimNames) {
    const label = dimLabels.get(dn) || dn;
    columns.push({ key: `${dn}_score`, label: `${label} Score`, align: 'right', width: 10 });
    columns.push({ key: `${dn}_pct`, label: `${label} %`, align: 'right', width: 8 });
  }

  columns.push(
    { key: 'combined', label: 'Combined %', align: 'right', width: 10 },
    { key: 'cost', label: 'Cost $', align: 'right', width: 8 },
  );

  const rows: TableRow[] = matches.map(sc => {
    const row: TableRow = {
      model: sc.model,
      provider: sc.provider,
    };
    for (const dn of dimNames) {
      const ds = sc.dimensions.get(dn);
      row[`${dn}_score`] = ds ? `${ds.rawScore}/${ds.maxScore}` : 'N/A';
      row[`${dn}_pct`] = ds ? `${ds.pct.toFixed(1)}%` : 'N/A';
    }
    row.combined = `${sc.combinedPct.toFixed(1)}%`;
    row.cost = sc.totalCost > 0 ? `$${sc.totalCost.toFixed(4)}` : 'Free';
    return row;
  });

  return {
    title: `Focus: ${focusModels.join(', ')}`,
    description: `Detailed comparison of models matching: ${focusModels.join(', ')}`,
    content: { type: 'table', data: { columns, rows } },
  };
}

function buildRunInfo(suiteResult: SuiteResult): ReportSection {
  return {
    title: 'Run Information',
    content: {
      type: 'metrics',
      data: [
        ...suiteResult.runInfo.map(ri => ({
          label: ri.label,
          value: `run ${ri.runNumber} (${ri.modelCount} models, ${ri.taskCount} tasks)`,
        })),
        {
          label: 'Total Models (in all dims)',
          value: suiteResult.scorecards.length,
        },
        {
          label: 'Total Cost',
          value: `$${suiteResult.scorecards.reduce((s, sc) => s + sc.totalCost, 0).toFixed(4)}`,
        },
        {
          label: 'Generated',
          value: suiteResult.timestamp.toISOString(),
        },
      ],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseModelKey(modelKey: string): { model: string; provider: string } {
  const providers = ['openrouter', 'google', 'deepinfra', 'togetherai', 'ollama', 'lmstudio', 'github-models'];
  for (const p of providers) {
    if (modelKey.endsWith(`-${p}`)) {
      return { model: modelKey.slice(0, -(p.length + 1)), provider: p };
    }
  }
  return { model: modelKey, provider: 'unknown' };
}
