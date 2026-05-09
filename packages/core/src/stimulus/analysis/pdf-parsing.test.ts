import { describe, it, expect } from 'vitest';
import { 
  PDFParsingStimulus, 
  PDFFinancialParsingStimulus, 
  PDFLegalParsingStimulus, 
  PDFResearchParsingStimulus, 
  PDFTechnicalParsingStimulus 
} from './pdf-parsing.js';

describe('PDF Parsing Stimuli', () => {
  describe('PDFParsingStimulus', () => {
    it('should have correct basic properties', () => {
      expect(PDFParsingStimulus.id).toBe('pdf-parsing');
      expect(PDFParsingStimulus.name).toBe('PDF Document Parsing');
      expect(PDFParsingStimulus.description).toContain('parse and analyze PDF document content');
    });

    it('should have correct role and objective', () => {
      expect(PDFParsingStimulus.role).toBe('expert document analyst');
      expect(PDFParsingStimulus.objective).toBe('analyze PDF documents and extract structured information');
    });

    it('should have parsing specific instructions', () => {
      expect(PDFParsingStimulus.instructions.some(i => i.includes('Analyze the PDF document'))).toBe(true);
      expect(PDFParsingStimulus.instructions.some(i => i.includes('Extract key information and main points'))).toBe(true);
      expect(PDFParsingStimulus.instructions.some(i => i.includes('Provide detailed summaries'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(PDFParsingStimulus.temperature).toBe(0.3);
      expect(PDFParsingStimulus.maxTokens).toBe(2000);
      expect(PDFParsingStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('PDFFinancialParsingStimulus', () => {
    it('should have correct basic properties', () => {
      expect(PDFFinancialParsingStimulus.id).toBe('pdf-financial-parsing');
      expect(PDFFinancialParsingStimulus.name).toBe('PDF Financial Document Parsing');
        expect(PDFFinancialParsingStimulus.description).toContain('financial documents');
    });

    it('should have correct role and objective', () => {
      expect(PDFFinancialParsingStimulus.role).toBe('financial analyst and document reviewer');
      expect(PDFFinancialParsingStimulus.objective).toBe('parse financial documents and extract key financial information');
    });

    it('should have financial specific instructions', () => {
      expect(PDFFinancialParsingStimulus.instructions.some(i => i.includes('financial documents'))).toBe(true);
      expect(PDFFinancialParsingStimulus.instructions.some(i => i.includes('financial metrics and data points'))).toBe(true);
      expect(PDFFinancialParsingStimulus.instructions.some(i => i.includes('trends, patterns, and anomalies'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(PDFFinancialParsingStimulus.temperature).toBe(0.2);
      expect(PDFFinancialParsingStimulus.maxTokens).toBe(1500);
      expect(PDFFinancialParsingStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('PDFLegalParsingStimulus', () => {
    it('should have correct basic properties', () => {
      expect(PDFLegalParsingStimulus.id).toBe('pdf-legal-parsing');
      expect(PDFLegalParsingStimulus.name).toBe('PDF Legal Document Parsing');
      expect(PDFLegalParsingStimulus.description).toContain('legal documents');
    });

    it('should have correct role and objective', () => {
      expect(PDFLegalParsingStimulus.role).toBe('legal document analyst');
      expect(PDFLegalParsingStimulus.objective).toBe('parse legal documents and extract key legal information');
    });

    it('should have legal specific instructions', () => {
      expect(PDFLegalParsingStimulus.instructions.some(i => i.includes('legal documents'))).toBe(true);
      expect(PDFLegalParsingStimulus.instructions.some(i => i.includes('legal terms, clauses, and obligations'))).toBe(true);
      expect(PDFLegalParsingStimulus.instructions.some(i => i.includes('important dates, parties, and conditions'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(PDFLegalParsingStimulus.temperature).toBe(0.2);
      expect(PDFLegalParsingStimulus.maxTokens).toBe(1500);
      expect(PDFLegalParsingStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('PDFResearchParsingStimulus', () => {
    it('should have correct basic properties', () => {
      expect(PDFResearchParsingStimulus.id).toBe('pdf-research-parsing');
      expect(PDFResearchParsingStimulus.name).toBe('PDF Research Paper Parsing');
      expect(PDFResearchParsingStimulus.description).toContain('academic research papers');
    });

    it('should have correct role and objective', () => {
      expect(PDFResearchParsingStimulus.role).toBe('research analyst and academic reviewer');
      expect(PDFResearchParsingStimulus.objective).toBe('parse research papers and extract academic information');
    });

    it('should have research specific instructions', () => {
      expect(PDFResearchParsingStimulus.instructions.some(i => i.includes('academic research papers'))).toBe(true);
      expect(PDFResearchParsingStimulus.instructions.some(i => i.includes('research questions, methodology, and findings'))).toBe(true);
      expect(PDFResearchParsingStimulus.instructions.some(i => i.includes('key contributions and limitations'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(PDFResearchParsingStimulus.temperature).toBe(0.3);
      expect(PDFResearchParsingStimulus.maxTokens).toBe(2000);
      expect(PDFResearchParsingStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('PDFTechnicalParsingStimulus', () => {
    it('should have correct basic properties', () => {
      expect(PDFTechnicalParsingStimulus.id).toBe('pdf-technical-parsing');
      expect(PDFTechnicalParsingStimulus.name).toBe('PDF Technical Manual Parsing');
      expect(PDFTechnicalParsingStimulus.description).toContain('technical documents');
    });

    it('should have correct role and objective', () => {
      expect(PDFTechnicalParsingStimulus.role).toBe('technical documentation specialist');
      expect(PDFTechnicalParsingStimulus.objective).toBe('parse technical documents and extract technical information');
    });

    it('should have technical specific instructions', () => {
      expect(PDFTechnicalParsingStimulus.instructions.some(i => i.includes('technical documents'))).toBe(true);
      expect(PDFTechnicalParsingStimulus.instructions.some(i => i.includes('technical specifications and procedures'))).toBe(true);
      expect(PDFTechnicalParsingStimulus.instructions.some(i => i.includes('key concepts and terminology'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(PDFTechnicalParsingStimulus.temperature).toBe(0.3);
      expect(PDFTechnicalParsingStimulus.maxTokens).toBe(1500);
      expect(PDFTechnicalParsingStimulus.getRunnerType()).toBe('base');
    });
  });
});
