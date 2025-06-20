# Image Feature Extractor Evaluation Plan

## Context
- **Current Stage:** Scoring and reporting implementation
- **Goal:** Evaluate multiple models (local and foundation) on their ability to extract structured features from images, compare to ground truth, and report accuracy, confidence, timing, and cost.
- **Recent Progress:**
  - Zod schema and prompt are now generated from a single source of truth, including field descriptions and allowed values.
  - `able_to_parse` boolean (with confidence) added to schema and prompt.
  - All enum fields now allow "unknown" as a value.
  - CLI and script logic unified for prompt/attachment handling; debug output added for message inspection.
  - LM Studio provider tested: text generation works, but structured output (function calling) is not supported—manual JSON parsing required.
  - Tests for LM Studio provider added (structured output tests fail as expected, text generation passes).
  - **Image downloads from images.csv and feature extractor implementation are complete.**
  - **StructuredFeatureScorer implemented with ground truth comparison and special handling for 'unknown' values.**
  - **EvaluationReporter class created with support for Markdown tables and summary statistics.**
- **Next Actions:**
  - [X] Write image downloader script
  - [X] Implement feature extraction runner (manual JSON parsing for LM Studio)
  - [X] Implement scoring system (StructuredFeatureScorer)
  - [X] Implement reporting framework (EvaluationReporter)
  - [ ] Generate ground truth template
  - [ ] Complete HTML and CSV report generation
  - [>] **Focus next on:** Generating and filling ground truth data, then running full evaluation cycle

---

## Plan & Checklist

### 1. Download Images from `images.csv`
- [X] Parse `images.csv` for image URLs (and categories if present)
- [X] Download each image to `input/images/<category>/<filename>` (or just `input/images/`)
- [X] Skip download if file already exists

### 2. Define Feature Extraction Schema
- [X] Create a Zod schema for structured output (with descriptions, serialized into prompt):
  - `able_to_parse: { value: boolean, confidence: number }`
  - `contain_text: { value: boolean, confidence: number }`
  - `color_palette: { value: string, confidence: number }`
  - `time_of_day: { value: "day" | "night" | "unknown", confidence: number }`
  - `scene_type: { value: "indoor" | "outdoor" | "unknown", confidence: number }`
  - `people_count: { value: 0 | 1 | 2, confidence: number }`
  - `dress_style: { value: "fancy" | "casual" | "unknown", confidence: number }`

### 3. Manual Ground Truth List
- [ ] Generate a template file (e.g., `input/images/ground_truth.json`) with all image filenames and empty fields
- [ ] Manually fill in actual features for each image

### 4. Implement Feature Extractor
- [X] Write a script/class to:
  - Load each image
  - Send to each model with a prompt for structured extraction
  - Save response as JSON in `output/image-features/<model>/<image>.json`
  - Record timing and cost
  - [X] For LM Studio: parse JSON from text output manually (structured output not supported)

### 5. Model Coverage
- [X] Evaluate with:
  - Local models (LM Studio, Ollama)
  - Foundation models (Google Gemini, OpenAI, etc.)
- [X] Use same schema and prompt for all

### 6. Scoring and Evaluation
- [X] Implement StructuredFeatureScorer:
  - [X] Ground truth loading and validation
  - [X] Feature-by-feature comparison
  - [X] Special handling for 'unknown' values
  - [X] Confidence score incorporation
  - [X] Able_to_parse validation

### 7. Reporting
- [X] Implement EvaluationReporter base class:
  - [X] Response and score loading
  - [X] Markdown table generation
  - [X] Per-feature analysis
  - [X] Model and image aggregation
- [ ] Complete reporting implementations:
  - [X] Markdown tables for feature comparison
  - [ ] HTML report generation
  - [ ] CSV export functionality
  - [ ] Summary statistics computation

---

## Validation Checklist
- [X] All images in `images.csv` are downloaded to `input/images/`
- [X] Feature extraction schema is defined and used (with prompt sync)
- [ ] Manual ground truth file is created and filled
- [X] Extraction runs for all selected models, with timing and cost recorded
- [X] Results are saved as JSON and can be collated
- [X] Scoring system implemented and tested
- [-] Reporting system implemented (Markdown complete, HTML/CSV in progress) 