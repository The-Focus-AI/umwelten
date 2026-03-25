import { z } from 'zod';
import { Interaction } from '../../../src/interaction/core/interaction.js';
import { Stimulus } from '../../../src/stimulus/stimulus.js';
import type { ModelDetails } from '../../../src/cognition/types.js';

/** Default judge model */
export const JUDGE_MODEL: ModelDetails = { name: 'anthropic/claude-haiku-4.5', provider: 'openrouter' };

/** Parse JSON from an LLM response (handles markdown fences) */
export function parseJudgeJSON(response: string): any {
  let jsonStr = response.trim();
  const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/) || jsonStr.match(/(\{[\s\S]*\})/);
  if (match) jsonStr = match[1].trim();
  return JSON.parse(jsonStr);
}

/**
 * Run a single judge call. Uses passthrough parsing to avoid strict
 * Zod failures — the LLM judge may return slightly different types.
 * Returns the raw parsed object with reasoning_quality extracted.
 */
export async function judgeResponse<T extends z.ZodObject<any>>(
  judgeModel: ModelDetails,
  instructions: string[],
  content: string,
  schema: T
): Promise<z.infer<T>> {
  // Build a JSON template from the schema shape so the judge knows exact field names
  const schemaShape = schema.shape;
  const fieldDescriptions = Object.entries(schemaShape)
    .map(([key, val]: [string, any]) => `  "${key}": ${val.description ? `(${val.description})` : 'value'}`)
    .join('\n');

  const judgeStimulus = new Stimulus({
    role: 'evaluation judge',
    objective: 'assess AI model responses accurately and consistently',
    instructions: [
      ...instructions,
      'Reply with ONLY a valid JSON object using EXACTLY these field names:',
      `{\n${fieldDescriptions}\n}`,
      'Use these EXACT field names. All string fields must be strings. All number fields must be numbers. All boolean fields must be true/false.',
    ],
    temperature: 0.0,
    maxTokens: 500,
    runnerType: 'base',
  });

  const interaction = new Interaction(judgeModel, judgeStimulus);
  interaction.addMessage({
    role: 'user',
    content: `Here is the model response to judge:\n\n---\n${content}\n---\n\nScore this response. Reply with ONLY a JSON object using the exact field names specified.`,
  });

  const judgeResp = await interaction.generateText();
  const raw = parseJudgeJSON(judgeResp.content as string);

  // Try strict parse first
  const result = schema.safeParse(raw);
  if (result.success) return result.data;

  // If strict fails, coerce common issues and try a lenient parse
  const coerced = coerceObject(raw);
  const result2 = schema.safeParse(coerced);
  if (result2.success) return result2.data;

  // Last resort: manually build a minimal result
  const fallback: any = {};
  for (const key of Object.keys(raw)) {
    fallback[key] = raw[key];
  }
  // Ensure reasoning_quality is a number
  if (typeof fallback.reasoning_quality === 'string') {
    fallback.reasoning_quality = parseInt(fallback.reasoning_quality, 10) || 1;
  }
  // Ensure explanation is a string
  if (typeof fallback.explanation !== 'string') {
    fallback.explanation = String(fallback.explanation ?? 'no explanation');
  }

  const result3 = schema.safeParse(fallback);
  if (result3.success) return result3.data;

  // Give up — throw with the original error + the raw response for debugging
  throw new Error(`Judge parse failed: ${JSON.stringify(result.error.issues.slice(0, 3))} | coerced: ${JSON.stringify(coerced).slice(0, 300)}`);
}

/** Coerce common type mismatches from LLM judge output */
function coerceObject(obj: any): any {
  if (typeof obj !== 'object' || obj === null) return obj;

  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      // Try to coerce "true"/"false" to boolean
      if (value === 'true') { result[key] = true; continue; }
      if (value === 'false') { result[key] = false; continue; }
      // Try to coerce numeric strings
      const num = Number(value);
      if (!isNaN(num) && value.trim() !== '') {
        // Only coerce if the field name suggests it should be a number
        if (key.includes('score') || key.includes('quality') || key.includes('answer') || key.includes('numeric')) {
          result[key] = num;
          continue;
        }
      }
    }
    result[key] = value;
  }
  return result;
}
