/**
 * Instruction Following Tasks — Tests precise format compliance
 *
 * Critical for evaluating base model quality for fine-tuning:
 * a model that can't follow exact instructions won't fine-tune well.
 *
 * Each task has specific format requirements and deterministic verification.
 */

export interface InstructionTask {
  id: string;
  name: string;
  prompt: string;
  /** Deterministic verification of the response */
  verify: (response: string) => { pass: boolean; score: number; details: string };
}

// ── Task 1: Exact Word Count ────────────────────────────────────────────────

const exactWordCount: InstructionTask = {
  id: 'exact-word-count',
  name: 'Exact Word Count',
  prompt: 'Write a sentence about the ocean that contains EXACTLY 12 words. Do not include any other text, explanation, or commentary — just the single 12-word sentence.',
  verify: (response) => {
    const text = response.trim().replace(/\n/g, ' ');
    // Remove quotes if wrapped
    const cleaned = text.replace(/^["']|["']$/g, '').trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    const count = words.length;
    if (count === 12) return { pass: true, score: 5, details: `Correct: ${count} words` };
    const diff = Math.abs(count - 12);
    if (diff <= 1) return { pass: false, score: 3, details: `Close: ${count} words (off by ${diff})` };
    if (diff <= 3) return { pass: false, score: 1, details: `${count} words (off by ${diff})` };
    return { pass: false, score: 0, details: `${count} words (wanted 12)` };
  },
};

// ── Task 2: Structured JSON Output ──────────────────────────────────────────

const jsonOutput: InstructionTask = {
  id: 'json-output',
  name: 'Structured JSON Output',
  prompt: `Output a JSON object with EXACTLY these fields, in this order:
- "name": a fictional person's name (string)
- "age": a number between 25 and 35
- "skills": an array of exactly 3 strings
- "active": boolean true

Output ONLY the JSON object. No markdown fences, no explanation, no other text.`,
  verify: (response) => {
    const text = response.trim();
    // Try to extract JSON
    let jsonStr = text;
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    try {
      const obj = JSON.parse(jsonStr);
      let score = 0;
      const failures: string[] = [];

      // Check fields exist
      if (typeof obj.name === 'string' && obj.name.length > 0) score++;
      else failures.push('missing/invalid name');

      if (typeof obj.age === 'number' && obj.age >= 25 && obj.age <= 35) score++;
      else failures.push(`age=${obj.age} (want 25-35)`);

      if (Array.isArray(obj.skills) && obj.skills.length === 3 &&
          obj.skills.every((s: any) => typeof s === 'string')) score++;
      else failures.push(`skills length=${obj.skills?.length} (want 3 strings)`);

      if (obj.active === true) score++;
      else failures.push(`active=${obj.active} (want true)`);

      // Bonus: no markdown fences used
      if (!text.includes('```')) score++;
      else failures.push('used markdown fences (asked not to)');

      return {
        pass: score === 5,
        score,
        details: failures.length ? `Failures: ${failures.join('; ')}` : 'Perfect JSON output',
      };
    } catch (e) {
      return { pass: false, score: 0, details: `Invalid JSON: ${(e as Error).message.slice(0, 50)}` };
    }
  },
};

// ── Task 3: List with Exact Constraints ─────────────────────────────────────

const constrainedList: InstructionTask = {
  id: 'constrained-list',
  name: 'Constrained List',
  prompt: `List exactly 5 animals. Rules:
1. Each animal must be on its own line
2. Each line must start with a number and period (e.g., "1. Dog")
3. No animal name can be longer than 8 characters
4. Animals must be in alphabetical order
5. No extra text, headers, or explanations

Output ONLY the numbered list.`,
  verify: (response) => {
    const lines = response.trim().split('\n').map(l => l.trim()).filter(Boolean);
    let score = 0;
    const failures: string[] = [];

    // Check exactly 5 lines
    if (lines.length === 5) score++;
    else failures.push(`${lines.length} lines (want 5)`);

    // Check numbering format
    const numbered = lines.every((l, i) => l.startsWith(`${i + 1}.`));
    if (numbered) score++;
    else failures.push('numbering format wrong');

    // Extract animal names
    const animals = lines.map(l => {
      const m = l.match(/^\d+\.\s*(.+)/);
      return m ? m[1].trim() : '';
    });

    // Check length constraint
    const allShort = animals.every(a => a.length <= 8);
    if (allShort) score++;
    else failures.push(`some names > 8 chars: ${animals.filter(a => a.length > 8).join(', ')}`);

    // Check alphabetical order
    const sorted = [...animals].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    const inOrder = animals.every((a, i) => a.toLowerCase() === sorted[i].toLowerCase());
    if (inOrder) score++;
    else failures.push('not alphabetical');

    // No extra text
    const clean = lines.length <= 5 && !response.includes('Here');
    if (clean) score++;
    else failures.push('extra text detected');

    return {
      pass: score === 5,
      score,
      details: failures.length ? `Failures: ${failures.join('; ')}` : 'All constraints met',
    };
  },
};

// ── Task 4: Negative Constraints ────────────────────────────────────────────

const negativeConstraints: InstructionTask = {
  id: 'negative-constraints',
  name: 'Negative Constraints',
  prompt: `Write a 2-sentence description of a sunset. Rules:
- Do NOT use the word "beautiful"
- Do NOT use the word "sky"
- Do NOT use the word "orange"
- Do NOT use any exclamation marks
- Each sentence must be on its own line

Output ONLY the two sentences.`,
  verify: (response) => {
    const text = response.trim();
    const lower = text.toLowerCase();
    let score = 0;
    const failures: string[] = [];

    // Check forbidden words
    if (!lower.includes('beautiful')) score++;
    else failures.push('contains "beautiful"');

    if (!lower.includes('sky')) score++;
    else failures.push('contains "sky"');

    if (!lower.includes('orange')) score++;
    else failures.push('contains "orange"');

    if (!text.includes('!')) score++;
    else failures.push('contains exclamation mark');

    // Check 2 sentences on separate lines
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 2) score++;
    else failures.push(`${lines.length} lines (want 2)`);

    return {
      pass: score === 5,
      score,
      details: failures.length ? `Failures: ${failures.join('; ')}` : 'All constraints met',
    };
  },
};

// ── Task 5: Format Transformation ───────────────────────────────────────────

const formatTransform: InstructionTask = {
  id: 'format-transform',
  name: 'Format Transformation',
  prompt: `Convert this data into a markdown table:

Alice, 28, Engineer
Bob, 34, Designer
Charlie, 22, Student

The table must have columns: Name, Age, Role
Include the header row and separator row.
Output ONLY the markdown table, nothing else.`,
  verify: (response) => {
    const text = response.trim();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let score = 0;
    const failures: string[] = [];

    // Has at least 5 lines (header + separator + 3 data rows)
    if (lines.length >= 5) score++;
    else failures.push(`${lines.length} lines (want 5+)`);

    // Header contains Name, Age, Role
    if (lines[0] && /Name/i.test(lines[0]) && /Age/i.test(lines[0]) && /Role/i.test(lines[0])) score++;
    else failures.push('header missing Name/Age/Role');

    // Separator row with dashes
    if (lines[1] && /[-|]+/.test(lines[1])) score++;
    else failures.push('missing separator row');

    // Data rows contain correct data
    const hasAlice = lines.some(l => /Alice/i.test(l) && /28/.test(l) && /Engineer/i.test(l));
    const hasBob = lines.some(l => /Bob/i.test(l) && /34/.test(l) && /Designer/i.test(l));
    const hasCharlie = lines.some(l => /Charlie/i.test(l) && /22/.test(l) && /Student/i.test(l));
    if (hasAlice && hasBob && hasCharlie) score++;
    else failures.push('missing data rows');

    // Clean — no extra text
    const allPipes = lines.every(l => l.includes('|'));
    if (allPipes) score++;
    else failures.push('not all lines use pipe format');

    return {
      pass: score === 5,
      score,
      details: failures.length ? `Failures: ${failures.join('; ')}` : 'Perfect markdown table',
    };
  },
};

// ── Task 6: Multi-format Output ─────────────────────────────────────────────

const multiFormat: InstructionTask = {
  id: 'multi-format',
  name: 'Multi-format Response',
  prompt: `Respond with EXACTLY three sections separated by "---" on its own line:

Section 1: A single word that is a color
Section 2: A number between 1 and 100
Section 3: The word from Section 1 repeated 3 times separated by commas

Example format:
blue
---
42
---
blue, blue, blue

Output ONLY the three sections with separators. No labels, no explanation.`,
  verify: (response) => {
    const text = response.trim();
    const sections = text.split(/^---$/m).map(s => s.trim());
    let score = 0;
    const failures: string[] = [];

    // Has 3 sections
    if (sections.length === 3) score++;
    else { failures.push(`${sections.length} sections (want 3)`); return { pass: false, score: 0, details: failures.join('; ') }; }

    // Section 1: single word (color)
    const color = sections[0].trim().toLowerCase();
    const isOneWord = color.split(/\s+/).length === 1;
    const knownColors = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'black', 'white', 'gray', 'grey', 'brown', 'violet', 'indigo', 'cyan', 'magenta', 'teal', 'maroon', 'navy', 'gold', 'silver', 'crimson', 'scarlet', 'turquoise', 'lavender', 'coral', 'salmon', 'amber'];
    if (isOneWord && knownColors.includes(color)) score++;
    else failures.push(`section 1: "${sections[0]}" (want a single color word)`);

    // Section 2: number 1-100
    const num = parseInt(sections[1].trim(), 10);
    if (!isNaN(num) && num >= 1 && num <= 100) score++;
    else failures.push(`section 2: "${sections[1]}" (want number 1-100)`);

    // Section 3: color repeated 3 times
    const repeated = sections[2].trim().toLowerCase();
    const expectedRepeat = `${color}, ${color}, ${color}`;
    if (repeated === expectedRepeat) score++;
    else failures.push(`section 3: got "${sections[2].slice(0, 40)}", want "${expectedRepeat}"`);

    // No extra text/labels
    const noLabels = !text.toLowerCase().includes('section');
    if (noLabels) score++;
    else failures.push('contains "section" labels');

    return {
      pass: score === 5,
      score,
      details: failures.length ? `Failures: ${failures.join('; ')}` : 'All sections correct',
    };
  },
};

// ── Export ────────────────────────────────────────────────────────────────────

export const ALL_TASKS: InstructionTask[] = [
  exactWordCount,
  jsonOutput,
  constrainedList,
  negativeConstraints,
  formatTransform,
  multiFormat,
];
