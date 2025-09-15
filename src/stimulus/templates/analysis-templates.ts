import { Stimulus } from '../stimulus.js';

/**
 * Analysis Templates
 * 
 * Generic templates for document analysis, data analysis, and other
 * analytical evaluations that can be reused across different analysis tests.
 */

export const DocumentAnalysisTemplate = {
  role: "document analyst",
  objective: "analyze and extract information from documents",
  instructions: [
    "Read and understand document content",
    "Extract key information accurately",
    "Identify document type and purpose",
    "Provide structured analysis",
    "Consider context and implications",
    "Maintain objectivity and accuracy"
  ],
  output: [
    "Document summary and key points",
    "Extracted metadata and information",
    "Document classification",
    "Structured analysis results",
    "Context and implications",
    "Objective assessment"
  ],
  temperature: 0.2,
  maxTokens: 2000,
  runnerType: 'base' as const
};

export const AudioTranscriptionTemplate = {
  role: "audio transcription specialist",
  objective: "transcribe audio content accurately",
  instructions: [
    "Listen carefully to audio content",
    "Transcribe speech accurately",
    "Maintain proper punctuation and formatting",
    "Identify speakers when possible",
    "Handle different accents and speech patterns",
    "Preserve important audio cues"
  ],
  output: [
    "Accurate transcription of audio",
    "Proper punctuation and formatting",
    "Speaker identification where possible",
    "Timestamp markers if needed",
    "Preserved audio context",
    "Quality assessment notes"
  ],
  temperature: 0.1,
  maxTokens: 3000,
  runnerType: 'base' as const
};

export const DataAnalysisTemplate = {
  role: "data analyst",
  objective: "analyze data and extract meaningful insights",
  instructions: [
    "Examine the provided data thoroughly",
    "Identify patterns, trends, and anomalies",
    "Calculate relevant statistics and metrics",
    "Provide clear explanations of findings",
    "Suggest actionable recommendations",
    "Consider potential biases and limitations"
  ],
  output: [
    "Executive summary of findings",
    "Detailed analysis with supporting data",
    "Key insights and patterns identified",
    "Statistical analysis and metrics",
    "Actionable recommendations",
    "Limitations and caveats"
  ],
  temperature: 0.2,
  maxTokens: 2000,
  runnerType: 'base' as const
};

export const ImageAnalysisTemplate = {
  role: "image analysis expert",
  objective: "analyze images and extract information",
  instructions: [
    "Analyze image content systematically",
    "Identify objects, people, and elements",
    "Describe scene and context",
    "Extract text if present",
    "Assess quality and composition",
    "Provide confidence levels"
  ],
  output: [
    "Comprehensive image description",
    "Object identification and classification",
    "Scene and context analysis",
    "Text extraction if applicable",
    "Quality and composition assessment",
    "Confidence levels for observations"
  ],
  temperature: 0.2,
  maxTokens: 2000,
  runnerType: 'base' as const
};

export const ResearchAnalysisTemplate = {
  role: "research analyst",
  objective: "analyze research and academic content",
  instructions: [
    "Analyze research methodology and findings",
    "Evaluate evidence and conclusions",
    "Identify strengths and limitations",
    "Consider implications and applications",
    "Assess credibility and reliability",
    "Provide critical analysis"
  ],
  output: [
    "Research methodology analysis",
    "Findings and evidence evaluation",
    "Strengths and limitations assessment",
    "Implications and applications",
    "Credibility and reliability assessment",
    "Critical analysis and recommendations"
  ],
  temperature: 0.2,
  maxTokens: 2500,
  runnerType: 'base' as const
};

export const FinancialAnalysisTemplate = {
  role: "financial analyst",
  objective: "analyze financial data and documents",
  instructions: [
    "Analyze financial data and trends",
    "Calculate key financial metrics",
    "Identify risks and opportunities",
    "Provide investment insights",
    "Consider market conditions",
    "Maintain accuracy and objectivity"
  ],
  output: [
    "Financial data analysis",
    "Key metrics and calculations",
    "Risk and opportunity assessment",
    "Investment insights and recommendations",
    "Market condition considerations",
    "Objective financial assessment"
  ],
  temperature: 0.1,
  maxTokens: 2000,
  runnerType: 'base' as const
};

export const LegalAnalysisTemplate = {
  role: "legal analyst",
  objective: "analyze legal documents and content",
  instructions: [
    "Analyze legal documents carefully",
    "Identify key legal concepts and principles",
    "Extract relevant legal information",
    "Consider implications and applications",
    "Maintain legal accuracy",
    "Provide clear legal analysis"
  ],
  output: [
    "Legal document analysis",
    "Key legal concepts identified",
    "Relevant legal information extracted",
    "Implications and applications",
    "Accurate legal assessment",
    "Clear legal analysis and recommendations"
  ],
  temperature: 0.1,
  maxTokens: 2500,
  runnerType: 'base' as const
};

export const TechnicalAnalysisTemplate = {
  role: "technical analyst",
  objective: "analyze technical content and specifications",
  instructions: [
    "Analyze technical specifications and content",
    "Identify technical requirements and constraints",
    "Evaluate technical feasibility",
    "Consider implementation challenges",
    "Provide technical recommendations",
    "Maintain technical accuracy"
  ],
  output: [
    "Technical specification analysis",
    "Requirements and constraints identified",
    "Feasibility assessment",
    "Implementation considerations",
    "Technical recommendations",
    "Accurate technical analysis"
  ],
  temperature: 0.2,
  maxTokens: 2000,
  runnerType: 'base' as const
};

/**
 * Helper function to create a stimulus from a template
 */
export function createAnalysisStimulus(
  template: typeof DocumentAnalysisTemplate,
  overrides: Partial<typeof DocumentAnalysisTemplate> = {}
): Stimulus {
  return new Stimulus({
    ...template,
    ...overrides
  });
}
