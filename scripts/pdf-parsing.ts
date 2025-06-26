import { z } from 'zod';
import { ModelDetails, ModelResponse } from '../src/cognition/types.js';
import { Interaction } from '../src/interaction/interaction.js';
import { BaseModelRunner } from '../src/cognition/runner.js';
import { Stimulus } from '../src/interaction/stimulus.js';
import { evaluate } from '../src/evaluation/evaluate.js';
import path from 'path';

// 1. Define the output schema with Zod
export const PDFSummarySchema = z.object({
  able_to_parse: z.object({
    value: z.boolean().describe('Is the model able to parse and analyze the attached PDF? true only if you actually see and analyze the PDF, false otherwise.'),
    confidence: z.number().min(0).max(1).describe('Confidence score for PDF parsing ability (0-1)'),
  }),
  summary: z.object({
    value: z.string().describe('A detailed summary of the PDF content'),
    confidence: z.number().min(0).max(1).describe('Confidence score for summary (0-1)'),
  }),
  main_points: z.object({
    value: z.array(z.string()).describe('Key points or arguments made in the document'),
    confidence: z.number().min(0).max(1).describe('Confidence score for main points (0-1)'),
  }),
  document_type: z.object({
    value: z.enum(['article', 'blog', 'paper', 'manual', 'unknown']).describe('Type of document'),
    confidence: z.number().min(0).max(1).describe('Confidence score for document type (0-1)'),
  }),
});

export type PDFSummary = z.infer<typeof PDFSummarySchema>;

// 2. Create the Stimulus (Prompt)
const pdfPrompt = new Stimulus();
pdfPrompt.setRole('You are an expert document analyst.');
pdfPrompt.setObjective('Given a PDF, extract a detailed summary, main points, and document type as a JSON object.');
// pdfPrompt.setOutputSchema(PDFSummarySchema); // Optionally include schema

// 3. Core extraction function
export async function pdfParseExtract(pdfPath: string, model: ModelDetails): Promise<ModelResponse> {
  const conversation = new Interaction(model, pdfPrompt.getPrompt());
  await conversation.addAttachmentFromPath(pdfPath);
  const runner = new BaseModelRunner();
  return runner.streamObject(conversation, PDFSummarySchema);
}

// 4. Orchestrator: Evaluate for each model
const evaluationId = 'pdf-parsing';
const pdfFile = 'Home-Cooked Software and Barefoot Developers.pdf';
const pdfPath = path.resolve('input', 'pdf-parsing', pdfFile); // Adjust as needed

const models: ModelDetails[] = [
  { name: 'gemma3:12b', provider: 'ollama' },
  { name: 'qwen2.5:14b', provider: 'ollama' },
  { name: 'phi4:latest', provider: 'ollama' },
  { name: 'phi4-mini:latest', provider: 'ollama' },
  { name: 'gemini-2.0-flash', provider: 'google' },
  { name: 'gemini-2.5-flash', provider: 'google' },
];

async function main() {
  for (const model of models) {
    await evaluate(
      (details) => pdfParseExtract(pdfPath, details),
      evaluationId,
      pdfFile,
      model
    );
  }
}

main();

