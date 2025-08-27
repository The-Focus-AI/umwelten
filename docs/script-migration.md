# Script Migration Guide

This document outlines how to migrate existing scripts in the `scripts/` directory to use the new CLI system, or identifies what functionality is missing.

## ✅ Fully Migrated Scripts

### cat-poem.ts
**Purpose:** Simple evaluation of cat poem generation across multiple models

**Original Script:**
```typescript
// Evaluates models: gemma3:27b, gemma3:12b, gemini-2.0-flash, gemini-2.5-pro-exp-03-25
// System prompt: "You are a helpful assistant that writes short poems about cats."
// Prompt: "Write a short poem about a cat."
```

**CLI Equivalent:**
```bash
# Replicate the exact evaluation
umwelten eval run \
  --prompt "Write a short poem about a cat" \
  --models "ollama:gemma3:27b,ollama:gemma3:12b,google:gemini-2.0-flash,google:gemini-2.5-pro-exp-03-25" \
  --id "cat-poem" \
  --system "You are a helpful assistant that writes short poems about cats." \
  --temperature 0.5

# Generate report
umwelten eval report --id cat-poem --format markdown
```

**Status:** ✅ Complete - Fully replaceable with CLI

---

### temperature.ts
**Purpose:** Test temperature effects on same model (gemma3:27b) with different temperatures

**Original Script:**
```typescript
// Tests temperatures: 2.0 and 0.5 on gemma3:27b
// Same cat poem prompt
```

**CLI Equivalent:**
```bash
# High temperature test
umwelten eval run \
  --prompt "Write a short poem about a cat" \
  --models "ollama:gemma3:27b" \
  --id "temperature-high" \
  --system "You are a helpful assistant that writes short poems about cats." \
  --temperature 2.0

# Low temperature test  
umwelten eval run \
  --prompt "Write a short poem about a cat" \
  --models "ollama:gemma3:27b" \
  --id "temperature-low" \
  --system "You are a helpful assistant that writes short poems about cats." \
  --temperature 0.5

# Compare results
umwelten eval report --id temperature-high --format markdown
umwelten eval report --id temperature-low --format markdown
```

**Status:** ✅ Complete - Fully replaceable with CLI

---

### google-pricing.ts
**Purpose:** Test Google models for pricing/cost analysis

**CLI Equivalent:**
```bash
# Run evaluation with Google models
umwelten eval run \
  --prompt "Write a detailed analysis of machine learning trends" \
  --models "google:gemini-2.0-flash,google:gemini-2.5-pro-exp-03-25" \
  --id "google-pricing" \
  --temperature 0.3

# Generate report with cost analysis
umwelten eval report --id google-pricing --format markdown
```

**Status:** ✅ Complete - CLI now includes accurate cost calculations

---

### frankenstein.ts
**Purpose:** Literary analysis evaluation across multiple models

**Original Script:**
```typescript
// System prompt: "You are a literary critic that writes about books."
// Prompt: "Who is the monster in Mary Shelley's Frankenstein?"
// Models: gpt-oss:20b, gemma3:27b, gemma3:12b, gemini-2.0-flash, gemini-2.5-flash
```

**CLI Equivalent:**
```bash
# Replicate the exact evaluation
umwelten eval run \
  --prompt "Who is the monster in Mary Shelley's Frankenstein?" \
  --models "ollama:gpt-oss:20b,ollama:gemma3:27b,ollama:gemma3:12b,google:gemini-2.0-flash,google:gemini-2.5-flash" \
  --id "frankenstein" \
  --system "You are a literary critic that writes about books."

# Generate report
umwelten eval report --id frankenstein --format markdown
```

**Status:** ✅ Complete - Fully replaceable with CLI

---

## 🔄 Partially Migrated Scripts

### multi-language-evaluation.ts
**Purpose:** Complete multi-language code generation evaluation pipeline with Docker execution

**Original Features:**
- 5-pass evaluation system
- Code extraction and fixing
- Docker container building and execution
- Cross-language scoring and reporting
- 11 different Ollama models
- Multiple programming languages (TypeScript, Python, etc.)

**Current CLI Support:**
```bash
# PASS 1: Generate responses (✅ Supported)
umwelten eval run \
  --prompt "i need a script that will give me at least 1042 distinct but made up show names. they should be funny and grammatically correct and written in typescript" \
  --models "ollama:gpt-oss:20b,ollama:gemma3:12b,ollama:gemma3:27b,ollama:deepseek-r1:32b,ollama:devstral:24b,ollama:mistral-small3.2:24b,ollama:llama3.2:latest,ollama:qwen3-coder:latest,ollama:codestral:latest,ollama:phi4:latest,ollama:phi4-mini:latest" \
  --id "multi-language-typescript" \
  --concurrent --max-concurrency 5

# Repeat for other languages...
```

**Missing Features:**
- [ ] **Code extraction from responses** - Need CLI command for extracting code blocks
- [ ] **Docker execution** - Need CLI command for building and running Docker containers  
- [ ] **Code scoring/evaluation** - Need CLI command for scoring execution results
- [ ] **Cross-language report generation** - Need specialized report format
- [ ] **Pipeline orchestration** - Need CLI command to run full pipeline

**TODOs:**
- [ ] Add `umwelten eval extract-code` command
- [ ] Add `umwelten eval docker-test` command  
- [ ] Add `umwelten eval score` command
- [ ] Add pipeline orchestration support
- [ ] Add cross-language report templates

---

### roadtrip.ts
**Purpose:** Electric vehicle roadtrip planning with complex structured output

**Original Features:**
- Complex Zod schemas for input and output validation
- Detailed roadtrip planning with charging stops, activities, and timing
- Structured JSON input/output
- Multiple provider testing (Google, OpenRouter, Ollama)

**CLI Equivalent (Basic):**
```bash
# Basic roadtrip planning (✅ Basic functionality supported)
umwelten eval run \
  --prompt 'Plan an electric vehicle roadtrip from Cornwall CT to Jay Peak VT from 2024-05-01 to 2024-05-05, with kids, including scenic stops and national parks. Include charging stops, restaurants, and attractions with detailed timing and distances.' \
  --models "google:gemini-2.0-flash,google:gemini-2.5-pro-exp-03-25,google:gemini-1.5-flash-8b,openrouter:anthropic/claude-3.7-sonnet:thinking,openrouter:openai/o3,ollama:gemma3:12b" \
  --id "roadtrip-cornwall-jay-peak" \
  --system "You are an expert electric vehicle roadtrip planner who creates efficient and safe roadtrips taking into account user preferences and current date information." \
  --concurrent --max-concurrency 3
```

**Missing Features:**
- [ ] **Structured Input Schemas** - Can't pass complex JSON objects as structured input
- [ ] **Output Schema Validation** - No Zod schema validation for responses
- [ ] **Complex Prompt Templates** - No support for Stimulus-based prompt building
- [ ] **Structured Output Parsing** - No automatic parsing of complex structured responses

**TODOs:**
- [ ] Add `--input-schema` flag for complex input validation
- [ ] Add `--output-schema` flag for Zod schema validation  
- [ ] Add prompt template system support
- [ ] Add structured response parsing and validation
- [ ] Add specialized roadtrip planning templates

**Status:** 🔄 Partial - Basic evaluation works, but missing structured I/O

---

## 📋 Complex Scripts Requiring New CLI Features

### image-feature-extract.ts
**Purpose:** Structured extraction of image features using Zod schemas

**Original Features:**
- Complex Zod schema for image analysis
- Structured data extraction (confidence scores, enums)
- Vision model testing

**CLI Equivalent (Basic):**
```bash
# Basic image evaluation (✅ Supported)
umwelten eval run \
  --prompt "Analyze this image and describe its features in detail" \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "image-features" \
  --attach "./path/to/image.jpg"
```

**Missing Features:**
- [ ] **Structured output schemas** - No Zod schema support in CLI
- [ ] **Confidence scoring** - No built-in confidence extraction
- [ ] **Enum validation** - No structured data validation
- [ ] **Batch image processing** - No batch file support

**TODOs:**
- [ ] Add `--schema` flag for structured output
- [ ] Add confidence scoring extraction
- [ ] Add batch file processing support
- [ ] Add structured validation and reporting

---

### image-feature-batch.ts
**Purpose:** Batch processing of multiple images with feature extraction

**CLI Equivalent:**
```bash
# Batch process images with feature extraction (✅ FULLY SUPPORTED)
umwelten eval batch \
  --prompt "Analyze this image and extract features including: able_to_parse (boolean), image_description (string), contain_text (boolean), color_palette (warm/cool/monochrome/earthy/pastel/vibrant/neutral/unknown), aesthetic_style (realistic/cartoon/abstract/clean/vintage/moody/minimalist/unknown), time_of_day (day/night/unknown), scene_type (indoor/outdoor/unknown), people_count (number), dress_style (fancy/casual/unknown). Return as JSON with confidence scores." \
  --models "google:gemini-2.0-flash,ollama:qwen2.5vl:latest" \
  --id "image-feature-batch" \
  --directory "input/images" \
  --file-pattern "*.jpeg" \
  --concurrent \
  --max-concurrency 5

# Generate comprehensive report
umwelten eval report --id image-feature-batch --format markdown
```

**Status:** ✅ **COMPLETE** - CLI batch command fully replaces the script

**Benefits:**
- Same batch processing functionality with better error handling
- Concurrent processing support for faster execution
- Rich reporting with cost analysis and timing
- File pattern matching and directory scanning
- Resume capability for interrupted evaluations
- No need for custom scoring/reporting classes

---

### site-info.ts
**Purpose:** Website analysis and structured data extraction with RSS feed parsing

**Missing Features:**
- [ ] **Web scraping integration** - No URL input support
- [ ] **HTML processing** - No HTML-to-markdown conversion
- [ ] **Structured website analysis** - No specialized web analysis schemas

**TODOs:**
- [ ] Add URL input support to evaluations
- [ ] Add web scraping capabilities
- [ ] Add HTML processing pipeline
- [ ] Add website analysis templates

---

### transcribe.ts
**Purpose:** Audio transcription and analysis

**Missing Features:**
- [ ] **Audio file support** - CLI doesn't support audio attachments
- [ ] **Transcription models** - No audio-specific model support
- [ ] **Audio preprocessing** - No audio format conversion

**TODOs:**
- [ ] Add audio file attachment support
- [ ] Add transcription model integration
- [ ] Add audio preprocessing pipeline

---

### pdf-identify.ts & pdf-parsing.ts
**Purpose:** Test model's native PDF parsing and analysis capabilities

**CLI Equivalent:**
```bash
# Test model's PDF parsing capability (✅ Fully Supported)
umwelten eval run \
  --prompt "Analyze this PDF document and extract key information, including document type, main topics, and any structured data" \
  --models "google:gemini-2.0-flash,google:gemini-2.5-pro-exp-03-25" \
  --id "pdf-parsing-test" \
  --attach "./document.pdf"

# Test PDF identification across multiple models
umwelten eval run \
  --prompt "Identify the type of document, key sections, and summarize the main content of this PDF" \
  --models "google:gemini-2.0-flash,google:gemini-1.5-flash-8b" \
  --id "pdf-identify-test" \
  --attach "./test-document.pdf" \
  --concurrent
```

**Status:** ✅ Complete - CLI fully supports testing model PDF parsing capabilities

**Note:** The goal is to evaluate how well different models can natively parse and understand PDF content, not to preprocess the PDF. The CLI's `--attach` flag passes the raw PDF directly to the model for analysis.

---

## 🔧 Scripts Needing Specialized CLI Commands

### analyze-docker-outputs.ts
**Purpose:** Analysis of Docker execution results from code evaluation

**Missing Features:**
- [ ] **Docker output analysis** - No CLI command for analyzing execution results
- [ ] **Error pattern detection** - No automated error analysis
- [ ] **Performance metrics extraction** - No timing/memory analysis

**TODOs:**
- [ ] Add `umwelten eval analyze-output` command
- [ ] Add error pattern recognition
- [ ] Add performance metrics extraction

---

### test-multi-language.ts
**Purpose:** Comprehensive testing framework for multi-language evaluations

**Missing Features:**
- [ ] **Test framework integration** - No test runner in CLI
- [ ] **Regression testing** - No comparison with previous results
- [ ] **Test reporting** - No specialized test result formats

**TODOs:**
- [ ] Add `umwelten test` command
- [ ] Add regression testing support
- [ ] Add test result reporting

---

## 📈 Migration Priority

### High Priority (Easy Wins)
1. **✅ cat-poem.ts** - Already complete
2. **✅ temperature.ts** - Already complete  
3. **✅ google-pricing.ts** - Already complete
4. **✅ frankenstein.ts** - Already complete
5. **✅ pdf-identify.ts & pdf-parsing.ts** - Complete, tests model's native PDF parsing
6. **🔄 roadtrip.ts** - Complex structured output, needs schema support

### Medium Priority (New CLI Features Needed)
1. **roadtrip.ts** - Add structured input/output schema support
2. **image-feature-extract.ts** - Add structured output support
3. **multi-language-evaluation.ts** - Add pipeline commands

### Low Priority (Complex Integration)
1. **transcribe.ts** - Requires audio support
2. **site-info.ts** - Requires web scraping
3. **analyze-docker-outputs.ts** - Requires Docker integration

## 🎯 Next Steps

### Immediate Actions
1. Test the fully migrated scripts (cat-poem, temperature, google-pricing)
2. Examine remaining simple scripts (roadtrip, frankenstein)
3. Document any missing CLI features found

### CLI Enhancement Roadmap
1. **Structured Output Support** - Add `--schema` flag for Zod schemas
2. **Batch Processing** - Add `--batch-files` or `--directory` support
3. **Pipeline Commands** - Add `extract-code`, `docker-test`, `score` subcommands
4. **Media Support** - Add audio and better PDF processing
5. **Web Integration** - Add URL input and web scraping

### Testing Strategy
1. Run CLI equivalents of migrated scripts
2. Compare outputs with original script results  
3. Identify any feature gaps or quality differences
4. Create integration tests for new CLI features

This migration guide provides a clear roadmap for moving from ad-hoc scripts to a comprehensive CLI system while identifying exactly what functionality still needs to be built.