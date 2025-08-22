import { z } from 'zod';
import { ModelDetails, ModelResponse } from '../src/cognition/types.js';
import { Interaction } from '../src/interaction/interaction.js';
import { BaseModelRunner } from '../src/cognition/runner.js';
import { Stimulus } from '../src/interaction/stimulus.js';
import { evaluate } from '../src/evaluation/evaluate.js';
import path from 'path';
import fs from 'fs';

// 1. Define the output schema with Zod
export const PDFIdentificationSchema = z.object({
  able_to_parse: z.object({
    value: z.boolean().describe('Is the model able to parse and analyze the attached PDF? true only if you actually see and analyze the PDF, false otherwise.'),
    confidence: z.number().min(0).max(1).describe('Confidence score for PDF parsing ability (0-1)'),
  }),
  title: z.object({
    value: z.string().describe('The title of the document as it appears in the PDF'),
    confidence: z.number().min(0).max(1).describe('Confidence score for title extraction (0-1)'),
  }),
  author: z.object({
    value: z.string().describe('The author(s) of the document. If multiple authors, separate with commas. If no author found, use "Unknown"'),
    confidence: z.number().min(0).max(1).describe('Confidence score for author extraction (0-1)'),
  }),
  document_type: z.object({
    value: z.enum(['book', 'paper', 'blog_post', 'manual', 'report', 'unknown']).describe('Type of document'),
    confidence: z.number().min(0).max(1).describe('Confidence score for document type (0-1)'),
  }),
});

export type PDFIdentification = z.infer<typeof PDFIdentificationSchema>;

// 2. Create the Stimulus (Prompt)
const pdfPrompt = new Stimulus();
pdfPrompt.setRole('You are an expert document identifier and bibliographer.');
pdfPrompt.setObjective('Given a PDF, extract the title, author(s), and document type. Focus on identifying these key bibliographic elements rather than analyzing content.');

// 3. Core extraction function
export async function pdfIdentifyExtract(pdfPath: string, model: ModelDetails): Promise<ModelResponse> {
  const conversation = new Interaction(model, pdfPrompt.getPrompt());
  await conversation.addAttachmentFromPath(pdfPath);
  const runner = new BaseModelRunner();
  return runner.generateObject(conversation, PDFIdentificationSchema);
}

// 4. Get all PDFs from the input directory
function getPDFFiles(directory: string): string[] {
  try {
    const files = fs.readdirSync(directory);
    return files.filter(file => file.toLowerCase().endsWith('.pdf'));
  } catch (error) {
    console.error(`Error reading directory ${directory}:`, error);
    return [];
  }
}

const evaluationId = 'pdf-identification';
const pdfDirectory = path.resolve('input', 'pdf-parsing');
const pdfFiles = getPDFFiles(pdfDirectory);

const models: ModelDetails[] = [
  { name: 'gemma3:12b', provider: 'ollama' },
  { name: 'qwen2.5:14b', provider: 'ollama' },
  { name: 'phi4:latest', provider: 'ollama' },
  { name: 'phi4-mini:latest', provider: 'ollama' },
  { name: 'gemini-2.0-flash', provider: 'google' },
  { name: 'gemini-2.5-flash', provider: 'google' },
];

async function main() {
  console.log(`Found ${pdfFiles.length} PDF files to process:`);
  pdfFiles.forEach(file => console.log(`  - ${file}`));
  
  for (const pdfFile of pdfFiles) {
    const pdfPath = path.resolve(pdfDirectory, pdfFile);
    console.log(`\nProcessing: ${pdfFile}`);
    
    for (const model of models) {
      console.log(`  Testing with model: ${model.name} (${model.provider})`);
      try {
        await evaluate(
          (details) => pdfIdentifyExtract(pdfPath, details),
          evaluationId,
          pdfFile,
          model
        );
      } catch (error) {
        console.error(`Error evaluating ${model.name}:`, error);
      }
    }
  }
}

main().catch(error => {
  console.error('Error in main:', error);
});

