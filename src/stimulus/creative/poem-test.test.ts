import { describe, it, expect } from 'vitest';
import { 
  PoemTestStimulus, 
  HaikuStimulus, 
  FreeVerseStimulus, 
  SonnetStimulus 
} from './poem-test.js';

describe('Poem Test Stimuli', () => {
  describe('PoemTestStimulus', () => {
    it('should create stimulus with correct properties', () => {
      expect(PoemTestStimulus.id).toBe('poem-test-basic');
      expect(PoemTestStimulus.name).toBe('Basic Poetry Generation');
      expect(PoemTestStimulus.description).toContain('simple, creative poetry');
    });

    it('should have correct role and objective', () => {
      expect(PoemTestStimulus.role).toBe('literary genius');
      expect(PoemTestStimulus.objective).toBe('write short poems with creativity and structure');
    });

    it('should have appropriate model options', () => {
      expect(PoemTestStimulus.temperature).toBe(0.5);
      expect(PoemTestStimulus.maxTokens).toBe(100);
      expect(PoemTestStimulus.topP).toBe(0.8);
    });

    it('should have poetry-specific instructions', () => {
      expect(PoemTestStimulus.instructions?.[0]).toContain('talented poet');
      expect(PoemTestStimulus.instructions?.[2]).toContain('vivid imagery');
    });

    it('should have poetry output requirements', () => {
      expect(PoemTestStimulus.output).toContain('Short, focused poems (4-8 lines typically)');
      expect(PoemTestStimulus.output).toContain('Creative use of language');
    });

    it('should have relevant examples', () => {
      expect(PoemTestStimulus.examples).toHaveLength(2);
      expect(PoemTestStimulus.examples![0]).toContain('cat');
      expect(PoemTestStimulus.examples![1]).toContain('rain');
    });
  });

  describe('HaikuStimulus', () => {
    it('should create stimulus with correct properties', () => {
      expect(HaikuStimulus.id).toBe('haiku-generation');
      expect(HaikuStimulus.name).toBe('Haiku Generation');
    });

    it('should focus on haiku structure', () => {
      expect(HaikuStimulus.objective).toContain('5-7-5 syllable structure');
      expect(HaikuStimulus.instructions).toContain('Write traditional haiku following the 5-7-5 syllable pattern');
    });

    it('should have haiku-specific output requirements', () => {
      expect(HaikuStimulus.output).toContain('5-7-5 syllable structure');
      expect(HaikuStimulus.output).toContain('Nature or seasonal theme');
    });

    it('should have appropriate model options for haiku', () => {
      expect(HaikuStimulus.temperature).toBe(0.4);
      expect(HaikuStimulus.maxTokens).toBe(50);
    });
  });

  describe('FreeVerseStimulus', () => {
    it('should create stimulus with correct properties', () => {
      expect(FreeVerseStimulus.id).toBe('free-verse-poetry');
      expect(FreeVerseStimulus.name).toBe('Free Verse Poetry');
    });

    it('should focus on free verse', () => {
      expect(FreeVerseStimulus.objective).toContain('free verse poetry');
      expect(FreeVerseStimulus.instructions).toContain('Write free verse poetry without strict meter or rhyme');
    });

    it('should have free verse output requirements', () => {
      expect(FreeVerseStimulus.output).toContain('No strict meter or rhyme');
      expect(FreeVerseStimulus.output).toContain('Effective use of line breaks');
    });
  });

  describe('SonnetStimulus', () => {
    it('should create stimulus with correct properties', () => {
      expect(SonnetStimulus.id).toBe('sonnet-generation');
      expect(SonnetStimulus.name).toBe('Sonnet Generation');
    });

    it('should focus on sonnet structure', () => {
      expect(SonnetStimulus.objective).toContain('traditional sonnets');
      expect(SonnetStimulus.instructions).toContain('Write traditional sonnets following 14-line structure');
    });

    it('should have sonnet-specific output requirements', () => {
      expect(SonnetStimulus.output).toContain('14 lines total');
      expect(SonnetStimulus.output).toContain('Appropriate rhyme scheme');
    });

    it('should have appropriate model options for sonnets', () => {
      expect(SonnetStimulus.temperature).toBe(0.5);
      expect(SonnetStimulus.maxTokens).toBe(200);
    });
  });
});
