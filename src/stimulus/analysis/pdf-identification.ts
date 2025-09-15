import { Stimulus } from '../../stimulus/stimulus.js';

/**
 * PDF Identification Stimulus
 * 
 * Tests models' ability to identify and extract metadata from PDF documents.
 * This evaluates:
 * - Document metadata extraction
 * - Bibliographic information identification
 * - Document type classification
 * - Confidence assessment capabilities
 */
export const PDFIdentificationStimulus = new Stimulus({
  id: 'pdf-identification',
  name: 'PDF Document Identification',
  description: 'Test models\' ability to identify and extract metadata from PDF documents',
  
  role: "expert document identifier and bibliographer",
  objective: "extract bibliographic metadata from PDF documents",
  instructions: [
    "Analyze the PDF document thoroughly",
    "Extract title, author(s), and document type",
    "Assess confidence levels for each extraction",
    "Focus on bibliographic elements rather than content analysis"
  ],
  output: [
    "Document title extraction",
    "Author identification",
    "Document type classification",
    "Confidence scores for each element"
  ],
  examples: [
    "Example: Extract title, authors, and document type from a research paper PDF"
  ],
  temperature: 0.2, // Low temperature for precise metadata extraction
  maxTokens: 1000,
  runnerType: 'base'
});

/**
 * PDF Academic Paper Identification Stimulus
 */
export const PDFAcademicIdentificationStimulus = new Stimulus({
  id: 'pdf-academic-identification',
  name: 'PDF Academic Paper Identification',
  description: 'Test models\' ability to identify academic papers and extract scholarly metadata',
  
  role: "academic librarian and scholarly communication expert",
  objective: "identify and extract metadata from academic papers",
  instructions: [
    "Identify academic paper characteristics",
    "Extract publication details (journal, conference, etc.)",
    "Identify authors and affiliations",
    "Classify paper type (research, review, case study, etc.)"
  ],
  output: [
    "Paper title and abstract",
    "Authors and affiliations",
    "Publication venue and date",
    "Paper type and research area"
  ],
  examples: [
    "Example: Identify a machine learning research paper and extract all scholarly metadata"
  ],
  temperature: 0.2,
  maxTokens: 1200,
  runnerType: 'base'
});

/**
 * PDF Legal Document Identification Stimulus
 */
export const PDFLegalIdentificationStimulus = new Stimulus({
  id: 'pdf-legal-identification',
  name: 'PDF Legal Document Identification',
  description: 'Test models\' ability to identify legal documents and extract legal metadata',
  
  role: "legal document analyst and paralegal",
  objective: "identify and extract metadata from legal documents",
  instructions: [
    "Identify legal document types (contracts, briefs, etc.)",
    "Extract parties involved and their roles",
    "Identify important dates and deadlines",
    "Classify document by legal category"
  ],
  output: [
    "Document type and legal nature",
    "Parties involved and their roles",
    "Important dates and deadlines",
    "Legal category and jurisdiction"
  ],
  examples: [
    "Example: Identify a service agreement and extract all relevant legal metadata"
  ],
  temperature: 0.2,
  maxTokens: 1000,
  runnerType: 'base'
});

/**
 * PDF Technical Manual Identification Stimulus
 */
export const PDFTechnicalIdentificationStimulus = new Stimulus({
  id: 'pdf-technical-identification',
  name: 'PDF Technical Manual Identification',
  description: 'Test models\' ability to identify technical documents and extract technical metadata',
  
  role: "technical documentation specialist",
  objective: "identify and extract metadata from technical documents",
  instructions: [
    "Identify technical document types (manuals, guides, specs)",
    "Extract product or system information",
    "Identify version numbers and revision dates",
    "Classify by technical domain"
  ],
  output: [
    "Document type and technical nature",
    "Product or system identification",
    "Version and revision information",
    "Technical domain classification"
  ],
  examples: [
    "Example: Identify a software user manual and extract all technical metadata"
  ],
  temperature: 0.2,
  maxTokens: 1000,
  runnerType: 'base'
});
