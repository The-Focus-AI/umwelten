import { z } from 'zod';

export interface Puzzle {
  id: string;
  name: string;
  prompt: string;
  correctAnswer: string;
  judgeSchema: z.ZodObject<any>;
  judgeInstructions: string[];
}

// ── Puzzle 1: The Surgeon Riddle ─────────────────────────────────────────────

const SurgeonSchema = z.object({
  answer: z.string().describe(
    'What is the surgeon\'s relationship? Use one of: mother, other_parent, wrong, multiple_answers, unclear'
  ),
  identifies_mother: z.coerce.boolean().describe('Does the model identify the surgeon as the boy\'s mother?'),
  hedges: z.coerce.boolean().describe('Does the model list many possibilities instead of the obvious answer?'),
  reasoning_quality: z.coerce.number().min(1).max(5).describe(
    '5=immediately says mother, 4=says mother with brief explanation, 3=mentions mother among others, 2=wrong answer, 1=completely missed'
  ),
  explanation: z.string(),
});

const surgeonPuzzle: Puzzle = {
  id: 'surgeon',
  name: 'The Surgeon Riddle',
  prompt: 'A father and his son are in a car accident. The father dies at the scene. The son is rushed to the hospital. In the operating room, the surgeon says: "I can\'t operate on this boy, he\'s my son." How is this possible?',
  correctAnswer: 'The surgeon is the boy\'s mother.',
  judgeSchema: SurgeonSchema,
  judgeInstructions: [
    'The correct answer is: the surgeon is the boy\'s MOTHER.',
    'A model that immediately identifies the surgeon as the mother gets 5/5.',
    'A model that lists many possibilities (step-parent, adopted, two fathers, etc.) but includes mother gets 3/5 — it\'s hedging rather than recognizing the obvious.',
    'A model that misses "mother" entirely fails.',
  ],
};

// ── Puzzle 2: The Bat and Ball ───────────────────────────────────────────────

const BatBallSchema = z.object({
  numeric_answer: z.coerce.number().describe('The dollar amount the model says the ball costs'),
  correct: z.coerce.boolean().describe('Is the answer $0.05?'),
  shows_work: z.coerce.boolean().describe('Does the model show algebraic work or explain why $0.10 is wrong?'),
  fell_for_trap: z.coerce.boolean().describe('Did the model initially or ultimately say $0.10?'),
  reasoning_quality: z.coerce.number().min(1).max(5).describe(
    '5=immediately gets $0.05 with clear math, 4=correct with explanation, 3=self-corrects from $0.10, 2=says $0.10, 1=wrong and confused'
  ),
  explanation: z.string(),
});

const batBallPuzzle: Puzzle = {
  id: 'bat-ball',
  name: 'The Bat and Ball',
  prompt: 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?',
  correctAnswer: '$0.05 (not $0.10)',
  judgeSchema: BatBallSchema,
  judgeInstructions: [
    'The correct answer is $0.05 (five cents).',
    'The intuitive WRONG answer is $0.10. If the ball is $0.10, the bat is $1.10, total is $1.20 — not $1.10.',
    'Correct: ball=$0.05, bat=$1.05, total=$1.10. ✓',
    'Score 5 if model immediately gets $0.05. Score 3 if it self-corrects. Score 2 if it says $0.10.',
    'Set numeric_answer to whatever dollar amount the model gives (e.g. 0.05 or 0.10).',
  ],
};

// ── Puzzle 3: The Lily Pad ───────────────────────────────────────────────────

const LilyPadSchema = z.object({
  numeric_answer: z.coerce.number().describe('The number of days the model says'),
  correct: z.coerce.boolean().describe('Is the answer 47?'),
  explains_doubling: z.coerce.boolean().describe('Does the model explain that doubling means half the day before?'),
  reasoning_quality: z.coerce.number().min(1).max(5).describe(
    '5=immediately says 47 with clear logic, 4=correct with explanation, 3=gets there eventually, 2=wrong (e.g. 24), 1=completely wrong'
  ),
  explanation: z.string(),
});

const lilyPadPuzzle: Puzzle = {
  id: 'lily-pad',
  name: 'The Lily Pad',
  prompt: 'A patch of lily pads doubles in size every day. If it takes 48 days for the patch to cover the entire lake, how many days does it take for the patch to cover half the lake?',
  correctAnswer: '47 days',
  judgeSchema: LilyPadSchema,
  judgeInstructions: [
    'The correct answer is 47 days.',
    'Since the patch doubles every day, on day 47 it covers half the lake, and on day 48 it doubles to cover the whole lake.',
    'The intuitive WRONG answer is 24 (half of 48). This reveals linear thinking instead of exponential.',
    'Score 5 if model immediately says 47. Score 2 if it says 24. Score 1 if some other wrong answer.',
  ],
};

// ── Puzzle 4: The Counterfeit Coin ───────────────────────────────────────────

const CoinSchema = z.object({
  says_possible: z.coerce.boolean().describe('Does the model say it IS possible?'),
  valid_procedure: z.coerce.boolean().describe('Does the described procedure actually work in exactly 3 weighings for all 12 coins?'),
  uses_only_three: z.coerce.boolean().describe('Does the procedure use only 3 weighings?'),
  determines_heavier_lighter: z.coerce.boolean().describe('Does the procedure determine if the counterfeit is heavier or lighter?'),
  reasoning_quality: z.coerce.number().min(1).max(5).describe(
    '5=correct and complete procedure, 4=mostly correct with minor gaps, 3=right idea but incomplete, 2=says possible but wrong method, 1=says impossible or incoherent'
  ),
  explanation: z.string(),
});

const coinPuzzle: Puzzle = {
  id: 'counterfeit-coin',
  name: 'The Counterfeit Coin',
  prompt: 'You have 12 coins. One is counterfeit and is either heavier or lighter than the rest. Using a balance scale exactly 3 times, can you identify the counterfeit coin AND determine whether it is heavier or lighter? Describe the procedure step by step.',
  correctAnswer: 'Yes. Divide into groups of 4, weigh 4 vs 4, then narrow down with 2 more weighings.',
  judgeSchema: CoinSchema,
  judgeInstructions: [
    'The answer is YES — it is possible to identify the counterfeit coin and determine heavier/lighter in exactly 3 weighings.',
    'The classic solution: Weigh 4 coins vs 4 coins. Based on the result (balanced or unbalanced), narrow down suspects. Two more weighings can identify the exact coin and its weight difference.',
    'A valid procedure must: (1) use exactly 3 weighings, (2) handle all 12 coins, (3) determine which coin AND whether heavier/lighter.',
    'Score 5 for a complete, correct procedure. Score 3 for right idea but incomplete coverage. Score 1 for saying it\'s impossible.',
    'Don\'t require the exact classic solution — any valid 3-weighing procedure that works counts.',
  ],
};

// ── Export all puzzles ───────────────────────────────────────────────────────

export const ALL_PUZZLES: Puzzle[] = [
  surgeonPuzzle,
  batBallPuzzle,
  lilyPadPuzzle,
  coinPuzzle,
];
