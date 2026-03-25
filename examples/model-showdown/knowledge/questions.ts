/**
 * World Knowledge Questions — Factual recall with LLM judge scoring
 *
 * Categories:
 * - Science & Math (verifiable constants, formulas)
 * - Geography (capitals, populations, measurements)
 * - History (dates, events, people)
 * - Technology (standards, protocols, specs)
 * - AI/ML (domain knowledge)
 * - Tricky (adversarial / hallucination tests)
 *
 * Each question has judge instructions for LLM-based scoring.
 */

import { z } from 'zod';

export interface KnowledgeQuestion {
  id: string;
  category: string;
  question: string;
  /** Human-readable correct answer for display */
  correctAnswer: string;
  /** Difficulty: 1=easy, 2=medium, 3=hard */
  difficulty: number;
}

/** Zod schema for knowledge judge output */
export const knowledgeJudgeSchema = z.object({
  correct: z.boolean().describe('Whether the answer is factually correct'),
  score: z.number().describe('Score from 0 to 1: 1 = correct, 0 = wrong, 0.5 = partially correct'),
  explanation: z.string().describe('Brief explanation of why the answer is correct or incorrect'),
});

/** Build judge instructions for a knowledge question */
export function knowledgeJudgeInstructions(question: KnowledgeQuestion): string[] {
  return [
    `You are judging whether a model correctly answered this factual question:`,
    `Question: "${question.question}"`,
    `Correct answer: ${question.correctAnswer}`,
    '',
    'Scoring rules:',
    '- score 1 if the answer is correct or essentially correct (minor formatting differences are OK)',
    '- score 0.5 if partially correct (e.g. right concept but wrong number, or one of multiple parts correct)',
    '- score 0 if wrong, hallucinated, or refuses to answer',
    '',
    'Be lenient on format — "299,792,458", "299792458", "~3×10^8 m/s" are all acceptable for speed of light.',
    'Accept equivalent names (e.g. "Nur-Sultan" and "Astana" for Kazakhstan capital).',
    'Accept different notations for formulas (LaTeX, Unicode, plain text).',
    'Focus on factual correctness, not exact formatting.',
  ];
}

// ── Science & Math ──────────────────────────────────────────────────────────

const scienceQuestions: KnowledgeQuestion[] = [
  {
    id: 'sci-1',
    category: 'Science',
    question: 'What is the speed of light in a vacuum in meters per second? Give only the number.',
    correctAnswer: '299,792,458 m/s',
    difficulty: 1,
  },
  {
    id: 'sci-2',
    category: 'Science',
    question: 'What is the chemical formula for glucose? Give only the formula.',
    correctAnswer: 'C6H12O6',
    difficulty: 1,
  },
  {
    id: 'sci-3',
    category: 'Science',
    question: 'What is the half-life of Carbon-14 in years? Give only the number, rounded to the nearest hundred.',
    correctAnswer: '5,730 years',
    difficulty: 2,
  },
  {
    id: 'sci-4',
    category: 'Science',
    question: 'What is the atomic number of Oganesson? Give only the number.',
    correctAnswer: '118',
    difficulty: 2,
  },
  {
    id: 'sci-5',
    category: 'Science',
    question: 'What is the Schwarzschild radius formula? Write it using standard notation.',
    correctAnswer: 'r = 2GM/c²',
    difficulty: 3,
  },
];

// ── Geography ───────────────────────────────────────────────────────────────

const geographyQuestions: KnowledgeQuestion[] = [
  {
    id: 'geo-1',
    category: 'Geography',
    question: 'What is the capital of Kazakhstan? Give only the city name.',
    correctAnswer: 'Astana (also known as Nur-Sultan from 2019-2022)',
    difficulty: 1,
  },
  {
    id: 'geo-2',
    category: 'Geography',
    question: 'What is the deepest point in the ocean and how deep is it in meters? Give the name and depth.',
    correctAnswer: 'Challenger Deep, ~10,935 meters',
    difficulty: 1,
  },
  {
    id: 'geo-3',
    category: 'Geography',
    question: 'What country has the most time zones? Give only the country name.',
    correctAnswer: 'France (12 time zones including overseas territories)',
    difficulty: 2,
  },
  {
    id: 'geo-4',
    category: 'Geography',
    question: 'What is the longest river in Africa? Give only the river name.',
    correctAnswer: 'Nile',
    difficulty: 1,
  },
  {
    id: 'geo-5',
    category: 'Geography',
    question: 'Name the only country that borders both the Caspian Sea and the Persian Gulf.',
    correctAnswer: 'Iran',
    difficulty: 2,
  },
];

// ── History ─────────────────────────────────────────────────────────────────

const historyQuestions: KnowledgeQuestion[] = [
  {
    id: 'hist-1',
    category: 'History',
    question: 'In what year did the Berlin Wall fall? Give only the year.',
    correctAnswer: '1989',
    difficulty: 1,
  },
  {
    id: 'hist-2',
    category: 'History',
    question: 'Who was the first person to reach the South Pole? Give only the name.',
    correctAnswer: 'Roald Amundsen',
    difficulty: 2,
  },
  {
    id: 'hist-3',
    category: 'History',
    question: 'What treaty ended World War I? Give only the treaty name.',
    correctAnswer: 'Treaty of Versailles',
    difficulty: 1,
  },
  {
    id: 'hist-4',
    category: 'History',
    question: 'In what year was the transistor invented at Bell Labs? Give only the year.',
    correctAnswer: '1947',
    difficulty: 2,
  },
  {
    id: 'hist-5',
    category: 'History',
    question: 'Who wrote the Principia Mathematica that established classical mechanics? Give only the surname.',
    correctAnswer: 'Newton',
    difficulty: 1,
  },
];

// ── Technology ──────────────────────────────────────────────────────────────

const techQuestions: KnowledgeQuestion[] = [
  {
    id: 'tech-1',
    category: 'Technology',
    question: 'What port number does HTTPS use by default? Give only the number.',
    correctAnswer: '443',
    difficulty: 1,
  },
  {
    id: 'tech-2',
    category: 'Technology',
    question: 'What is the maximum value of a signed 32-bit integer? Give only the number.',
    correctAnswer: '2,147,483,647',
    difficulty: 2,
  },
  {
    id: 'tech-3',
    category: 'Technology',
    question: 'What year was the first version of the HTTP protocol (HTTP/0.9) introduced? Give only the year.',
    correctAnswer: '1991',
    difficulty: 2,
  },
  {
    id: 'tech-4',
    category: 'Technology',
    question: 'In the OSI model, what is Layer 4 called? Give only the layer name.',
    correctAnswer: 'Transport Layer',
    difficulty: 1,
  },
  {
    id: 'tech-5',
    category: 'Technology',
    question: 'What does the NVIDIA acronym CUDA stand for? Give the full expansion.',
    correctAnswer: 'Compute Unified Device Architecture',
    difficulty: 2,
  },
];

// ── AI / ML Knowledge (relevant for base model evaluation) ──────────────────

const aiQuestions: KnowledgeQuestion[] = [
  {
    id: 'ai-1',
    category: 'AI/ML',
    question: 'What does the "T" in GPT stand for? Give the full word.',
    correctAnswer: 'Transformer',
    difficulty: 1,
  },
  {
    id: 'ai-2',
    category: 'AI/ML',
    question: 'In the original "Attention is All You Need" paper, what was the model dimension (d_model) used? Give only the number.',
    correctAnswer: '512',
    difficulty: 3,
  },
  {
    id: 'ai-3',
    category: 'AI/ML',
    question: 'What activation function is most commonly used in transformer feed-forward layers? Give only the name.',
    correctAnswer: 'GELU (or ReLU in original)',
    difficulty: 2,
  },
  {
    id: 'ai-4',
    category: 'AI/ML',
    question: 'What company created the Llama series of language models? Give only the company name.',
    correctAnswer: 'Meta',
    difficulty: 1,
  },
  {
    id: 'ai-5',
    category: 'AI/ML',
    question: 'What is the name of the technique where a large model is used to train a smaller model by matching output distributions? Give the technique name.',
    correctAnswer: 'Knowledge Distillation',
    difficulty: 2,
  },
];

// ── Tricky / Adversarial (tests whether model hallucinates) ─────────────────

const trickyQuestions: KnowledgeQuestion[] = [
  {
    id: 'tricky-1',
    category: 'Tricky',
    question: 'How many "r"s are in the word "strawberry"? Give only the number.',
    correctAnswer: '3',
    difficulty: 2,
  },
  {
    id: 'tricky-2',
    category: 'Tricky',
    question: 'Is the number 91 prime? Answer only "yes" or "no".',
    correctAnswer: 'No (91 = 7 × 13)',
    difficulty: 2,
  },
  {
    id: 'tricky-3',
    category: 'Tricky',
    question: 'A farmer has 17 sheep. All but 9 die. How many sheep does the farmer have left? Give only the number.',
    correctAnswer: '9',
    difficulty: 1,
  },
  {
    id: 'tricky-4',
    category: 'Tricky',
    question: 'What weighs more: a pound of feathers or a pound of steel? Answer with "same", "feathers", or "steel".',
    correctAnswer: 'Same (both weigh one pound)',
    difficulty: 1,
  },
  {
    id: 'tricky-5',
    category: 'Tricky',
    question: 'If you have a 3-gallon jug and a 5-gallon jug, how do you measure exactly 4 gallons? Describe the steps briefly.',
    correctAnswer: 'Fill 5, pour into 3 (leaves 2 in 5), empty 3, pour 2 into 3, fill 5, pour into 3 (leaves 4 in 5)',
    difficulty: 3,
  },
];

// ── Export ────────────────────────────────────────────────────────────────────

export const ALL_QUESTIONS: KnowledgeQuestion[] = [
  ...scienceQuestions,
  ...geographyQuestions,
  ...historyQuestions,
  ...techQuestions,
  ...aiQuestions,
  ...trickyQuestions,
];

export const CATEGORIES = ['Science', 'Geography', 'History', 'Technology', 'AI/ML', 'Tricky'] as const;
