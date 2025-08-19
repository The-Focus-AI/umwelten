import fs from 'fs';
import path from 'path';
import { evaluate } from '../src/evaluation/evaluate.js';
import { imageFeatureExtract, ImageFeatureSchema } from './image-feature-extract.js';
import { ModelDetails, ModelResponse, ScoreResponse } from '../src/cognition/types.js';
import { EvaluationScorer } from '../src/evaluation/scorer.js';
import { EvaluationReporter } from '../src/evaluation/reporter.js';

// --- Config ---
const evaluationId = 'image-feature-extraction';
const inputDir = path.resolve('input/images');

const models: ModelDetails[] = [
  { name: 'gemma3:4b', provider: 'ollama' },
  { name: 'gemma3:12b', provider: 'ollama' },
  // { name: 'qwen3:4b', provider: 'ollama' },
  { name: 'mistral-small3.1:latest', provider: 'ollama' },
  { name: 'qwen2.5vl:latest', provider: 'ollama' },
  { name: 'gemma3:27b', provider: 'ollama' },
  // { name: 'qwen3:8b', provider: 'ollama' },
  { name: 'gemini-2.0-flash-lite', provider: 'google' },
  { name: 'gemini-2.5-flash', provider: 'google' },
];

// --- Feature List ---
const features = Object.keys(ImageFeatureSchema.shape);

// --- Batch Extraction ---
async function batchExtract() {
  const images = fs.readdirSync(inputDir).filter(f => /\.(jpg|jpeg|png)$/i.test(f)).slice(0, 10);
  
  for (const model of models) {
    for (const image of images) {
      const imagePath = path.join(inputDir, image);
      await evaluate(
        (details) => imageFeatureExtract(imagePath, details),
        evaluationId,
        image,
        model
      );
    }
  }
}

// --- Scoring ---
class ImageFeatureScorer extends EvaluationScorer {
  async scoreResponse(response: ModelResponse): Promise<ScoreResponse> {
    return {
      evals: features.map(feature => ({ 
          key: feature,
          value: 'N/A',
          score: 0
        })),
      metadata: response.metadata
    };
  }
}

async function scoreResults() {
  console.log('Scoring results...');
  const scorer = new ImageFeatureScorer(evaluationId);
  await scorer.score();
  console.log('Scoring complete.');
}

// --- Reporting ---
class ImageFeatureReporter extends EvaluationReporter {
  responses: ModelResponse[];
  scores: ScoreResponse[];
  groundTruth: Record<string, any>;

  constructor(evaluationId: string) {
    const responsesDir = path.join(process.cwd(), 'output/evaluations', evaluationId);
    super({ responsesDir });
    this.responses = [];
    this.scores = [];
    this.groundTruth = {};
  }

  loadResponses(baseDir: string): ModelResponse[] {
    const responses: ModelResponse[] = [];
    
    // List all image directories
    const imageDirs = fs.readdirSync(baseDir)
      .filter(f => fs.statSync(path.join(baseDir, f)).isDirectory() && f !== 'reports');
    
    // For each image directory
    for (const imageDir of imageDirs) {
      const imagePath = path.join(baseDir, imageDir);
      
      // List all model response files
      const files = fs.readdirSync(imagePath)
        .filter(f => f.endsWith('.json'));
      
      // Load each response
      for (const file of files) {
        const content = fs.readFileSync(path.join(imagePath, file), 'utf8');
        const response = {
          content,
          metadata: {
            model: file.replace('.json', ''),
            filename: imageDir,
            startTime: new Date(),
            endTime: new Date(),
            tokenUsage: {
              promptTokens: 0,
              completionTokens: 0,
              total: 0
            },
            provider: 'unknown',
            cost: {
              promptCost: 0,
              completionCost: 0,
              totalCost: 0,
              usage: {
                promptTokens: 0,
                completionTokens: 0,
                total: 0
              }
            }
          }
        } as ModelResponse;

        // Parse the content to get metadata
        try {
          const parsed = JSON.parse(content);
          if (parsed.metadata) {
            response.metadata = {
              ...response.metadata,
              ...parsed.metadata
            };
          }
        } catch (e) {
          console.warn(`Failed to parse metadata for ${imageDir} - ${file}`);
        }

        responses.push(response);
      }
    }
    
    return responses;
  }

  async generateReport(options: Record<string, unknown>): Promise<string> {
    const responsesDir = path.join(process.cwd(), 'output/evaluations', evaluationId);
    this.responses = this.loadResponses(responsesDir);
    let report = '# Image Feature Extraction Results\n\n';
    report += `Generated: ${new Date().toISOString()}\n\n`;

    // Get unique images and models
    const images = new Set<string>();
    const modelNames = new Set<string>();
    this.responses.forEach(r => {
      const imageId = (r.metadata as any).filename;
      if (imageId) images.add(path.basename(imageId));
      modelNames.add(r.metadata.model);
    });

    // Generate per-image sections
    for (const image of images) {
      report += `## ${image}\n\n`;
      report += `![${image}](../../../../input/images/${image})\n\n`;
      
      // Table header with features as columns
      report += '| Model | Time (ms) | ' + features.join(' | ') + ' |\n';
      report += '|-------|-----------|' + features.map(() => '----------').join('|') + '|\n';

      // One row per model
      for (const model of modelNames) {
        const response = this.responses.find(r => {
          const respImage = path.basename((r.metadata as any).filename);
          return respImage === image && r.metadata.model === model;
        });

        // Calculate processing time
        let processingTime = 'N/A';
        if (response?.metadata.startTime && response?.metadata.endTime) {
          const startTime = new Date(response.metadata.startTime).getTime();
          const endTime = new Date(response.metadata.endTime).getTime();
          processingTime = (endTime - startTime).toString();
        }

        report += `| ${model} | ${processingTime} |`;
        
        // Add each feature's value and confidence
        for (const feature of features) {
          let value = 'N/A';
          let confidence = 'N/A';
          
          if (response) {
            try {
              const parsed = JSON.parse(response.content);
              if (parsed.content && parsed.content[feature]) {
                value = parsed.content[feature].value;
                confidence = parsed.content[feature].confidence?.toFixed(2) ?? 'N/A';
              }
            } catch (e) {
              console.warn(`Failed to parse response for ${image} - ${model}`);
            }
          }

          report += ` ${value}<br/>(${confidence}) |`;
        }
        report += '\n';
      }
      report += '\n\n';
    }

    // Performance summary
    report += '## Performance Summary\n\n';
    report += '| Model | Average Time (ms) | Total Cost |\n';
    report += '|-------|------------------|------------|\n';

    const modelStats = new Map<string, { times: number[], costs: number[] }>();
    this.responses.forEach(r => {
      const model = r.metadata.model;
      if (!modelStats.has(model)) {
        modelStats.set(model, { times: [], costs: [] });
      }
      const stats = modelStats.get(model)!;
      
      // Calculate timing from startTime and endTime
      if (r.metadata.startTime && r.metadata.endTime) {
        const startTime = new Date(r.metadata.startTime).getTime();
        const endTime = new Date(r.metadata.endTime).getTime();
        stats.times.push(endTime - startTime);
      }
      
      // Get total cost from cost object
      if (r.metadata.cost?.totalCost) {
        stats.costs.push(r.metadata.cost.totalCost);
      }
    });

    for (const [model, stats] of modelStats.entries()) {
      const avgTime = stats.times.length 
        ? (stats.times.reduce((a, b) => a + b, 0) / stats.times.length).toFixed(0)
        : 'N/A';
      const totalCost = stats.costs.length
        ? stats.costs.reduce((a, b) => a + b, 0).toFixed(4)
        : 'N/A';
      report += `| ${model} | ${avgTime} | ${totalCost} |\n`;
    }

    return report;
  }

  async generateHtmlReport(options: Record<string, unknown>): Promise<string> {
    const responsesDir = path.join(process.cwd(), 'output/evaluations', evaluationId);
    this.responses = this.loadResponses(responsesDir);
    let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Image Feature Extraction Results</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  @media print {
    body {
      font-size: 10pt;
    }
    table {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
    }
    th, td {
      border: 1px solid #ddd !important; /* Ensure borders are visible */
      padding: 4px !important;
      overflow-wrap: break-word; /* Force long text to wrap */
    }
    .description-cell {
        white-space: pre-wrap; /* Respect whitespace and wrap */
        word-break: break-all; /* More aggressive wrapping if needed */
    }
    .image-section {
      page-break-after: always;
    }
    img {
      max-width: 100% !important; /* Ensure images scale down */
      height: auto;
    }
  }
</style>
</head>
<body class="bg-gray-100 text-gray-800 font-sans p-8 print:bg-white print:text-black">
  <div class="container mx-auto">
    <h1 class="text-4xl font-bold mb-2">Image Feature Extraction Results</h1>
    <p class="text-gray-600 mb-8">Generated: ${new Date().toLocaleString()}</p>
`;

    const images = Array.from(new Set(this.responses.map(r => path.basename((r.metadata as any).filename))));
    
    // Navigation
    html += `<div class="nav mb-8 p-4 bg-white rounded-lg shadow print:hidden">Jump to: ` + images.map(img => `<a href='#img-${img}' class="text-blue-500 hover:underline mr-4">${img}</a>`).join('') + `</div>`;

    const modelNames = Array.from(new Set(this.responses.map(r => r.metadata.model)));
    const features = Object.keys(ImageFeatureSchema.shape);

    for (const image of images) {
      html += `<div class='image-section bg-white rounded-lg shadow-md p-6 mb-12 print:shadow-none print:p-0 print:mb-8 break-after-page' id='img-${image}'>`;
      html += `<h2 class="text-2xl font-semibold mb-4">${image}</h2>`;
      html += `<div class="mb-6">
                 <img src='../../../../input/images/${image}' alt='${image}' class="w-full h-auto max-w-2xl mx-auto rounded-md shadow-lg print:shadow-none" />
               </div>`;
      html += `<div class="overflow-x-auto">
                 <table class="w-full text-left border-collapse">
                   <thead>
                     <tr class="bg-gray-200">
                       <th class="p-2 border border-gray-300">Model</th>
                       <th class="p-2 border border-gray-300">Time (ms)</th>`;
      for (const feature of features) {
        html += `<th class="p-2 border border-gray-300 capitalize">${feature.replace(/_/g, ' ')}</th>`;
      }
      html += `</tr></thead><tbody>`;
      
      let stripe = true;
      for (const model of modelNames) {
        const response = this.responses.find(r => path.basename((r.metadata as any).filename) === image && r.metadata.model === model);
        const rowClass = stripe ? 'bg-gray-50' : 'bg-white';
        html += `<tr class="${rowClass}"><td class='p-2 border border-gray-300 font-semibold'>${model}</td>`;

        let processingTime = 'N/A';
        if (response?.metadata.startTime && response?.metadata.endTime) {
          const startTime = new Date(response.metadata.startTime).getTime();
          const endTime = new Date(response.metadata.endTime).getTime();
          processingTime = (endTime - startTime).toString();
        }
        html += `<td class="p-2 border border-gray-300">${processingTime}</td>`;

        for (const feature of features) {
          let value = '<span class="text-gray-400">N/A</span>';
          let confidence = '';
          if (response) {
            try {
              const parsed = JSON.parse(response.content);
              if (parsed.content && parsed.content[feature]) {
                const featureValue = parsed.content[feature].value;
                if (feature === 'image_description' && typeof featureValue === 'string') {
                    value = `<div class="max-h-32 overflow-y-auto text-sm print:max-h-none print:overflow-visible description-cell">${featureValue}</div>`;
                } else {
                    value = `<span class="font-medium">${featureValue}</span>`;
                }
                confidence = parsed.content[feature].confidence !== undefined ? `<span class='text-xs text-gray-500'>(conf: ${parsed.content[feature].confidence.toFixed(2)})</span>` : '';
              }
            } catch (e) {
              value = '<span class="text-red-500 font-semibold">Parse error</span>';
            }
          }
          html += `<td class='p-2 border border-gray-300 align-top'>${value} <br/> ${confidence}</td>`;
        }
        html += `</tr>`;
        stripe = !stripe;
      }
      html += `</tbody></table></div></div>`;
    }
    html += `</div></body></html>`;
    return html;
  }
}

async function generateReport() {
  console.log('Generating reports...');
  const reporter = new ImageFeatureReporter(evaluationId);
  const report = await reporter.generateReport({});
  const html = await reporter.generateHtmlReport({});
  // Save the report
  const reportsDir = path.join(process.cwd(), 'output/evaluations', evaluationId, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, 'results.md'), report);
  fs.writeFileSync(path.join(reportsDir, 'results.html'), html);
  console.log(`Report saved to ${path.join(reportsDir, 'results.md')}`);
  console.log(`HTML report saved to ${path.join(reportsDir, 'results.html')}`);
}

// --- CLI Entry Point ---
const mode = process.argv[2] as 'extract' | 'score' | 'report' | undefined;

async function main() {
  switch (mode) {
    case 'extract':
      await batchExtract();
      console.log('Batch extraction complete.');
      break;
    case 'score':
      await scoreResults();
      break;
    case 'report':
      await generateReport();
      break;
    default:
      console.log('Usage: pnpm run image-feature-batch [extract|score|report]');
      console.log('  extract: Run feature extraction on all images');
      console.log('  score: Score the results against ground truth');
      console.log('  report: Generate results report');
  }
}

main().catch(console.error); 