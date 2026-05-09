import { describe, it, expect } from 'vitest';
import { 
  FrankensteinStimulus, 
  FrankensteinCharacterStimulus, 
  FrankensteinThemeStimulus 
} from './frankenstein.js';

describe('Frankenstein Stimuli', () => {
  describe('FrankensteinStimulus', () => {
    it('should create stimulus with correct properties', () => {
      expect(FrankensteinStimulus.id).toBe('frankenstein-literary-analysis');
      expect(FrankensteinStimulus.name).toBe('Frankenstein Literary Analysis');
      expect(FrankensteinStimulus.description).toContain('literary analysis');
    });

    it('should have correct role and objective', () => {
      expect(FrankensteinStimulus.options.role).toBe('literary critic');
      expect(FrankensteinStimulus.options.objective).toBe('analyze classic literature with depth and insight');
    });

    it('should have appropriate model options', () => {
      expect(FrankensteinStimulus.temperature).toBe(0.7);
      expect(FrankensteinStimulus.maxTokens).toBe(500);
      expect(FrankensteinStimulus.topP).toBe(0.9);
    });

    it('should have literary analysis instructions', () => {
      expect(FrankensteinStimulus.instructions?.[0]).toContain('expert literary critic');
      expect(FrankensteinStimulus.instructions?.[1]).toContain('scholarly precision');
    });

    it('should have structured output requirements', () => {
      expect(FrankensteinStimulus.output).toContain('Clear thesis statement');
      expect(FrankensteinStimulus.output).toContain('Supporting evidence from the text');
    });

    it('should have relevant examples', () => {
      expect(FrankensteinStimulus.examples).toHaveLength(1);
      expect(FrankensteinStimulus.examples![0]).toContain('monster');
      expect(FrankensteinStimulus.examples![0]).toContain('monstrous');
    });
  });

  describe('FrankensteinCharacterStimulus', () => {
    it('should create stimulus with correct properties', () => {
      expect(FrankensteinCharacterStimulus.id).toBe('frankenstein-character-analysis');
      expect(FrankensteinCharacterStimulus.name).toBe('Frankenstein Character Analysis');
    });

    it('should focus on character analysis', () => {
      expect(FrankensteinCharacterStimulus.objective).toContain('character development');
      expect(FrankensteinCharacterStimulus.instructions).toContain('Examine character motivations, development, and relationships');
    });

    it('should have character-specific output requirements', () => {
      expect(FrankensteinCharacterStimulus.output).toContain('Character identification and description');
      expect(FrankensteinCharacterStimulus.output).toContain('Motivation analysis');
    });
  });

  describe('FrankensteinThemeStimulus', () => {
    it('should create stimulus with correct properties', () => {
      expect(FrankensteinThemeStimulus.id).toBe('frankenstein-theme-analysis');
      expect(FrankensteinThemeStimulus.name).toBe('Frankenstein Theme Analysis');
    });

    it('should focus on thematic analysis', () => {
      expect(FrankensteinThemeStimulus.objective).toContain('analyze major themes');
      expect(FrankensteinThemeStimulus.instructions).toContain('Identify and analyze the major themes of the novel');
    });

    it('should have theme-specific output requirements', () => {
      expect(FrankensteinThemeStimulus.output).toContain('Theme identification');
      expect(FrankensteinThemeStimulus.output).toContain('Historical context');
    });
  });
});
