# How to Write an Evaluation Script

This guide explains how to write evaluation scripts for running data (such as images) through multiple models and comparing their outputs, with a focus on feature extraction. It is based on patterns found in the `scripts/` directory of this project.

---

## 1. Script Structure & CLI Usage
- Each evaluation is a standalone script in `scripts/`, run via CLI (e.g., `pnpm tsx scripts/your-eval.ts`).
- Scripts import model runners, evaluation runners, and types from `src/`.
- Main logic is wrapped in async functions and/or custom classes extending `EvaluationRunner` or `EvaluationScorer`.

## 2. Input/Output Handling
- **Inputs**: Data files (images, PDFs, audio, URLs) are referenced by path or URL.
- **Outputs**: Results are stored in the `output/` directory, with subfolders per evaluation (e.g., `output/image-parsing`).
- **Format**: Each result is saved as a JSON file, one per model/input combination.

## 3. Intermediate Results & Rerun Logic
- The `EvaluationRunner` base class uses a caching mechanism (`getCachedFile`) to check if a result exists before running the model.
- If the output file exists, it is reused; otherwise, the model is run and the result is saved.
- This allows rerunning only missing evaluations by default. To force reruns, clear the relevant output files.

## 4. Collation & Reporting
- Use `getModelResponses()` in the runner/scorer to aggregate all results for further analysis or reporting.
- Scoring and reporting can be handled by custom scorer classes (extending `EvaluationScorer`).
- Main output is JSON, but you can add scripts to generate Markdown, HTML, or CSV reports from the JSON results.

## 5. Step-by-Step: Writing a New Evaluation

### a. Define the Evaluation Goal
- What are you measuring? (e.g., feature extraction accuracy)
- What are the inputs and expected outputs? (define a Zod schema)

### b. Set Up the Script
- Create a new file in `scripts/`, e.g., `image-feature-eval.ts`.
- Import necessary classes: `BaseModelRunner`, `EvaluationRunner`, `ModelDetails`, etc.

### c. Write the Model Invocation Function
```ts
export async function extractFeatures(imagePath: string, model: ModelDetails): Promise<ModelResponse> {
  // Set up prompt/conversation
  // Attach image
  // Run model
  // Return response
}
```

### d. Create a Runner Class
```ts
class FeatureExtractionRunner extends EvaluationRunner {
  constructor(evaluationId: string, imagePath: string) {
    super(evaluationId);
    this.imagePath = imagePath;
  }
  async getModelResponse(details: ModelDetails): Promise<ModelResponse> {
    return extractFeatures(this.imagePath, details);
  }
}
```

### e. Run Evaluations for Each Model
```ts
const runner = new FeatureExtractionRunner('feature-extraction/image1', 'path/to/image1.png');
await runner.evaluate({ name: 'modelA', provider: 'providerA' });
await runner.evaluate({ name: 'modelB', provider: 'providerB' });
```

### f. Intermediate Results and Reruns
- Results are saved in `output/feature-extraction/image1/modelA.json`, etc.
- The runner will skip models that already have results unless you clear the output directory.

### g. Collate and Score Results
```ts
class FeatureScorer extends EvaluationScorer {
  async score() {
    const responses = await this.getModelResponses();
    // Analyze, print tables, or save summary JSON
  }
}
const scorer = new FeatureScorer('feature-extraction/image1');
await scorer.score();
```

### h. Generate Reports
- Write a post-processing script to read the JSON results and generate HTML/Markdown/CSV as needed.

---

## Recommendations for Image Feature Extraction
- **Batch Processing**: Loop over all images and all models, using a unique evaluation ID for each combination.
- **Parallelization**: Consider running evaluations in parallel for speed, but ensure output files don't conflict.
- **Custom Scoring**: Implement a scorer that compares extracted features to ground truth or expected values.
- **Report Generation**: Add a script to convert JSON results into HTML tables or visualizations for easy comparison.

---

For more examples, see the scripts in the `scripts/` directory (e.g., `image-parsing.ts`, `pdf-parsing.ts`, `site-info.ts`). 