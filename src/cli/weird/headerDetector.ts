import { BaseModelRunner } from '../../cognition/runner.js';
import { Interaction } from '../../interaction/interaction.js';

export type HeaderDetection = {
  header_row_index: number;
  data_start_row_index: number;
  has_header: boolean;
  ambiguous: boolean;
};

function isNumericLike(value: string): boolean {
  if (value == null) return false;
  const v = value.trim();
  if (v.length === 0) return false;
  return /^-?\d+(\.\d+)?$/.test(v) || !isNaN(Date.parse(v));
}

function stringRatio(cells: string[]): number {
  if (!cells || cells.length === 0) return 0;
  const nonNumeric = cells.filter(c => !isNumericLike(c)).length;
  return nonNumeric / cells.length;
}

function isLikelyHeaderRow(cells: string[], neighbor: string[] | undefined): boolean {
  if (!cells || cells.length === 0) return false;
  const maxLenOk = cells.every(c => (c?.length ?? 0) <= 32);
  const uniq = new Set(cells.map(c => c?.toLowerCase?.() ?? c));
  const mostlyUnique = uniq.size >= Math.max(1, Math.floor(cells.length * 0.8));
  const ratio = stringRatio(cells);
  const neighborRatio = neighbor ? stringRatio(neighbor) : 0;
  return maxLenOk && mostlyUnique && ratio >= 0.7 && ratio > neighborRatio;
}

export async function detectHeaderAndData(
  rows: string[][],
  delimiter: string,
  useLLM: boolean,
  modelId: string
): Promise<HeaderDetection> {
  const K = 5;
  const colCounts = rows.map(r => r.length);
  const windows: Array<{ start: number; count: number }> = [];
  for (let i = 0; i + K <= rows.length; i++) {
    const slice = colCounts.slice(i, i + K);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / slice.length;
    const stdev = Math.sqrt(variance);
    if (stdev === 0) windows.push({ start: i, count: slice[0] });
  }

  if (windows.length === 0) {
    const first = rows.findIndex(r => r.length > 1);
    return { header_row_index: first, data_start_row_index: Math.max(first, 0), has_header: false, ambiguous: true };
  }

  windows.sort((a, b) => (b.count - a.count) || (a.start - b.start));
  const firstStart = windows[0].start;
  const sameCountStarts = windows.filter(w => w.count === windows[0].count).map(w => w.start);
  const nearby = sameCountStarts.filter(c => Math.abs(c - firstStart) <= 2);
  let ambiguous = nearby.length > 1;

  let dataStart = firstStart;
  let headerIndex = dataStart;
  let hasHeader = false;

  const prevIdx = dataStart - 1;
  if (prevIdx >= 0 && rows[prevIdx].length === rows[dataStart].length) {
    const prevRatio = stringRatio(rows[prevIdx]);
    const currRatio = stringRatio(rows[dataStart]);
    if (prevRatio > currRatio && isLikelyHeaderRow(rows[prevIdx], rows[dataStart])) {
      headerIndex = prevIdx;
      hasHeader = true;
    }
  }

  if (!hasHeader && rows[dataStart + 1] && rows[dataStart].length === rows[dataStart + 1].length) {
    if (isLikelyHeaderRow(rows[dataStart], rows[dataStart + 1])) {
      headerIndex = dataStart;
      dataStart = dataStart + 1;
      hasHeader = true;
    }
  }

  if (ambiguous && useLLM) {
    const runner = new BaseModelRunner();
    const interaction = new Interaction({ name: modelId, provider: 'google' } as any, 'You are a CSV structure detector. Output JSON with two integers only.');
    const boundaryStart = Math.max(0, firstStart - 10);
    const boundaryEnd = Math.min(rows.length, firstStart + 10);
    const snippet = rows.slice(boundaryStart, boundaryEnd).map(r => r.join(delimiter)).join('\n');
    interaction.addMessage({ role: 'user', content: `Delimiter: ${delimiter}\nLines:\n${snippet}\nRespond strictly as JSON: { "header_row_index": <int>, "data_start_row_index": <int> }` });
    const resp = await runner.generateText(interaction);
    try {
      const json = JSON.parse((resp.content || '').toString());
      if (Number.isInteger(json.header_row_index) && Number.isInteger(json.data_start_row_index)) {
        headerIndex = json.header_row_index as number;
        dataStart = json.data_start_row_index as number;
        hasHeader = headerIndex !== dataStart;
        ambiguous = false;
      }
    } catch {}
  }

  return { header_row_index: headerIndex, data_start_row_index: dataStart, has_header: hasHeader, ambiguous };
}