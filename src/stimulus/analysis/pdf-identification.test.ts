import { describe, it, expect } from 'vitest';
import { 
  PDFIdentificationStimulus, 
  PDFAcademicIdentificationStimulus, 
  PDFLegalIdentificationStimulus, 
  PDFTechnicalIdentificationStimulus 
} from './pdf-identification.js';

describe('PDF Identification Stimuli', () => {
  describe('PDFIdentificationStimulus', () => {
    it('should have correct basic properties', () => {
      expect(PDFIdentificationStimulus.id).toBe('pdf-identification');
      expect(PDFIdentificationStimulus.name).toBe('PDF Document Identification');
      expect(PDFIdentificationStimulus.description).toContain('identify and extract metadata');
    });

    it('should have correct role and objective', () => {
      expect(PDFIdentificationStimulus.role).toBe('expert document identifier and bibliographer');
      expect(PDFIdentificationStimulus.objective).toBe('extract bibliographic metadata from PDF documents');
    });

    it('should have identification specific instructions', () => {
      expect(PDFIdentificationStimulus.instructions.some(i => i.includes('Analyze the PDF document'))).toBe(true);
      expect(PDFIdentificationStimulus.instructions.some(i => i.includes('Extract title, author(s), and document type'))).toBe(true);
      expect(PDFIdentificationStimulus.instructions.some(i => i.includes('Assess confidence levels'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(PDFIdentificationStimulus.temperature).toBe(0.2);
      expect(PDFIdentificationStimulus.maxTokens).toBe(1000);
      expect(PDFIdentificationStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('PDFAcademicIdentificationStimulus', () => {
    it('should have correct basic properties', () => {
      expect(PDFAcademicIdentificationStimulus.id).toBe('pdf-academic-identification');
      expect(PDFAcademicIdentificationStimulus.name).toBe('PDF Academic Paper Identification');
      expect(PDFAcademicIdentificationStimulus.description).toContain('academic papers');
    });

    it('should have correct role and objective', () => {
      expect(PDFAcademicIdentificationStimulus.role).toBe('academic librarian and scholarly communication expert');
      expect(PDFAcademicIdentificationStimulus.objective).toBe('identify and extract metadata from academic papers');
    });

    it('should have academic specific instructions', () => {
      expect(PDFAcademicIdentificationStimulus.instructions.some(i => i.includes('academic paper characteristics'))).toBe(true);
      expect(PDFAcademicIdentificationStimulus.instructions.some(i => i.includes('publication details'))).toBe(true);
      expect(PDFAcademicIdentificationStimulus.instructions.some(i => i.includes('authors and affiliations'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(PDFAcademicIdentificationStimulus.temperature).toBe(0.2);
      expect(PDFAcademicIdentificationStimulus.maxTokens).toBe(1200);
      expect(PDFAcademicIdentificationStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('PDFLegalIdentificationStimulus', () => {
    it('should have correct basic properties', () => {
      expect(PDFLegalIdentificationStimulus.id).toBe('pdf-legal-identification');
      expect(PDFLegalIdentificationStimulus.name).toBe('PDF Legal Document Identification');
      expect(PDFLegalIdentificationStimulus.description).toContain('legal documents');
    });

    it('should have correct role and objective', () => {
      expect(PDFLegalIdentificationStimulus.role).toBe('legal document analyst and paralegal');
      expect(PDFLegalIdentificationStimulus.objective).toBe('identify and extract metadata from legal documents');
    });

    it('should have legal specific instructions', () => {
      expect(PDFLegalIdentificationStimulus.instructions.some(i => i.includes('legal document types'))).toBe(true);
      expect(PDFLegalIdentificationStimulus.instructions.some(i => i.includes('parties involved'))).toBe(true);
      expect(PDFLegalIdentificationStimulus.instructions.some(i => i.includes('important dates and deadlines'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(PDFLegalIdentificationStimulus.temperature).toBe(0.2);
      expect(PDFLegalIdentificationStimulus.maxTokens).toBe(1000);
      expect(PDFLegalIdentificationStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('PDFTechnicalIdentificationStimulus', () => {
    it('should have correct basic properties', () => {
      expect(PDFTechnicalIdentificationStimulus.id).toBe('pdf-technical-identification');
      expect(PDFTechnicalIdentificationStimulus.name).toBe('PDF Technical Manual Identification');
      expect(PDFTechnicalIdentificationStimulus.description).toContain('technical documents');
    });

    it('should have correct role and objective', () => {
      expect(PDFTechnicalIdentificationStimulus.role).toBe('technical documentation specialist');
      expect(PDFTechnicalIdentificationStimulus.objective).toBe('identify and extract metadata from technical documents');
    });

    it('should have technical specific instructions', () => {
      expect(PDFTechnicalIdentificationStimulus.instructions.some(i => i.includes('technical document types'))).toBe(true);
      expect(PDFTechnicalIdentificationStimulus.instructions.some(i => i.includes('product or system information'))).toBe(true);
      expect(PDFTechnicalIdentificationStimulus.instructions.some(i => i.includes('version numbers and revision dates'))).toBe(true);
    });

    it('should have appropriate configuration', () => {
      expect(PDFTechnicalIdentificationStimulus.temperature).toBe(0.2);
      expect(PDFTechnicalIdentificationStimulus.maxTokens).toBe(1000);
      expect(PDFTechnicalIdentificationStimulus.getRunnerType()).toBe('base');
    });
  });
});