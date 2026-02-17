# Multi-Language Processing

Process content in multiple languages with language detection, translation, and cross-lingual analysis. This example demonstrates working with international content using AI models with strong multilingual capabilities.

## Overview

Multi-language processing enables you to work with content in various languages, perform translations, detect languages automatically, and conduct cross-lingual analysis. Modern AI models excel at understanding and generating content across dozens of languages.

## Language Detection and Analysis

### Automatic Language Detection

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Detect the language of this content and provide a confidence score" \
  --models "google:gemini-3-flash-preview,ollama:gemma3:12b" \
  --id "language-detection" \
  --directory "./multilingual-content" \
  --file-pattern "*.{txt,pdf}" \
  --schema "detected_language, confidence int: 1-10, secondary_languages array" \
  --concurrent
```

### Language-Specific Analysis

```bash
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Analyze this text in its original language, then provide an English summary" \
  --models "google:gemini-3-flash-preview" \
  --file "./spanish-document.pdf" \
  --id "spanish-analysis"

dotenvx run -- pnpm run cli -- eval run \
  --prompt "この日本語の文書を分析し、英語で要約してください" \
  --models "google:gemini-3-flash-preview" \
  --file "./japanese-text.txt" \
  --id "japanese-analysis"
```

## Translation Services

### Document Translation

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Translate this document to English while preserving formatting and context" \
  --models "google:gemini-3-flash-preview,openrouter:openai/gpt-4o" \
  --id "document-translation" \
  --directory "./foreign-documents" \
  --file-pattern "*.{pdf,txt}" \
  --concurrent
```

### Multi-Target Translation

```bash
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Translate this English text to Spanish, French, German, and Japanese" \
  --models "google:gemini-3-flash-preview" \
  --id "multi-target-translation" \
  --schema "spanish, french, german, japanese"
```

### Context-Aware Translation

```bash
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Translate this technical document to English, preserving technical terminology and context" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --file "./technical-manual-german.pdf" \
  --timeout 60000 \
  --id "technical-translation"
```

## Cross-Lingual Content Analysis

### Sentiment Analysis Across Languages

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Analyze the sentiment of this content regardless of language and provide reasoning" \
  --models "google:gemini-3-flash-preview" \
  --id "multilingual-sentiment" \
  --directory "./reviews-international" \
  --file-pattern "*.txt" \
  --schema "sentiment, confidence int: 1-10, detected_language, reasoning" \
  --concurrent
```

### Cultural Context Analysis

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Analyze this content for cultural references, idioms, and context that might not translate directly" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "cultural-analysis" \
  --directory "./cultural-content" \
  --file-pattern "*.{txt,pdf}" \
  --schema "cultural_elements array, idioms array, translation_challenges array, context_notes" \
  --concurrent
```

## Language-Specific Use Cases

### International Business Documents

```bash
# Process contracts in multiple languages
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Extract key terms, obligations, and dates from this business document" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "international-contracts" \
  --directory "./contracts" \
  --file-pattern "*.pdf" \
  --schema "language, parties array, key_terms array, obligations array, important_dates array" \
  --concurrent
```

### Academic Research Processing  

```bash
# Analyze research papers in various languages
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Extract methodology, findings, and conclusions from this academic paper" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "multilingual-research" \
  --directory "./academic-papers" \
  --file-pattern "*.pdf" \
  --schema "language, title, methodology, key_findings array, conclusions array, citations int" \
  --concurrent
```

### News and Media Analysis

```bash
# Analyze international news articles
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Summarize this news article and identify key events, people, and implications" \
  --models "google:gemini-3-flash-preview" \
  --id "international-news" \
  --directory "./news-articles" \
  --file-pattern "*.{txt,pdf}" \
  --schema "language, headline, key_events array, people_mentioned array, implications array" \
  --concurrent
```

## Advanced Multilingual Workflows

### Translation Quality Assessment

```bash
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Compare these two translations of the same source text and assess quality, accuracy, and fluency" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --file "./translation-comparison.txt" \
  --schema "better_translation, accuracy_score int: 1-10, fluency_score int: 1-10, issues array" \
  --id "translation-qa"
```

### Code Comment Translation

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Translate code comments to English while preserving technical accuracy" \
  --models "ollama:codestral:latest,google:gemini-3-flash-preview" \
  --id "code-translation" \
  --directory "./international-code" \
  --file-pattern "*.{py,js,java,cpp}" \
  --concurrent
```

### Multilingual Customer Support

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Analyze this customer inquiry and provide response in the same language" \
  --models "google:gemini-3-flash-preview" \
  --id "multilingual-support" \
  --directory "./customer-inquiries" \
  --file-pattern "*.txt" \
  --schema "detected_language, inquiry_type, urgency int: 1-5, suggested_response" \
  --concurrent
```

## Language-Specific Model Performance

### Model Comparison by Language

```bash
# Test different models on the same multilingual content
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Summarize this content in English" \
  --models "google:gemini-3-flash-preview,google:gemini-2.5-pro-exp-03-25,openrouter:openai/gpt-4o" \
  --file "./chinese-article.txt" \
  --id "chinese-model-comparison" \
  --concurrent
```

### Language Coverage Testing

```bash
# Test model performance across different languages
for lang in spanish french german japanese chinese arabic; do
  dotenvx run -- pnpm run cli -- eval run \
    --prompt "Analyze this ${lang} text and provide insights in English" \
    --models "google:gemini-3-flash-preview" \
    --file "./${lang}-sample.txt" \
    --id "${lang}-processing-test"
done
```

## Structured Multilingual Output

### Consistent Cross-Language Schema

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Extract structured information from this document regardless of language" \
  --models "google:gemini-3-flash-preview" \
  --id "multilingual-extraction" \
  --directory "./international-documents" \
  --file-pattern "*.pdf" \
  --schema "source_language, title, summary, key_points array, document_type, confidence int: 1-10" \
  --concurrent
```

### Language Metadata Enrichment

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Analyze this content and provide detailed language metadata" \
  --models "google:gemini-3-flash-preview" \
  --id "language-metadata" \
  --directory "./texts" \
  --file-pattern "*.txt" \
  --schema "primary_language, secondary_languages array, dialect, formality_level int: 1-5, technical_level int: 1-5" \
  --concurrent
```

## Interactive Multilingual Chat

### Language-Adaptive Chat

```bash
# Start multilingual chat session
dotenvx run -- pnpm run cli -- chat --provider google --model gemini-3-flash-preview

# Within chat:
> "Please respond in Spanish: ¿Cómo está el clima hoy?"
> "Now switch to French: Comment allez-vous?"
> "Respond in Japanese: こんにちは、元気ですか？"
```

### Translation Chat Assistant

```bash
dotenvx run -- pnpm run cli -- chat \
  --provider google \
  --model gemini-3-flash-preview \
  --system "You are a professional translator. Help users translate text between languages while preserving meaning and context."
```

## Performance and Cost Optimization

### Model Selection for Languages

| Language Family | Recommended Model | Notes |
|----------------|------------------|-------|
| European Languages | google:gemini-3-flash-preview | Excellent coverage, cost-effective |
| East Asian Languages | google:gemini-2.5-pro | Better handling of complex scripts |
| Arabic/Hebrew | google:gemini-3-flash-preview | Strong RTL language support |
| Programming Languages | ollama:codestral:latest | Code context preservation |
| Technical Translation | openrouter:openai/gpt-4o | Highest accuracy for specialized content |

### Batch Processing by Language

```bash
# Group by language family for efficiency
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Process European language content" \
  --models "google:gemini-3-flash-preview" \
  --directory "./european-texts" \
  --file-pattern "*{en,es,fr,de,it}*.txt" \
  --concurrent

dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Process Asian language content" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --directory "./asian-texts" \
  --file-pattern "*{zh,ja,ko}*.txt" \
  --concurrent
```

## Real-World Examples

### International Legal Documents

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Extract legal obligations and key clauses from this document" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "legal-multilingual" \
  --directory "./legal-docs" \
  --file-pattern "*.pdf" \
  --schema "language, document_type, parties array, obligations array, key_clauses array, jurisdiction" \
  --timeout 90000 \
  --concurrent
```

### E-commerce Product Descriptions

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Translate this product description to English and extract key product features" \
  --models "google:gemini-3-flash-preview" \
  --id "product-translation" \
  --directory "./product-descriptions" \
  --file-pattern "*.txt" \
  --schema "source_language, translated_title, translated_description, features array, price_mentioned bool" \
  --concurrent
```

### Social Media Content Analysis

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Analyze sentiment and extract hashtags from this social media content" \
  --models "google:gemini-3-flash-preview" \
  --id "social-multilingual" \
  --directory "./social-posts" \
  --file-pattern "*.txt" \
  --schema "language, sentiment, hashtags array, mentions array, engagement_indicators array" \
  --concurrent
```

## Quality Assurance

### Translation Validation

```bash
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Check this translation for accuracy, fluency, and cultural appropriateness" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --file "./translation-to-check.txt" \
  --schema "accuracy_score int: 1-10, fluency_score int: 1-10, cultural_score int: 1-10, issues array" \
  --id "translation-validation"
```

### Cross-Language Consistency

```bash
dotenvx run -- pnpm run cli -- eval batch \
  --prompt "Ensure consistent terminology and style across these translated documents" \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "consistency-check" \
  --directory "./translated-series" \
  --file-pattern "*.txt" \
  --schema "consistent_terminology bool, style_consistency int: 1-10, inconsistencies array" \
  --concurrent
```

## Output Analysis and Reporting

### Language Distribution Analysis

```bash
# Generate language statistics
dotenvx run -- pnpm run cli -- eval report --id multilingual-extraction --format json | jq '
  .results | 
  group_by(.response.source_language) | 
  map({language: .[0].response.source_language, count: length}) | 
  sort_by(.count) | 
  reverse
'
```

### Translation Quality Metrics

```bash
# Analyze translation quality across different models
dotenvx run -- pnpm run cli -- eval report --id translation-comparison --format csv --output translation-metrics.csv
```

### Cross-Language Report Generation

```bash
# Generate reports in multiple languages
dotenvx run -- pnpm run cli -- eval report --id multilingual-analysis --format markdown --output report-en.md
dotenvx run -- pnpm run cli -- eval run \
  --prompt "Translate this English report to Spanish while preserving structure" \
  --models "google:gemini-3-flash-preview" \
  --file "./report-en.md" \
  --id "spanish-report"
```

## Best Practices

### Language Handling
- **Language Detection**: Always detect language before processing
- **Model Selection**: Choose models with strong multilingual capabilities
- **Context Preservation**: Maintain cultural and contextual nuances
- **Quality Control**: Validate translations and cross-language consistency

### Performance Optimization
- **Batch by Language**: Group similar languages when possible
- **Model Efficiency**: Use cost-effective models for simple tasks
- **Timeout Management**: Allow extra time for complex translations
- **Resource Planning**: Account for increased processing time

### Quality Assurance
- **Native Review**: Have native speakers review critical translations
- **Consistency Checks**: Ensure terminology consistency across documents
- **Cultural Sensitivity**: Be aware of cultural context and appropriateness
- **Accuracy Validation**: Cross-check important translations

## Troubleshooting

### Common Issues

1. **Character Encoding**: Ensure proper UTF-8 encoding for all text files
2. **Right-to-Left Languages**: Some models handle RTL languages differently
3. **Mixed Scripts**: Documents with multiple writing systems may need special handling
4. **Cultural Context**: Idiomatic expressions may not translate directly

### Debug Commands

```bash
# Test language detection
dotenvx run -- pnpm run cli -- run --models "google:gemini-3-flash-preview" "Detect the language: Bonjour, comment allez-vous?"

# Test basic translation  
dotenvx run -- pnpm run cli -- run --models "google:gemini-3-flash-preview" "Translate to English: Hola, ¿cómo estás?"

# Check file encoding
file -i ./multilingual-document.txt
```

## Next Steps

- Explore [structured output](/guide/structured-output) for consistent multilingual data extraction
- Try [batch processing](/guide/batch-processing) for large multilingual document collections
- See [cost analysis](/guide/cost-analysis) for optimizing multilingual processing costs
- Learn about [model evaluation](/guide/model-evaluation) for language-specific model selection