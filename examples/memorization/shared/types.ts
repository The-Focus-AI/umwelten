/**
 * Types for the memorization extraction pipeline.
 * Based on "Alignment Whack-a-Mole" (Liu et al., 2026).
 */

/** A chunk of text from a book, split at sentence boundaries */
export interface BookChunk {
  bookId: string;
  chunkIndex: number;
  text: string;
  wordCount: number;
  charOffset: number;    // offset into original book text
  charLength: number;
}

/** LLM-generated plot summary for a chunk */
export interface Summary {
  bookId: string;
  chunkIndex: number;
  summary: string;
  wordCount: number;
  model: string;
}

/** Training pair: summary (input) → verbatim text (output) */
export interface TrainingPair {
  bookId: string;
  chunkIndex: number;
  prompt: string;
  completion: string;
  wordCount: number;
}

/** Chat-format training example (MLX / HuggingFace compatible) */
export interface ChatTrainingExample {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
}

/** Result of a single inference generation */
export interface GenerationResult {
  bookId: string;
  chunkIndex: number;
  sampleIndex: number;
  generation: string;
  model: string;
  durationMs: number;
}

/** A contiguous span of words matching the book text */
export interface MatchSpan {
  bookWordStart: number;    // start index in book word array
  bookWordEnd: number;      // end index (exclusive)
  genWordStart: number;     // start index in generation word array
  genWordEnd: number;       // end index (exclusive)
  length: number;           // number of matching words
  text: string;             // the matched text
}

/** Result of bmc@k computation for a single book */
export interface BmcResult {
  bookId: string;
  bmcAtK: number;          // fraction of book covered (0-1)
  totalBookWords: number;
  coveredWords: number;
  spans: MatchSpan[];
  longestSpan: number;     // longest contiguous match (words)
  spanCount: number;       // number of spans >= k words
  regurgitatedSpans: MatchSpan[];   // spans > 20 words
  longestRegurgitated: number;      // longest regurgitated span
}

/** Per-model metrics for a book */
export interface BookMetrics {
  bookId: string;
  modelKey: string;
  bmcAtK: number;
  longestSpan: number;
  longestRegurgitated: number;
  spanCount: number;
  regurgitatedSpanCount: number;
  totalGenerations: number;
  totalBookWords: number;
  coveredWords: number;
}

/** Pipeline configuration from config.json */
export interface MemorizationConfig {
  author: string;
  trainBooks: string[];
  testBooks: string[];
  platform: 'mlx' | 'hf';
  baseModel: string;
  ollamaBaseModel?: string;    // for Ollama conversion (e.g. 'qwen2.5:14b')
  samplesPerExcerpt: number;
  temperature: number;
  epochs: number;
  loraRank: number;
  batchSize: number;
  summaryModel?: string;       // model for generating summaries (default: gemini-3-flash-preview)
  summaryProvider?: string;    // provider for summary model (default: google)
  maxTokens?: number;          // max tokens for inference (default: 600)
}

/** Finetune result metadata */
export interface FinetuneResult {
  platform: 'mlx' | 'hf';
  baseModel: string;
  adapterPath: string;
  epochs: number;
  loraRank: number;
  batchSize: number;
  trainSamples: number;
  validSamples: number;
  trainLoss?: number;
  validLoss?: number;
  durationSeconds: number;
  timestamp: string;
}

/** Data split info */
export interface SplitInfo {
  trainBooks: string[];
  testBooks: string[];
  trainSamples: number;
  validSamples: number;
  testPrompts: number;
  timestamp: string;
}
