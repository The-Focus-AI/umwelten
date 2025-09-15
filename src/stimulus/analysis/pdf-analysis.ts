import { Stimulus } from '../../stimulus/stimulus.js';

/**
 * PDF Analysis Stimulus
 * 
 * Tests models' ability to analyze PDF documents and extract information.
 * This evaluates:
 * - Document comprehension and analysis
 * - Information extraction capabilities
 * - Structured data processing
 * - Critical thinking and summarization
 */
export const PDFAnalysisStimulus = new Stimulus({
  id: 'pdf-analysis',
  name: 'PDF Document Analysis',
  description: 'Test models\' ability to analyze PDF documents and extract structured information',
  
  role: "document analysis expert",
  objective: "analyze PDF documents and extract key information",
  instructions: [
    "Analyze the provided PDF document thoroughly",
    "Extract key information, themes, and important details",
    "Identify the document type, purpose, and main arguments",
    "Provide a structured summary with clear sections"
  ],
  output: [
    "Document type and purpose identification",
    "Key information extraction in structured format",
    "Main themes and arguments summary",
    "Important details and data points",
    "Critical analysis and insights"
  ],
  examples: [
    "Example: Analyze a research paper and extract the abstract, methodology, key findings, and conclusions"
  ],
  temperature: 0.3, // Lower temperature for more consistent analysis
  maxTokens: 2000,
  runnerType: 'base'
});

/**
 * PDF Financial Analysis Stimulus
 */
export const PDFFinancialAnalysisStimulus = new Stimulus({
  id: 'pdf-financial-analysis',
  name: 'PDF Financial Document Analysis',
  description: 'Test models\' ability to analyze financial PDF documents',
  
  role: "financial analyst and document reviewer",
  objective: "analyze financial PDF documents and extract key metrics",
  instructions: [
    "Analyze financial documents (reports, statements, invoices)",
    "Extract key financial metrics and data points",
    "Identify trends, patterns, and anomalies",
    "Provide financial insights and recommendations"
  ],
  output: [
    "Document type and financial period",
    "Key financial metrics and numbers",
    "Revenue, expenses, and profit analysis",
    "Trends and patterns identified",
    "Financial insights and recommendations"
  ],
  examples: [
    "Example: Analyze a quarterly financial report and extract revenue, expenses, profit margins, and growth trends"
  ],
  temperature: 0.2, // Very low temperature for precise financial analysis
  maxTokens: 1500,
  runnerType: 'base'
});

/**
 * PDF Legal Document Analysis Stimulus
 */
export const PDFLegalAnalysisStimulus = new Stimulus({
  id: 'pdf-legal-analysis',
  name: 'PDF Legal Document Analysis',
  description: 'Test models\' ability to analyze legal PDF documents',
  
  role: "legal document analyst",
  objective: "analyze legal documents and extract key legal information",
  instructions: [
    "Analyze legal documents (contracts, agreements, policies)",
    "Extract key legal terms, clauses, and obligations",
    "Identify important dates, parties, and conditions",
    "Summarize legal implications and requirements"
  ],
  output: [
    "Document type and legal nature",
    "Key parties and their roles",
    "Important dates and deadlines",
    "Key legal terms and clauses",
    "Legal implications and requirements summary"
  ],
  examples: [
    "Example: Analyze a service agreement and extract the parties involved, key terms, payment conditions, and termination clauses"
  ],
  temperature: 0.2, // Low temperature for precise legal analysis
  maxTokens: 1800,
  runnerType: 'base'
});

/**
 * PDF Research Paper Analysis Stimulus
 */
export const PDFResearchAnalysisStimulus = new Stimulus({
  id: 'pdf-research-analysis',
  name: 'PDF Research Paper Analysis',
  description: 'Test models\' ability to analyze academic research papers',
  
  role: "research analyst and academic reviewer",
  objective: "analyze research papers and extract academic information",
  instructions: [
    "Analyze academic research papers thoroughly",
    "Extract research questions, methodology, and findings",
    "Identify key contributions and limitations",
    "Provide critical analysis and evaluation"
  ],
  output: [
    "Research title, authors, and publication details",
    "Research question and objectives",
    "Methodology and approach used",
    "Key findings and results",
    "Contributions and limitations",
    "Critical analysis and evaluation"
  ],
  examples: [
    "Example: Analyze a machine learning research paper and extract the problem statement, methodology, experimental results, and contributions to the field"
  ],
  temperature: 0.3,
  maxTokens: 2000,
  runnerType: 'base'
});

/**
 * PDF Technical Manual Analysis Stimulus
 */
export const PDFTechnicalAnalysisStimulus = new Stimulus({
  id: 'pdf-technical-analysis',
  name: 'PDF Technical Manual Analysis',
  description: 'Test models\' ability to analyze technical PDF documents',
  
  role: "technical documentation analyst",
  objective: "analyze technical manuals and extract procedural information",
  instructions: [
    "Analyze technical documentation and manuals",
    "Extract procedures, specifications, and requirements",
    "Identify technical details and configurations",
    "Provide clear summaries of technical processes"
  ],
  output: [
    "Document type and technical domain",
    "Key procedures and steps",
    "Technical specifications and requirements",
    "Configuration details and parameters",
    "Process summaries and workflows"
  ],
  examples: [
    "Example: Analyze a software installation manual and extract the system requirements, installation steps, configuration options, and troubleshooting procedures"
  ],
  temperature: 0.2, // Low temperature for precise technical analysis
  maxTokens: 1500,
  runnerType: 'base'
});
