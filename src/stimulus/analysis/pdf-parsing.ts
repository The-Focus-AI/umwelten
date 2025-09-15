import { Stimulus } from '../../stimulus/stimulus.js';

/**
 * PDF Parsing Stimulus
 * 
 * Tests models' ability to parse and analyze PDF document content.
 * This evaluates:
 * - Document content comprehension
 * - Information extraction capabilities
 * - Structured data processing
 * - Critical thinking and summarization
 */
export const PDFParsingStimulus = new Stimulus({
  id: 'pdf-parsing',
  name: 'PDF Document Parsing',
  description: 'Test models\' ability to parse and analyze PDF document content',
  
  role: "expert document analyst",
  objective: "analyze PDF documents and extract structured information",
  instructions: [
    "Analyze the PDF document thoroughly",
    "Extract key information and main points",
    "Provide detailed summaries with confidence levels",
    "Identify document type and purpose"
  ],
  output: [
    "Detailed document summary",
    "Key points and arguments",
    "Document type classification",
    "Confidence scores for analysis"
  ],
  examples: [
    "Example: Parse a research paper and extract the abstract, methodology, and key findings"
  ],
  temperature: 0.3, // Lower temperature for more consistent analysis
  maxTokens: 2000,
  runnerType: 'base'
});

/**
 * PDF Financial Document Parsing Stimulus
 */
export const PDFFinancialParsingStimulus = new Stimulus({
  id: 'pdf-financial-parsing',
  name: 'PDF Financial Document Parsing',
  description: 'Test models\' ability to parse financial documents and extract financial data',
  
  role: "financial analyst and document reviewer",
  objective: "parse financial documents and extract key financial information",
  instructions: [
    "Analyze financial documents (reports, statements, invoices)",
    "Extract key financial metrics and data points",
    "Identify trends, patterns, and anomalies",
    "Provide financial insights and analysis"
  ],
  output: [
    "Financial summary and key metrics",
    "Revenue, expenses, and profit analysis",
    "Trends and patterns identified",
    "Financial insights and recommendations"
  ],
  examples: [
    "Example: Parse a quarterly financial report and extract revenue, expenses, and growth trends"
  ],
  temperature: 0.2, // Very low temperature for precise financial analysis
  maxTokens: 1500,
  runnerType: 'base'
});

/**
 * PDF Legal Document Parsing Stimulus
 */
export const PDFLegalParsingStimulus = new Stimulus({
  id: 'pdf-legal-parsing',
  name: 'PDF Legal Document Parsing',
  description: 'Test models\' ability to parse legal documents and extract legal information',
  
  role: "legal document analyst",
  objective: "parse legal documents and extract key legal information",
  instructions: [
    "Analyze legal documents (contracts, agreements, policies)",
    "Extract key legal terms, clauses, and obligations",
    "Identify important dates, parties, and conditions",
    "Summarize legal implications and requirements"
  ],
  output: [
    "Legal document summary",
    "Key terms and clauses",
    "Parties and obligations",
    "Legal implications and requirements"
  ],
  examples: [
    "Example: Parse a service agreement and extract key terms, payment conditions, and termination clauses"
  ],
  temperature: 0.2, // Low temperature for precise legal analysis
  maxTokens: 1500,
  runnerType: 'base'
});

/**
 * PDF Research Paper Parsing Stimulus
 */
export const PDFResearchParsingStimulus = new Stimulus({
  id: 'pdf-research-parsing',
  name: 'PDF Research Paper Parsing',
  description: 'Test models\' ability to parse academic research papers',
  
  role: "research analyst and academic reviewer",
  objective: "parse research papers and extract academic information",
  instructions: [
    "Analyze academic research papers thoroughly",
    "Extract research questions, methodology, and findings",
    "Identify key contributions and limitations",
    "Provide critical analysis and evaluation"
  ],
  output: [
    "Research summary and methodology",
    "Key findings and results",
    "Contributions and limitations",
    "Critical analysis and evaluation"
  ],
  examples: [
    "Example: Parse a machine learning research paper and extract the problem statement, methodology, and contributions"
  ],
  temperature: 0.3,
  maxTokens: 2000,
  runnerType: 'base'
});

/**
 * PDF Technical Manual Parsing Stimulus
 */
export const PDFTechnicalParsingStimulus = new Stimulus({
  id: 'pdf-technical-parsing',
  name: 'PDF Technical Manual Parsing',
  description: 'Test models\' ability to parse technical documents and extract technical information',
  
  role: "technical documentation specialist",
  objective: "parse technical documents and extract technical information",
  instructions: [
    "Analyze technical documents (manuals, guides, specifications)",
    "Extract technical specifications and procedures",
    "Identify key concepts and terminology",
    "Provide technical insights and recommendations"
  ],
  output: [
    "Technical summary and key concepts",
    "Specifications and procedures",
    "Technical terminology and definitions",
    "Technical insights and recommendations"
  ],
  examples: [
    "Example: Parse a software API documentation and extract key methods, parameters, and usage examples"
  ],
  temperature: 0.3,
  maxTokens: 1500,
  runnerType: 'base'
});
