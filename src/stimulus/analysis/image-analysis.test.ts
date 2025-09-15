import { describe, it, expect } from 'vitest';
import {
  ImageAnalysisStimulus,
  ImageFeatureExtractionStimulus,
  ImageObjectDetectionStimulus,
  ImageTextExtractionStimulus,
  ImageAestheticAnalysisStimulus
} from './image-analysis.js';

describe('Image Analysis Stimuli', () => {
  describe('ImageAnalysisStimulus', () => {
    it('should have correct basic properties', () => {
      expect(ImageAnalysisStimulus.id).toBe('image-analysis');
      expect(ImageAnalysisStimulus.name).toBe('Image Analysis');
      expect(ImageAnalysisStimulus.description).toContain('analyze images');
    });

    it('should have proper role and objective', () => {
      expect(ImageAnalysisStimulus.role).toBe('expert image analyst');
      expect(ImageAnalysisStimulus.objective).toContain('analyze images');
    });

    it('should have comprehensive instructions', () => {
      expect(ImageAnalysisStimulus.instructions).toHaveLength(6);
      expect(ImageAnalysisStimulus.instructions[0]).toContain('Analyze the image content');
      expect(ImageAnalysisStimulus.instructions[1]).toContain('Identify all visible objects');
    });

    it('should have detailed output requirements', () => {
      expect(ImageAnalysisStimulus.output).toHaveLength(6);
      expect(ImageAnalysisStimulus.output[0]).toContain('Comprehensive description');
      expect(ImageAnalysisStimulus.output[1]).toContain('Object identification');
    });

    it('should have appropriate model settings', () => {
      expect(ImageAnalysisStimulus.temperature).toBe(0.2);
      expect(ImageAnalysisStimulus.maxTokens).toBe(2000);
      expect(ImageAnalysisStimulus.runnerType).toBe('base');
    });
  });

  describe('ImageFeatureExtractionStimulus', () => {
    it('should have correct basic properties', () => {
      expect(ImageFeatureExtractionStimulus.id).toBe('image-feature-extraction');
      expect(ImageFeatureExtractionStimulus.name).toBe('Image Feature Extraction');
      expect(ImageFeatureExtractionStimulus.description).toContain('extract structured features');
    });

    it('should have specialized role and objective', () => {
      expect(ImageFeatureExtractionStimulus.role).toBe('computer vision specialist');
      expect(ImageFeatureExtractionStimulus.objective).toContain('extract structured features');
    });

    it('should have feature-specific instructions', () => {
      expect(ImageFeatureExtractionStimulus.instructions).toHaveLength(6);
      expect(ImageFeatureExtractionStimulus.instructions[0]).toContain('Analyze the image systematically');
      expect(ImageFeatureExtractionStimulus.instructions[1]).toContain('Extract color palette');
    });

    it('should have structured output requirements', () => {
      expect(ImageFeatureExtractionStimulus.output).toHaveLength(7);
      expect(ImageFeatureExtractionStimulus.output[0]).toContain('Color palette analysis');
      expect(ImageFeatureExtractionStimulus.output[1]).toContain('Aesthetic style classification');
    });

    it('should have very low temperature for consistency', () => {
      expect(ImageFeatureExtractionStimulus.temperature).toBe(0.1);
      expect(ImageFeatureExtractionStimulus.maxTokens).toBe(1500);
    });
  });

  describe('ImageObjectDetectionStimulus', () => {
    it('should have correct basic properties', () => {
      expect(ImageObjectDetectionStimulus.id).toBe('image-object-detection');
      expect(ImageObjectDetectionStimulus.name).toBe('Image Object Detection');
      expect(ImageObjectDetectionStimulus.description).toContain('identify and locate objects');
    });

    it('should have computer vision role', () => {
      expect(ImageObjectDetectionStimulus.role).toBe('computer vision expert');
      expect(ImageObjectDetectionStimulus.objective).toContain('identify and locate objects');
    });

    it('should have object detection instructions', () => {
      expect(ImageObjectDetectionStimulus.instructions).toHaveLength(6);
      expect(ImageObjectDetectionStimulus.instructions[0]).toContain('Scan the image systematically');
      expect(ImageObjectDetectionStimulus.instructions[1]).toContain('Identify each object');
    });

    it('should have object-focused output', () => {
      expect(ImageObjectDetectionStimulus.output).toHaveLength(6);
      expect(ImageObjectDetectionStimulus.output[0]).toContain('Complete list of identified objects');
      expect(ImageObjectDetectionStimulus.output[1]).toContain('Object categories');
    });
  });

  describe('ImageTextExtractionStimulus', () => {
    it('should have correct basic properties', () => {
      expect(ImageTextExtractionStimulus.id).toBe('image-text-extraction');
      expect(ImageTextExtractionStimulus.name).toBe('Image Text Extraction');
      expect(ImageTextExtractionStimulus.description).toContain('extract and transcribe text');
    });

    it('should have OCR specialist role', () => {
      expect(ImageTextExtractionStimulus.role).toBe('OCR specialist and text extraction expert');
      expect(ImageTextExtractionStimulus.objective).toContain('extract and transcribe all text');
    });

    it('should have text extraction instructions', () => {
      expect(ImageTextExtractionStimulus.instructions).toHaveLength(6);
      expect(ImageTextExtractionStimulus.instructions[0]).toContain('Carefully scan the image');
      expect(ImageTextExtractionStimulus.instructions[1]).toContain('Transcribe text accurately');
    });

    it('should have text-focused output', () => {
      expect(ImageTextExtractionStimulus.output).toHaveLength(6);
      expect(ImageTextExtractionStimulus.output[0]).toContain('Complete transcription');
      expect(ImageTextExtractionStimulus.output[1]).toContain('Text element classification');
    });

    it('should have very low temperature for accuracy', () => {
      expect(ImageTextExtractionStimulus.temperature).toBe(0.1);
      expect(ImageTextExtractionStimulus.maxTokens).toBe(1000);
    });
  });

  describe('ImageAestheticAnalysisStimulus', () => {
    it('should have correct basic properties', () => {
      expect(ImageAestheticAnalysisStimulus.id).toBe('image-aesthetic-analysis');
      expect(ImageAestheticAnalysisStimulus.name).toBe('Image Aesthetic Analysis');
      expect(ImageAestheticAnalysisStimulus.description).toContain('analyze aesthetic and compositional qualities');
    });

    it('should have art critic role', () => {
      expect(ImageAestheticAnalysisStimulus.role).toBe('art critic and visual design expert');
      expect(ImageAestheticAnalysisStimulus.objective).toContain('analyze aesthetic and compositional qualities');
    });

    it('should have aesthetic analysis instructions', () => {
      expect(ImageAestheticAnalysisStimulus.instructions).toHaveLength(6);
      expect(ImageAestheticAnalysisStimulus.instructions[0]).toContain('Analyze the visual composition');
      expect(ImageAestheticAnalysisStimulus.instructions[1]).toContain('Assess color harmony');
    });

    it('should have aesthetic-focused output', () => {
      expect(ImageAestheticAnalysisStimulus.output).toHaveLength(6);
      expect(ImageAestheticAnalysisStimulus.output[0]).toContain('Compositional analysis');
      expect(ImageAestheticAnalysisStimulus.output[1]).toContain('Color theory assessment');
    });
  });

  describe('All stimuli validation', () => {
    const allStimuli = [
      ImageAnalysisStimulus,
      ImageFeatureExtractionStimulus,
      ImageObjectDetectionStimulus,
      ImageTextExtractionStimulus,
      ImageAestheticAnalysisStimulus
    ];

    it('should all have unique IDs', () => {
      const ids = allStimuli.map(s => s.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should all have valid names', () => {
      allStimuli.forEach(stimulus => {
        expect(stimulus.name).toBeTruthy();
        expect(stimulus.name.length).toBeGreaterThan(0);
      });
    });

    it('should all have valid descriptions', () => {
      allStimuli.forEach(stimulus => {
        expect(stimulus.description).toBeTruthy();
        expect(stimulus.description.length).toBeGreaterThan(10);
      });
    });

    it('should all have appropriate temperature settings', () => {
      allStimuli.forEach(stimulus => {
        expect(stimulus.temperature).toBeGreaterThanOrEqual(0.1);
        expect(stimulus.temperature).toBeLessThanOrEqual(0.3);
      });
    });

    it('should all have reasonable token limits', () => {
      allStimuli.forEach(stimulus => {
        expect(stimulus.maxTokens).toBeGreaterThan(500);
        expect(stimulus.maxTokens).toBeLessThanOrEqual(2000);
      });
    });

    it('should all use base runner type', () => {
      allStimuli.forEach(stimulus => {
        expect(stimulus.runnerType).toBe('base');
      });
    });
  });
});
