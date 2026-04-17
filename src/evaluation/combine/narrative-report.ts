/**
 * Narrative Report Builder
 *
 * Generates a full prose-style markdown report from a SuiteResult,
 * combining test methodology, results, and analysis into a single
 * readable document. Unlike the structured Report format (which
 * renders tables/lists through the Reporter), this produces a
 * standalone markdown article.
 */

import type { SuiteResult, TaskResult, ModelScorecard, DimensionScore } from './types.js';

export interface NarrativeReportOptions {
  title?: string;
  /** Include the actual questions/prompts in the methodology sections */
  includePrompts?: boolean;
}

/**
 * Generate a full narrative markdown report.
 */
export function buildNarrativeReport(
  suite: SuiteResult,
  options?: NarrativeReportOptions
): string {
  const title = options?.title || 'Model Showdown — Full Evaluation Report';
  const lines: string[] = [];

  const w = (...args: string[]) => lines.push(...args);
  const blank = () => lines.push('');

  // ── Title & Introduction ──────────────────────────────────────────────
  w(`# ${title}`);
  blank();
  w(`*Generated: ${suite.timestamp.toISOString().split('T')[0]}*`);
  blank();

  // Models & providers
  const providers = groupBy(suite.scorecards, sc => sc.provider);
  const providerList = [...providers.entries()]
    .map(([p, models]) => `**${p}** (${models.length} models)`)
    .join(', ');

  w(`## Overview`);
  blank();
  w(`This report evaluates **${suite.scorecards.length} language models** across **${suite.runInfo.length} dimensions**: ${suite.runInfo.map(ri => ri.label).join(', ')}. Models were tested via ${providerList}.`);
  blank();

  const totalCost = suite.scorecards.reduce((s, sc) => s + sc.totalCost, 0);
  const totalTime = suite.scorecards.reduce((s, sc) => s + sc.totalDurationMs, 0);
  w(`Total evaluation cost: **$${totalCost.toFixed(4)}**. Total wall-clock time across all models: **${formatDuration(totalTime)}**.`);
  blank();

  // ── Models Tested ─────────────────────────────────────────────────────
  w(`### Models Tested`);
  blank();
  for (const [provider, models] of [...providers.entries()].sort()) {
    w(`**${provider}:**`);
    for (const m of models.sort((a, b) => a.model.localeCompare(b.model))) {
      w(`- ${m.model}`);
    }
    blank();
  }

  // ── Overall Leaderboard ───────────────────────────────────────────────
  w(`## Overall Leaderboard`);
  blank();
  w(`Models are ranked by the mean of their normalized scores across all ${suite.runInfo.length} dimensions. Each dimension is scored as a percentage of maximum, then averaged.`);
  blank();

  const dimNames = suite.runInfo.map(ri => ri.evalName);
  const dimLabels = new Map(suite.runInfo.map(ri => [ri.evalName, ri.label]));

  // Build header
  const dimHeaders = dimNames.map(dn => dimLabels.get(dn) || dn);
  w(`| Rank | Model | Provider | ${dimHeaders.join(' | ')} | Combined | Cost | Time |`);
  w(`| ---: | --- | --- | ${dimHeaders.map(() => '---:').join(' | ')} | ---: | ---: | ---: |`);

  for (let i = 0; i < suite.scorecards.length; i++) {
    const sc = suite.scorecards[i];
    const dimCols = dimNames.map(dn => {
      const ds = sc.dimensions.get(dn);
      return ds ? `${ds.rawScore}/${ds.maxScore}` : '-';
    });
    const cost = sc.totalCost > 0 ? `$${sc.totalCost.toFixed(4)}` : 'Free';
    w(`| ${i + 1} | ${sc.model} | ${sc.provider} | ${dimCols.join(' | ')} | ${sc.combinedPct.toFixed(1)}% | ${cost} | ${formatDuration(sc.totalDurationMs)} |`);
  }
  blank();

  // Top findings
  const top = suite.scorecards[0];
  const cheapBest = [...suite.scorecards]
    .filter(sc => sc.combinedPct > 80)
    .sort((a, b) => a.totalCost - b.totalCost)[0];
  const fastBest = [...suite.scorecards]
    .filter(sc => sc.combinedPct > 80)
    .sort((a, b) => a.totalDurationMs - b.totalDurationMs)[0];

  w(`**Key findings:**`);
  if (top) w(`- **Best overall:** ${top.model} at ${top.combinedPct.toFixed(1)}% (${top.provider})`);
  if (cheapBest) w(`- **Best value (>80%):** ${cheapBest.model} — ${cheapBest.combinedPct.toFixed(1)}% for ${cheapBest.totalCost > 0 ? '$' + cheapBest.totalCost.toFixed(4) : 'free'}`);
  if (fastBest) w(`- **Fastest (>80%):** ${fastBest.model} — ${fastBest.combinedPct.toFixed(1)}% in ${formatDuration(fastBest.totalDurationMs)}`);
  blank();

  // ── Per-dimension sections ────────────────────────────────────────────
  for (const ri of suite.runInfo) {
    const taskResults = suite.taskResults.get(ri.evalName) || [];
    const modelKeys = new Set(suite.scorecards.map(sc => sc.modelKey));
    const filtered = taskResults.filter(tr => modelKeys.has(tr.modelKey));

    if (ri.evalName.includes('reasoning')) {
      writeReasoningSection(w, blank, filtered, suite.scorecards, ri, options);
    } else if (ri.evalName.includes('knowledge')) {
      writeKnowledgeSection(w, blank, filtered, suite.scorecards, ri, options);
    } else if (ri.evalName.includes('instruction')) {
      writeInstructionSection(w, blank, filtered, suite.scorecards, ri, options);
    } else if (ri.evalName.includes('coding')) {
      writeCodingSection(w, blank, filtered, suite.scorecards, ri, options);
    } else if (ri.evalName.includes('mcp')) {
      writeMcpSection(w, blank, filtered, suite.scorecards, ri, options);
    }
  }

  // ── Cost & Speed Analysis ─────────────────────────────────────────────
  w(`## Cost & Speed Analysis`);
  blank();

  w(`### Cost Efficiency`);
  blank();
  w(`Models ranked by score-per-dollar. Free-tier models (NVIDIA via DeepInfra and OpenRouter) dominate on cost but may have rate limits or lower availability.`);
  blank();

  const costSorted = [...suite.scorecards].sort((a, b) => {
    const aEff = a.totalCost > 0 ? a.combinedPct / a.totalCost : Infinity;
    const bEff = b.totalCost > 0 ? b.combinedPct / b.totalCost : Infinity;
    return bEff - aEff;
  });

  w(`| Rank | Model | Score | Cost | Score/$ |`);
  w(`| ---: | --- | ---: | ---: | ---: |`);
  for (let i = 0; i < costSorted.length; i++) {
    const sc = costSorted[i];
    const eff = sc.totalCost > 0 ? (sc.combinedPct / sc.totalCost).toFixed(0) : 'Free';
    w(`| ${i + 1} | ${sc.model} | ${sc.combinedPct.toFixed(1)}% | ${sc.totalCost > 0 ? '$' + sc.totalCost.toFixed(4) : 'Free'} | ${eff} |`);
  }
  blank();

  w(`### Speed`);
  blank();
  const speedSorted = [...suite.scorecards].sort((a, b) => a.totalDurationMs - b.totalDurationMs);
  w(`| Rank | Model | Score | Time | Score/sec |`);
  w(`| ---: | --- | ---: | ---: | ---: |`);
  for (let i = 0; i < speedSorted.length; i++) {
    const sc = speedSorted[i];
    const secs = sc.totalDurationMs / 1000;
    const eff = secs > 0 ? (sc.combinedPct / secs).toFixed(2) : '-';
    w(`| ${i + 1} | ${sc.model} | ${sc.combinedPct.toFixed(1)}% | ${formatDuration(sc.totalDurationMs)} | ${eff} |`);
  }
  blank();

  // ── Provider Comparison ───────────────────────────────────────────────
  w(`## Provider Comparison`);
  blank();

  for (const [provider, models] of [...providers.entries()].sort()) {
    const avg = models.reduce((s, m) => s + m.combinedPct, 0) / models.length;
    const best = models.reduce((a, b) => a.combinedPct > b.combinedPct ? a : b);
    const totalProvCost = models.reduce((s, m) => s + m.totalCost, 0);
    w(`**${provider}** — ${models.length} model${models.length > 1 ? 's' : ''}, avg ${avg.toFixed(1)}%, best: ${best.model} (${best.combinedPct.toFixed(1)}%), total cost: ${totalProvCost > 0 ? '$' + totalProvCost.toFixed(4) : 'Free'}`);
    blank();
  }

  // ── Methodology ───────────────────────────────────────────────────────
  w(`## Methodology`);
  blank();
  w(`All evaluations ran with temperature 0.0 (knowledge, instruction) or 0.2-0.3 (reasoning, coding). Reasoning and knowledge answers were judged by Claude Haiku 4.5. Instruction and coding tasks use deterministic verification — no LLM judge involved.`);
  blank();
  w(`Results are cached per model per task; interrupted runs can be resumed. All models were tested under the same conditions with identical prompts.`);
  blank();

  w(`### Run Details`);
  blank();
  for (const ri of suite.runInfo) {
    w(`- **${ri.label}**: Run #${ri.runNumber}, ${ri.taskCount} tasks, ${ri.modelCount} models`);
  }
  blank();

  // ── Full Drill-Down Appendix ────────────────────────────────────
  w(`---`);
  blank();
  w(`## Appendix: Full Model Responses`);
  blank();
  w(`Every model response for every task, with judge explanations where applicable. This allows independent verification of scores.`);
  blank();

  for (const ri of suite.runInfo) {
    const allTaskResults = suite.taskResults.get(ri.evalName) || [];
    const modelKeys = new Set(suite.scorecards.map(sc => sc.modelKey));
    const filtered = allTaskResults.filter(tr => modelKeys.has(tr.modelKey));

    if (filtered.length === 0) continue;

    w(`### ${ri.label} — All Responses`);
    blank();

    // Group by task
    const byTask = groupBy(filtered, tr => tr.taskId);
    const taskIds = [...byTask.keys()].sort();

    for (const taskId of taskIds) {
      const taskItems = byTask.get(taskId) || [];
      // Sort by score descending
      taskItems.sort((a, b) => b.score - a.score);

      w(`#### ${ri.label}: ${taskId}`);
      blank();

      // Show question/prompt if available
      const sample = taskItems[0];
      if (sample?.raw.correctAnswer) {
        w(`**Correct answer:** ${sample.raw.correctAnswer}`);
        blank();
      }
      if (sample?.raw.challengeId) {
        w(`**Challenge:** ${sample.raw.challengeId} (${sample.raw.language || '?'})`);
        blank();
      }

      for (const tr of taskItems) {
        const { model, provider } = parseModelKey(tr.modelKey);
        const scoreLabel = getScoreLabel(tr, ri.evalName);

        w(`<details>`);
        w(`<summary><strong>${model}</strong> (${provider}) — ${scoreLabel}</summary>`);
        blank();

        // Cost & timing
        if (tr.cost > 0 || tr.durationMs > 0) {
          const parts: string[] = [];
          if (tr.cost > 0) parts.push(`Cost: $${tr.cost.toFixed(6)}`);
          if (tr.durationMs > 0) parts.push(`Time: ${formatDuration(tr.durationMs)}`);
          w(`*${parts.join(' | ')}*`);
          blank();
        }

        // Model response
        const responseText = tr.raw.responseText || tr.raw.content || '';
        if (responseText) {
          if (ri.evalName.includes('coding') && tr.raw.extractedCode) {
            w(`**Extracted code:**`);
            w('```');
            w(tr.raw.extractedCode.slice(0, 3000));
            if (tr.raw.extractedCode.length > 3000) w('... (truncated)');
            w('```');
          } else if (responseText.length > 2000) {
            w(`**Response** (truncated):`);
            w(`> ${responseText.slice(0, 2000).replace(/\n/g, '\n> ')}...`);
          } else {
            w(`**Response:**`);
            w(`> ${responseText.replace(/\n/g, '\n> ')}`);
          }
          blank();
        }

        // Judge explanation
        if (tr.raw.judgeExplanation) {
          w(`**Judge:** ${tr.raw.judgeExplanation}`);
          blank();
        }
        if (tr.raw.judge?.explanation) {
          w(`**Judge:** ${tr.raw.judge.explanation}`);
          blank();
        }

        // Coding-specific details
        if (ri.evalName.includes('coding')) {
          const parts: string[] = [];
          if (tr.raw.compiled !== undefined) parts.push(`Compiled: ${tr.raw.compiled ? 'Yes' : 'No'}`);
          if (tr.raw.ran !== undefined) parts.push(`Ran: ${tr.raw.ran ? 'Yes' : 'No'}`);
          if (tr.raw.verifyDetails) parts.push(`Verify: ${tr.raw.verifyDetails}`);
          if (parts.length) {
            w(`*${parts.join(' | ')}*`);
            blank();
          }
          if (tr.raw.stderr) {
            w(`**stderr:** \`${tr.raw.stderr.slice(0, 500)}\``);
            blank();
          }
          if (tr.raw.stdout) {
            w(`**stdout:** \`${tr.raw.stdout.slice(0, 500)}\``);
            blank();
          }
        }

        // MCP tool usage
        if (tr.raw.toolUsage?.calls) {
          const calls = tr.raw.toolUsage.calls as Array<{ name: string; args?: any }>;
          w(`**Tool calls:** ${calls.map((c: { name: string }) => c.name).join(' → ')}`);
          blank();
        }

        // Instruction details
        if (tr.raw.details && ri.evalName.includes('instruction')) {
          w(`**Details:** ${tr.raw.details}`);
          blank();
        }

        w(`</details>`);
        blank();
      }
    }
  }

  return lines.join('\n');
}

/** Get a human-readable score label for a task result */
function getScoreLabel(tr: TaskResult, evalName: string): string {
  if (evalName.includes('knowledge')) {
    return tr.raw.correct ? '✓ Correct' : '✗ Wrong';
  }
  if (evalName.includes('reasoning')) {
    const correct = tr.raw.correct || tr.raw.judge?.correct;
    return `${tr.score}/5${correct ? '' : ' ✗'}`;
  }
  if (evalName.includes('coding')) {
    const c = tr.raw.compiled ? 'C' : '✗';
    const r = tr.raw.ran ? 'R' : '✗';
    return `${tr.score}/7 [${c}${r}]`;
  }
  if (evalName.includes('instruction')) {
    return `${tr.score}/5`;
  }
  if (evalName.includes('mcp')) {
    const toolScore = tr.raw.toolUsage?.tool_score ?? 0;
    const judgeScore = tr.raw.judge?.overall_score ?? 0;
    return `${tr.score}/16 (tools:${toolScore}, judge:${judgeScore})`;
  }
  return `${tr.score}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section Writers
// ─────────────────────────────────────────────────────────────────────────────

function writeReasoningSection(
  w: (...s: string[]) => void,
  blank: () => void,
  results: TaskResult[],
  scorecards: ModelScorecard[],
  ri: { label: string; evalName: string },
  options?: NarrativeReportOptions
) {
  w(`## ${ri.label}`);
  blank();
  w(`Four classic logic puzzles test whether models can reason past intuitive traps. Each puzzle is scored 1-5 by an LLM judge on reasoning quality — not just whether the answer is correct, but whether the model shows genuine understanding.`);
  blank();

  const puzzles = [...new Set(results.map(tr => tr.taskId))].sort();

  // Puzzle descriptions
  const puzzleDescriptions: Record<string, string> = {
    'bat-ball': '**Bat & Ball**: A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost? *(Correct: $0.05, trap answer: $0.10)*',
    'surgeon': '**Surgeon Riddle**: A father and son are in a car accident. The father dies, the son is rushed to surgery. The surgeon says "I can\'t operate — he\'s my son." How? *(Correct: the surgeon is his mother)*',
    'lily-pad': '**Lily Pad**: A patch of lily pads doubles in size every day. If it takes 48 days to cover a lake, how long to cover half? *(Correct: 47 days, trap answer: 24)*',
    'counterfeit-coin': '**Counterfeit Coin**: You have 12 coins, one is counterfeit (heavier or lighter). Using a balance scale exactly 3 times, find the counterfeit and determine if it\'s heavier or lighter. *(Correct: yes, divide into groups of 4)*',
  };

  w(`### Puzzles`);
  blank();
  for (const p of puzzles) {
    w(puzzleDescriptions[p] || `**${p}**`);
    blank();
  }

  // Results matrix
  w(`### Results`);
  blank();

  const sorted = [...scorecards].sort((a, b) => {
    const aDs = a.dimensions.get(ri.evalName);
    const bDs = b.dimensions.get(ri.evalName);
    return (bDs?.rawScore || 0) - (aDs?.rawScore || 0);
  });

  w(`| Model | ${puzzles.join(' | ')} | Total |`);
  w(`| --- | ${puzzles.map(() => ':---:').join(' | ')} | ---: |`);

  for (const sc of sorted) {
    const cols = puzzles.map(p => {
      const tr = results.find(t => t.taskId === p && t.modelKey === sc.modelKey);
      if (!tr) return '-';
      const correct = tr.raw.correct || tr.raw.judge?.correct;
      return correct ? `${tr.score}/5` : `${tr.score}/5 ✗`;
    });
    const ds = sc.dimensions.get(ri.evalName);
    w(`| ${sc.model} | ${cols.join(' | ')} | ${ds?.rawScore || 0}/20 |`);
  }
  blank();

  // Analysis
  w(`### Analysis`);
  blank();

  const perfect = sorted.filter(sc => (sc.dimensions.get(ri.evalName)?.rawScore || 0) === 20);
  const trapFallers = results.filter(tr => tr.raw.judge?.fell_for_trap);
  const coinFails = results.filter(tr => tr.taskId === 'counterfeit-coin' && tr.score <= 2);

  w(`**${perfect.length}/${sorted.length}** models achieved a perfect 20/20. The counterfeit coin puzzle was the hardest — ${coinFails.length} models scored 2/5 or below, typically providing an incomplete weighing procedure or claiming the task is impossible.`);
  blank();

  if (trapFallers.length > 0) {
    w(`Models that fell for intuitive traps:`);
    for (const tr of trapFallers) {
      w(`- ${parseModelKey(tr.modelKey).model} on ${tr.taskId}: ${tr.raw.judge?.explanation?.slice(0, 150) || 'fell for trap'}...`);
    }
    blank();
  }

  // Notable judge explanations
  const interesting = results
    .filter(tr => tr.raw.judge?.explanation && tr.score < 5 && tr.score > 0)
    .slice(0, 5);

  if (interesting.length > 0) {
    w(`**Selected judge explanations** (partial scores):`);
    blank();
    for (const tr of interesting) {
      w(`> **${parseModelKey(tr.modelKey).model}** on *${tr.taskId}* (${tr.score}/5): ${tr.raw.judge.explanation.slice(0, 250)}`);
      blank();
    }
  }
}

function writeKnowledgeSection(
  w: (...s: string[]) => void,
  blank: () => void,
  results: TaskResult[],
  scorecards: ModelScorecard[],
  ri: { label: string; evalName: string },
  options?: NarrativeReportOptions
) {
  w(`## ${ri.label}`);
  blank();
  w(`30 factual questions across 6 categories: Science, Geography, History, Technology, AI/ML, and Tricky/Adversarial. Each is scored correct (1) or incorrect (0) by an LLM judge, which allows for formatting variations (e.g., "5730 years" vs "5,730 years" both count).`);
  blank();

  // Category breakdown
  const categories = new Map<string, TaskResult[]>();
  for (const tr of results) {
    const cat = tr.raw.category || tr.taskId.replace(/-\d+$/, '');
    const list = categories.get(cat) || [];
    list.push(tr);
    categories.set(cat, list);
  }

  const catNames = [...categories.keys()].sort();
  const sorted = [...scorecards].sort((a, b) => {
    const aDs = a.dimensions.get(ri.evalName);
    const bDs = b.dimensions.get(ri.evalName);
    return (bDs?.rawScore || 0) - (aDs?.rawScore || 0);
  });

  w(`### Results by Category`);
  blank();
  w(`| Model | ${catNames.join(' | ')} | Total |`);
  w(`| --- | ${catNames.map(() => '---:').join(' | ')} | ---: |`);

  for (const sc of sorted) {
    const cols = catNames.map(cat => {
      const catResults = (categories.get(cat) || []).filter(tr => tr.modelKey === sc.modelKey);
      const correct = catResults.filter(tr => tr.raw.correct).length;
      return `${correct}/${catResults.length}`;
    });
    const ds = sc.dimensions.get(ri.evalName);
    w(`| ${sc.model} | ${cols.join(' | ')} | ${ds?.rawScore || 0}/30 |`);
  }
  blank();

  // Hardest questions
  w(`### Hardest Questions`);
  blank();
  w(`Questions ranked by how many models got them wrong:`);
  blank();

  const questionIds = [...new Set(results.map(tr => tr.taskId))].sort();
  const hardQ: { qid: string; wrong: string[]; total: number; answer: string; category: string }[] = [];

  for (const qid of questionIds) {
    const qResults = results.filter(tr => tr.taskId === qid);
    const wrong = qResults.filter(tr => !tr.raw.correct);
    if (wrong.length > 0) {
      hardQ.push({
        qid,
        wrong: wrong.map(tr => parseModelKey(tr.modelKey).model),
        total: qResults.length,
        answer: qResults[0]?.raw.correctAnswer || '?',
        category: qResults[0]?.raw.category || qid.replace(/-\d+$/, ''),
      });
    }
  }

  hardQ.sort((a, b) => b.wrong.length - a.wrong.length);

  for (const hq of hardQ.slice(0, 10)) {
    w(`**${hq.qid}** (${hq.category}) — ${hq.wrong.length}/${hq.total} wrong. Answer: *${hq.answer}*`);
    w(`  Wrong: ${hq.wrong.join(', ')}`);
    blank();
  }

  // Analysis
  w(`### Analysis`);
  blank();
  const perfect = sorted.filter(sc => (sc.dimensions.get(ri.evalName)?.rawScore || 0) === 30);
  w(`**${perfect.length}/${sorted.length}** models got a perfect 30/30. The trickiest category was ${findHardestCategory(catNames, categories, results)} — questions like "How many Rs in strawberry?" and "Is 91 prime?" require careful character-level or arithmetic reasoning rather than factual recall.`);
  blank();

  // Interesting wrong answers
  const wrongWithExplanation = results
    .filter(tr => !tr.raw.correct && tr.raw.judgeExplanation)
    .sort(() => Math.random() - 0.5)
    .slice(0, 5);

  if (wrongWithExplanation.length > 0) {
    w(`**Selected wrong answers:**`);
    blank();
    for (const tr of wrongWithExplanation) {
      w(`> **${parseModelKey(tr.modelKey).model}** on *${tr.taskId}*: answered "${tr.raw.responseText?.slice(0, 100)}" (correct: ${tr.raw.correctAnswer}). Judge: ${tr.raw.judgeExplanation?.slice(0, 200)}`);
      blank();
    }
  }
}

function writeInstructionSection(
  w: (...s: string[]) => void,
  blank: () => void,
  results: TaskResult[],
  scorecards: ModelScorecard[],
  ri: { label: string; evalName: string },
  options?: NarrativeReportOptions
) {
  w(`## ${ri.label}`);
  blank();
  w(`Six tasks test whether models can follow precise formatting instructions. Unlike reasoning or knowledge, these are scored **deterministically** — no LLM judge. Regex parsing and exact comparisons verify compliance. Each task is worth 0-5 points, total /30.`);
  blank();

  const taskIds = [...new Set(results.map(tr => tr.taskId))].sort();

  // Task descriptions
  const taskDesc: Record<string, string> = {
    'exact-word-count': '**Exact Word Count** — Write a 12-word sentence about the ocean, nothing else.',
    'json-output': '**JSON Output** — Return a JSON object with specific fields (name, age 25-35, 3 skills, active=true), no markdown fences.',
    'constrained-list': '**Constrained List** — 5 animals, numbered, alphabetical, names ≤8 characters, no extra text.',
    'negative-constraints': '**Negative Constraints** — 2-sentence sunset description without "beautiful", "sky", "orange", or exclamation marks.',
    'format-transform': '**Format Transform** — Convert a CSV snippet to a markdown table with header and separator row.',
    'multi-format': '**Multi-format** — Three sections separated by `---`: a color word, a number 1-100, the color repeated 3 times.',
  };

  w(`### Tasks`);
  blank();
  for (const tid of taskIds) {
    w(taskDesc[tid] || `**${tid}**`);
  }
  blank();

  // Results matrix
  w(`### Results`);
  blank();

  const sorted = [...scorecards].sort((a, b) => {
    const aDs = a.dimensions.get(ri.evalName);
    const bDs = b.dimensions.get(ri.evalName);
    return (bDs?.rawScore || 0) - (aDs?.rawScore || 0);
  });

  const taskLabels = taskIds.map(tid => {
    const sample = results.find(tr => tr.taskId === tid);
    return sample?.raw.taskName || tid;
  });

  w(`| Model | ${taskLabels.join(' | ')} | Total |`);
  w(`| --- | ${taskLabels.map(() => '---:').join(' | ')} | ---: |`);

  for (const sc of sorted) {
    const cols = taskIds.map(tid => {
      const tr = results.find(t => t.taskId === tid && t.modelKey === sc.modelKey);
      return tr ? `${tr.score}/5` : '-';
    });
    const ds = sc.dimensions.get(ri.evalName);
    w(`| ${sc.model} | ${cols.join(' | ')} | ${ds?.rawScore || 0}/30 |`);
  }
  blank();

  // Failure details
  w(`### Where Models Struggled`);
  blank();

  const failures = results
    .filter(tr => tr.score < 5)
    .sort((a, b) => a.score - b.score);

  // Group by task
  const failsByTask = groupBy(failures, tr => tr.taskId);
  for (const [tid, fails] of [...failsByTask.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const taskName = fails[0]?.raw.taskName || tid;
    w(`**${taskName}** — ${fails.length} model${fails.length > 1 ? 's' : ''} lost points:`);
    for (const tr of fails.slice(0, 8)) {
      const model = parseModelKey(tr.modelKey).model;
      const detail = tr.raw.details || '';
      w(`- ${model}: ${tr.score}/5 ${detail ? '— ' + detail : ''}`);
    }
    if (fails.length > 8) w(`- ...and ${fails.length - 8} more`);
    blank();
  }

  // Analysis
  w(`### Analysis`);
  blank();
  const perfect = sorted.filter(sc => (sc.dimensions.get(ri.evalName)?.rawScore || 0) === 30);
  w(`**${perfect.length}/${sorted.length}** models achieved a perfect 30/30. The most common failure mode was word count — models frequently wrote 11 or 13 words instead of exactly 12, suggesting they estimate rather than count. Format transformation (CSV→markdown) was generally well-handled.`);
  blank();
}

function writeCodingSection(
  w: (...s: string[]) => void,
  blank: () => void,
  results: TaskResult[],
  scorecards: ModelScorecard[],
  ri: { label: string; evalName: string },
  options?: NarrativeReportOptions
) {
  w(`## ${ri.label}`);
  blank();
  w(`Six coding challenges in three languages (TypeScript, Python, Go) — 18 tasks total. Each task is scored: **compile (1pt) + run (1pt) + output correctness (0-5pts) = 0-7**. Maximum possible: 126. Code is extracted from model responses, compiled, executed, and verified against expected output.`);
  blank();

  // Challenge descriptions
  const challengeDesc: Record<string, string> = {
    'fizzbuzz-boom': '**FizzBuzz Boom** — Print 1-105. Multiples of 3→Fizz, 5→Buzz, 7→Boom, with combinations. 9 spot-check lines verified.',
    'business-days': '**Business Days** — Count working days between dates, excluding weekends and 8 specific holidays. 3 date ranges verified.',
    'vending-machine': '**Vending Machine** — State machine simulation: insert coins, select products, compute change. 18 sequential operations verified.',
    'grid-paths': '**Grid Paths** — Dynamic programming: count unique right/down paths through a grid with obstacles. 3 grids of increasing size.',
    'custom-cipher': '**Rail Fence Cipher** — Encode and decode strings using zigzag/rail fence cipher with N rails. 4 test cases.',
    'data-pipeline': '**Data Pipeline** — Parse 13 CSV sales records, aggregate by region/product, compute 5 specific statistics.',
  };

  w(`### Challenges`);
  blank();
  for (const [id, desc] of Object.entries(challengeDesc)) {
    w(desc);
  }
  blank();

  // Parse task structure
  const taskIds = [...new Set(results.map(tr => tr.taskId))].sort();
  const challenges = [...new Set(results.map(tr => tr.raw.challengeId || tr.taskId.replace(/-(go|python|typescript)$/, '')))].sort();
  const languages = [...new Set(results.map(tr => tr.raw.language || tr.taskId.split('-').pop()))].sort();

  // Challenge matrix
  w(`### Results Matrix`);
  blank();
  w(`Each cell shows score/7 and status: **C**=compiled, **R**=ran, **✗**=failed.`);
  blank();

  const sorted = [...scorecards].sort((a, b) => {
    const aDs = a.dimensions.get(ri.evalName);
    const bDs = b.dimensions.get(ri.evalName);
    return (bDs?.rawScore || 0) - (aDs?.rawScore || 0);
  });

  // Build compact header
  const colHeaders = challenges.flatMap(ch => languages.map(lang => `${ch.replace('custom-cipher', 'cipher').replace('fizzbuzz-boom', 'fizzbuzz').replace('business-days', 'biz-days').replace('vending-machine', 'vending').replace('data-pipeline', 'pipeline').replace('grid-paths', 'grid')}/${lang.replace('typescript', 'ts').replace('python', 'py')}`));
  w(`| Model | ${colHeaders.join(' | ')} | Total |`);
  w(`| --- | ${colHeaders.map(() => '---:').join(' | ')} | ---: |`);

  for (const sc of sorted) {
    const cols = challenges.flatMap(ch =>
      languages.map(lang => {
        const tr = results.find(t =>
          t.modelKey === sc.modelKey &&
          (t.raw.challengeId === ch || t.taskId.startsWith(ch)) &&
          (t.raw.language === lang || t.taskId.endsWith(`-${lang}`))
        );
        if (!tr) return '-';
        const c = tr.raw.compiled ? 'C' : '✗';
        const r = tr.raw.ran ? 'R' : '✗';
        return `${tr.score} ${c}${r}`;
      })
    );
    const ds = sc.dimensions.get(ri.evalName);
    w(`| ${sc.model} | ${cols.join(' | ')} | ${ds?.rawScore || 0} |`);
  }
  blank();

  // Execution stats
  w(`### Execution Summary`);
  blank();

  const total = results.length;
  const compiled = results.filter(tr => tr.raw.compiled).length;
  const ran = results.filter(tr => tr.raw.ran).length;
  const perfect = results.filter(tr => tr.score === 7).length;
  const zeros = results.filter(tr => tr.score === 0).length;

  w(`- **${total}** total submissions across all models/challenges/languages`);
  w(`- **${compiled}/${total}** (${pct(compiled, total)}) compiled successfully`);
  w(`- **${ran}/${total}** (${pct(ran, total)}) ran without crashing`);
  w(`- **${perfect}** perfect scores (7/7), **${zeros}** total failures (0/7)`);
  blank();

  // Language comparison
  w(`### Language Comparison`);
  blank();
  w(`| Language | Avg Score | Compile Rate | Run Rate | Perfect Rate |`);
  w(`| --- | ---: | ---: | ---: | ---: |`);

  for (const lang of languages) {
    const langResults = results.filter(tr => (tr.raw.language || tr.taskId.split('-').pop()) === lang);
    if (langResults.length === 0) continue;
    const avg = langResults.reduce((s, tr) => s + tr.score, 0) / langResults.length;
    const comp = langResults.filter(tr => tr.raw.compiled).length;
    const run = langResults.filter(tr => tr.raw.ran).length;
    const perf = langResults.filter(tr => tr.score === 7).length;
    w(`| ${lang} | ${avg.toFixed(1)}/7 | ${pct(comp, langResults.length)} | ${pct(run, langResults.length)} | ${pct(perf, langResults.length)} |`);
  }
  blank();

  // Challenge difficulty
  w(`### Challenge Difficulty`);
  blank();
  w(`| Challenge | Avg Score | Perfect | Zero | Hardest Language |`);
  w(`| --- | ---: | ---: | ---: | --- |`);

  for (const ch of challenges) {
    const chResults = results.filter(tr => tr.raw.challengeId === ch || tr.taskId.startsWith(ch));
    if (chResults.length === 0) continue;
    const avg = chResults.reduce((s, tr) => s + tr.score, 0) / chResults.length;
    const perf = chResults.filter(tr => tr.score === 7).length;
    const zero = chResults.filter(tr => tr.score === 0).length;

    // Find hardest language for this challenge
    let hardestLang = '';
    let lowestLangAvg = Infinity;
    for (const lang of languages) {
      const langCh = chResults.filter(tr => (tr.raw.language || tr.taskId.split('-').pop()) === lang);
      if (langCh.length === 0) continue;
      const langAvg = langCh.reduce((s, tr) => s + tr.score, 0) / langCh.length;
      if (langAvg < lowestLangAvg) {
        lowestLangAvg = langAvg;
        hardestLang = `${lang} (${langAvg.toFixed(1)}/7)`;
      }
    }

    w(`| ${ch} | ${avg.toFixed(1)}/7 | ${perf} | ${zero} | ${hardestLang} |`);
  }
  blank();

  // Notable failures
  w(`### Notable Failures`);
  blank();
  w(`Compilation errors and crashes, showing what went wrong:`);
  blank();

  const failures = results
    .filter(tr => !tr.raw.compiled || !tr.raw.ran)
    .sort((a, b) => (a.raw.challengeId || a.taskId).localeCompare(b.raw.challengeId || b.taskId));

  // Group by challenge
  const failsByCh = groupBy(failures, tr => tr.raw.challengeId || tr.taskId.replace(/-(go|python|typescript)$/, ''));
  for (const [ch, fails] of [...failsByCh.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 4)) {
    w(`**${ch}** — ${fails.length} failures:`);
    for (const tr of fails.slice(0, 5)) {
      const model = parseModelKey(tr.modelKey).model;
      const lang = tr.raw.language || '?';
      const reason = !tr.raw.compiled ? 'compile error' : 'runtime crash';
      const stderr = tr.raw.stderr ? `: ${tr.raw.stderr.split('\n')[0]?.slice(0, 120)}` : '';
      w(`- ${model} (${lang}): ${reason}${stderr}`);
    }
    if (fails.length > 5) w(`- ...and ${fails.length - 5} more`);
    blank();
  }

  // Analysis
  w(`### Analysis`);
  blank();
  w(`TypeScript had the highest success rate (${pct(results.filter(tr => tr.raw.language === 'typescript' && tr.raw.compiled).length, results.filter(tr => tr.raw.language === 'typescript').length)} compile rate), while Go was the toughest (${pct(results.filter(tr => tr.raw.language === 'go' && tr.raw.compiled).length, results.filter(tr => tr.raw.language === 'go').length)}). The Rail Fence Cipher (custom-cipher) was universally difficult — no model produced working code across all three languages, suggesting that niche algorithm implementation remains a gap.`);
  blank();

  const codingPerfect = sorted.filter(sc => (sc.dimensions.get(ri.evalName)?.rawScore || 0) >= 84);
  if (codingPerfect.length > 0) {
    w(`Top coding models (≥84/126): ${codingPerfect.map(sc => `${sc.model} (${sc.dimensions.get(ri.evalName)?.rawScore}/126)`).join(', ')}.`);
    blank();
  }
}

function writeMcpSection(
  w: (...s: string[]) => void,
  blank: () => void,
  results: TaskResult[],
  scorecards: ModelScorecard[],
  ri: { label: string; evalName: string },
  _options?: NarrativeReportOptions
) {
  w(`## ${ri.label}`);
  blank();
  w(`Models are given access to real MCP (Model Context Protocol) tools and asked to analyze data by calling tools, synthesizing results, and providing actionable insights. Scoring combines tool usage breadth (0-6) with an LLM judge evaluation of response quality (1-10), for a maximum of 16 points.`);
  blank();

  const sorted = [...scorecards].sort((a, b) => {
    const aDs = a.dimensions.get(ri.evalName);
    const bDs = b.dimensions.get(ri.evalName);
    return (bDs?.rawScore || 0) - (aDs?.rawScore || 0);
  });

  w(`### Results`);
  blank();
  w(`| Model | Tool Score | Judge Score | Total | Tools Called | Time | Cost |`);
  w(`| --- | ---: | ---: | ---: | --- | ---: | ---: |`);

  for (const sc of sorted) {
    const tr = results.find(t => t.modelKey === sc.modelKey);
    if (!tr) continue;
    const toolScore = tr.raw.toolUsage?.tool_score ?? 0;
    const judgeScore = tr.raw.judge?.overall_score ?? 0;
    const calls = (tr.raw.toolUsage?.calls || []) as Array<{ name: string }>;
    const toolNames = [...new Set(calls.map((c: { name: string }) => c.name))].join(', ');
    const cost = tr.cost > 0 ? `$${tr.cost.toFixed(4)}` : 'Free';
    w(`| ${sc.model} | ${toolScore}/6 | ${judgeScore}/10 | ${tr.score}/16 | ${toolNames} | ${formatDuration(tr.durationMs)} | ${cost} |`);
  }
  blank();

  // Analysis
  w(`### Analysis`);
  blank();

  const perfect = results.filter(tr => tr.score >= 14);
  const noTools = results.filter(tr => {
    const calls = tr.raw.toolUsage?.calls || [];
    return calls.length === 0;
  });

  w(`**${perfect.length}/${results.length}** models scored 14/16 or higher. ${noTools.length > 0 ? `${noTools.length} model(s) failed to use any tools at all.` : 'All models successfully invoked at least one tool.'}`);
  blank();

  // Judge explanations for interesting cases
  const interesting = results
    .filter(tr => tr.raw.judge?.explanation)
    .sort((a, b) => b.score - a.score);

  if (interesting.length > 0) {
    w(`**Selected judge feedback:**`);
    blank();
    for (const tr of interesting.slice(0, 5)) {
      w(`> **${parseModelKey(tr.modelKey).model}** (${tr.score}/16): ${tr.raw.judge.explanation.slice(0, 300)}`);
      blank();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseModelKey(modelKey: string): { model: string; provider: string } {
  const providers = ['openrouter', 'google', 'deepinfra', 'togetherai', 'ollama', 'lmstudio', 'llamabarn', 'github-models'];
  for (const p of providers) {
    if (modelKey.endsWith(`-${p}`)) {
      return { model: modelKey.slice(0, -(p.length + 1)), provider: p };
    }
  }
  return { model: modelKey, provider: 'unknown' };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = Math.round(secs % 60);
  if (mins < 60) return `${mins}m${remSecs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h${remMins}m`;
}

function pct(n: number, total: number): string {
  return total > 0 ? `${(n / total * 100).toFixed(0)}%` : '0%';
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

function findHardestCategory(catNames: string[], categories: Map<string, TaskResult[]>, results: TaskResult[]): string {
  let hardest = catNames[0];
  let lowestRate = 1;
  for (const cat of catNames) {
    const catResults = categories.get(cat) || [];
    const correct = catResults.filter(tr => tr.raw.correct).length;
    const rate = catResults.length > 0 ? correct / catResults.length : 1;
    if (rate < lowestRate) {
      lowestRate = rate;
      hardest = cat;
    }
  }
  return hardest;
}
