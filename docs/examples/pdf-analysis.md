# PDF Analysis Examples

This example demonstrates how to analyze PDF documents using Umwelten's vision-capable models. These examples correspond to the migrated `pdf-identify.ts` and `pdf-parsing.ts` scripts, showing how to test native PDF parsing capabilities across different models.

## Basic PDF Analysis

### Document Type Identification (pdf-identify.ts equivalent)

Test how well models can identify and categorize PDF documents:

```bash
npx umwelten eval run \
  --prompt "Identify the type of document, key sections, and summarize the main content of this PDF. Include document structure, purpose, and target audience." \
  --models "google:gemini-2.0-flash,google:gemini-1.5-flash-8b" \
  --id "pdf-identify-test" \
  --attach "./documents/sample-document.pdf" \
  --concurrent
```

### Comprehensive PDF Parsing (pdf-parsing.ts equivalent)

Test native PDF parsing and information extraction capabilities:

```bash
npx umwelten eval run \
  --prompt "Analyze this PDF document and extract key information, including document type, main topics, structured data, and any notable formatting or visual elements" \
  --models "google:gemini-2.0-flash,google:gemini-2.5-pro-exp-03-25" \
  --id "pdf-parsing-test" \
  --attach "./documents/test-document.pdf"
```

### Multi-Document Analysis

Compare how models handle different types of PDF documents:

```bash
npx umwelten eval run \
  --prompt "Analyze this document and categorize it as one of: research paper, business report, legal document, technical manual, financial statement, or other. Explain your reasoning and extract key metadata." \
  --models "google:gemini-2.0-flash,google:gemini-1.5-flash-8b,google:gemini-2.5-flash" \
  --id "pdf-categorization" \
  --attach "./documents/mystery-document.pdf" \
  --concurrent
```

## Advanced PDF Processing

### Structured Data Extraction

Extract specific information with structured output:

```bash
npx umwelten eval run \
  --prompt "Extract structured information from this PDF document" \
  --models "google:gemini-2.0-flash,google:gemini-2.5-pro-exp-03-25" \
  --id "pdf-structured-extract" \
  --attach "./documents/business-report.pdf" \
  --schema "title, document_type, date, author, key_findings array, recommendations array, page_count int" \
  --validate-output
```

### Scientific Paper Analysis

Specialized analysis for research documents:

```bash
npx umwelten eval run \
  --prompt "Analyze this research paper and extract: title, authors, abstract, research methodology, key findings, conclusions, and citation information. Also identify the research field and assess the paper's significance." \
  --models "google:gemini-2.5-pro-exp-03-25,google:gemini-2.0-flash" \
  --id "research-paper-analysis" \
  --attach "./papers/research-paper.pdf" \
  --system "You are a research analyst who specializes in academic literature review and scientific paper evaluation" \
  --concurrent
```

### Financial Document Processing

Extract financial information from reports:

```bash
npx umwelten eval run \
  --prompt "Analyze this financial document and extract key financial metrics, trends, and insights. Include revenue, expenses, profit margins, and any forward-looking statements." \
  --models "google:gemini-2.0-flash" \
  --id "financial-analysis" \
  --attach "./finance/quarterly-report.pdf" \
  --system "You are a financial analyst with expertise in corporate financial statements and business performance analysis"
```

### Legal Document Review

Analyze legal documents and contracts:

```bash
npx umwelten eval run \
  --prompt "Review this legal document and identify: document type, parties involved, key terms and conditions, obligations, deadlines, and any potential areas of concern or ambiguity." \
  --models "google:gemini-2.5-pro-exp-03-25" \
  --id "legal-document-review" \
  --attach "./legal/contract.pdf" \
  --system "You are a legal analyst who reviews contracts and legal documents for key terms and potential issues" \
  --temperature 0.2
```

## Batch PDF Processing

### Process Multiple PDFs

Analyze multiple documents in a batch:

```bash
npx umwelten eval batch \
  --prompt "Analyze this PDF document and provide a comprehensive summary including document type, key topics, and main conclusions" \
  --models "google:gemini-2.0-flash,google:gemini-1.5-flash-8b" \
  --id "pdf-batch-analysis" \
  --directory "./documents/incoming" \
  --file-pattern "*.pdf" \
  --concurrent \
  --max-concurrency 3
```

### Document Classification Pipeline

Classify and organize document libraries:

```bash
npx umwelten eval batch \
  --prompt "Classify this document and extract metadata for cataloging" \
  --models "google:gemini-2.0-flash" \
  --id "document-classification" \
  --directory "./document-library" \
  --file-pattern "*.pdf" \
  --schema "category, title, author, date, subject_tags array, confidence_score int: 1-10" \
  --concurrent \
  --file-limit 50
```

## Interactive PDF Analysis

### Real-time Document Processing

Watch document analysis in real-time:

```bash
npx umwelten eval run \
  --prompt "Perform a detailed content analysis of this PDF, including structure, key arguments, evidence presented, and overall quality assessment" \
  --models "google:gemini-2.5-pro-exp-03-25,google:gemini-2.0-flash" \
  --id "detailed-pdf-analysis" \
  --attach "./documents/complex-report.pdf" \
  --ui \
  --concurrent
```

## Expected Output Examples

### PDF Identification Results

**Research Paper Identification:**
```
Document Type: Academic Research Paper
Field: Computer Science - Machine Learning
Structure Analysis:
- Title and author information at top
- Abstract section (150-200 words)
- Introduction with literature review
- Methodology section with experimental design
- Results with tables and graphs
- Discussion and conclusion sections
- References (40+ citations)

Key Indicators:
- IEEE conference format
- Mathematical equations and algorithms
- Experimental results with statistical analysis
- Academic citation style
- Technical terminology throughout

Target Audience: Researchers and practitioners in machine learning
Estimated Reading Time: 45-60 minutes
Complexity Level: Advanced/Expert
```

**Business Report Identification:**
```
Document Type: Quarterly Business Report
Company: [Company Name]
Reporting Period: Q3 2024

Document Structure:
- Executive summary (2 pages)
- Financial highlights with charts
- Market analysis section
- Operational performance metrics
- Risk assessment
- Forward-looking statements

Key Sections Identified:
- Revenue: $45.2M (15% growth)
- Customer acquisition metrics
- Market expansion initiatives
- Competitive analysis
- Strategic priorities for next quarter

Target Audience: Investors, stakeholders, executives
Document Quality: Professional, well-formatted
Visual Elements: 12 charts/graphs, branded formatting
```

### Structured Data Extraction

**JSON Schema Output:**
```json
{
  "title": "Quarterly Financial Report Q3 2024",
  "document_type": "financial_report",
  "date": "2024-10-15",
  "author": "CFO Financial Team",
  "key_findings": [
    "Revenue growth of 15% year-over-year",
    "Customer retention rate improved to 94%",
    "Operating margin increased by 3.2%",
    "Market share expanded in key segments"
  ],
  "recommendations": [
    "Continue investment in customer acquisition",
    "Expand operations in emerging markets",
    "Optimize supply chain for better margins",
    "Increase R&D spending for innovation"
  ],
  "page_count": 24
}
```

## Performance Comparison Report

### PDF Analysis Capabilities

```markdown
# PDF Analysis Report: pdf-parsing-test

**Generated:** 2025-01-27T22:00:00.000Z  
**Document Type:** Technical Manual (PDF)
**Total Models:** 2

| Model | Provider | Analysis Depth | Text Extraction | Time (ms) | Cost |
|-------|----------|----------------|-----------------|-----------|------|
| gemini-2.5-pro-exp-03-25 | google | Excellent | 98% accurate | 5400 | $0.000245 |
| gemini-2.0-flash | google | Very Good | 95% accurate | 3200 | $0.000089 |

## PDF Processing Capabilities

### Text Recognition (OCR)
- **Gemini 2.5 Pro**: Superior handling of complex layouts and formatting
- **Gemini 2.0 Flash**: Excellent for standard documents, occasional issues with tables
- Both models: Strong performance on standard fonts and clear text

### Structure Understanding  
- **Document Hierarchy**: Both models accurately identified sections and subsections
- **Visual Elements**: Good recognition of charts, diagrams, and images
- **Formatting**: Preserved important formatting context in analysis

### Content Extraction Quality
- **Main Content**: 95%+ accuracy for body text
- **Tables/Data**: 85-90% accuracy for structured data
- **Headers/Footers**: Consistent recognition and appropriate handling
- **Page Numbers**: Correctly identified and referenced

### Language Support
- English: Excellent (both models)
- Multi-language: Gemini 2.5 Pro handles mixed languages better
- Technical Terms: Strong recognition of domain-specific vocabulary

## Error Analysis
- **Rare OCR Errors**: Mainly on poor quality scans or unusual fonts
- **Layout Issues**: Occasional problems with multi-column layouts
- **Image Text**: Variable success with text embedded in images
- **Handwriting**: Limited capability (not primary use case)

## Cost Analysis
- **Gemini 2.5 Pro**: $0.000245 per document (comprehensive analysis)
- **Gemini 2.0 Flash**: $0.000089 per document (fast analysis)  
- **ROI**: High value for document digitization and analysis workflows
```

## Model Capabilities Comparison

| Feature | Gemini 2.5 Pro | Gemini 2.0 Flash | Gemini 1.5 Flash 8B |
|---------|----------------|------------------|---------------------|
| Text Extraction | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Structure Analysis | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Table Processing | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| Complex Layouts | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| Speed | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Cost | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

## Use Cases by Document Type

### Academic Papers
- **Best Model**: Gemini 2.5 Pro (handles complex formatting, equations)
- **Use Case**: Literature review, citation extraction, research analysis
- **Accuracy**: 95%+ for standard academic formats

### Business Reports
- **Best Model**: Gemini 2.0 Flash (good balance of speed and accuracy)
- **Use Case**: Executive summaries, financial data extraction
- **Accuracy**: 90%+ for standard business formats

### Legal Documents
- **Best Model**: Gemini 2.5 Pro (handles complex legal language)
- **Use Case**: Contract analysis, regulatory compliance
- **Accuracy**: 92%+ with careful prompt engineering

### Technical Manuals
- **Best Model**: Gemini 2.0 Flash (good with diagrams and procedures)
- **Use Case**: Process documentation, troubleshooting guides
- **Accuracy**: 88%+ for technical content

## Tips for Effective PDF Analysis

### Document Preparation
- **Quality Matters**: Higher resolution PDFs yield better results
- **Format Considerations**: Text-based PDFs work better than scanned images  
- **File Size**: Large files may need timeout adjustments
- **Language**: Clearly specify the document language in prompts

### Prompt Engineering
- Be specific about what information to extract
- Mention document type if known (research paper, contract, etc.)
- Request structured output for consistent data extraction
- Include examples of desired output format

### Model Selection Guidelines
- **Gemini 2.5 Pro**: Complex documents, high accuracy requirements
- **Gemini 2.0 Flash**: Standard documents, balanced performance
- **Gemini 1.5 Flash 8B**: Simple documents, cost optimization
- **Multiple Models**: Validation and comparison of results

### Error Handling
- Set appropriate timeouts for large documents (30-60 seconds)
- Use `--resume` for batch processing of large document sets
- Validate structured output with schemas
- Consider manual review for critical documents

## Common PDF Analysis Patterns

### Document Triage
```bash
# Quick classification for large document sets
npx umwelten eval batch \
  --prompt "Classify this document: urgent/important/routine/archive" \
  --models "google:gemini-2.0-flash" \
  --schema "priority, category, confidence int" \
  --directory "./inbox" --file-pattern "*.pdf"
```

### Content Summarization
```bash
# Executive summaries for long documents
npx umwelten eval run \
  --prompt "Create a 200-word executive summary of this document" \
  --models "google:gemini-2.0-flash" \
  --attach "./reports/long-report.pdf"
```

### Data Mining
```bash
# Extract specific data points across documents
npx umwelten eval batch \
  --prompt "Extract all dates, dollar amounts, and key metrics" \
  --schema "dates array, amounts array, metrics array" \
  --directory "./financial" --file-pattern "*.pdf"
```

## Next Steps

- Try [batch processing](/examples/batch-processing) for large document sets
- Explore [structured output](/examples/structured-output) for data extraction
- See [cost optimization](/examples/cost-optimization) for efficient document processing
- Review [multi-format documents](/examples/multi-format) for mixed media analysis