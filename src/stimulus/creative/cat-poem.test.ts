import { describe, it, expect } from 'vitest';
import { CatPoemStimulus, CatPoemHaikuStimulus, CatPoemMelancholyStimulus } from './cat-poem.js';
import { Stimulus } from '../../stimulus/stimulus.js';

describe('Cat Poem Stimuli', () => {
  describe('CatPoemStimulus', () => {
    it('should create stimulus with correct properties', () => {
      expect(CatPoemStimulus.options.id).toBe('cat-poem');
      expect(CatPoemStimulus.options.name).toBe('Cat Poem Generation');
      expect(CatPoemStimulus.options.description).toBe('Test models\' ability to write creative poetry about cats');
      expect(CatPoemStimulus.options.role).toBe('literary genius');
      expect(CatPoemStimulus.options.objective).toBe('write short poems about cats');
    });

    it('should have correct model options', () => {
      expect(CatPoemStimulus.options.temperature).toBe(0.7);
      expect(CatPoemStimulus.options.maxTokens).toBe(200);
      expect(CatPoemStimulus.options.runnerType).toBe('base');
    });

    it('should have instructions for creative writing', () => {
      expect(CatPoemStimulus.options.instructions).toContain('Write a creative poem about cats');
      expect(CatPoemStimulus.options.instructions).toContain('Use vivid imagery and descriptive language');
      expect(CatPoemStimulus.options.instructions).toContain('Keep the poem between 4-8 lines');
    });

    it('should have output requirements', () => {
      expect(CatPoemStimulus.options.output).toContain('A short poem about cats');
      expect(CatPoemStimulus.options.output).toContain('Each line should be meaningful and creative');
    });

    it('should have examples', () => {
      expect(CatPoemStimulus.options.examples).toHaveLength(1);
      expect(CatPoemStimulus.options.examples![0]).toContain('Whiskers twitch in moonlight\'s glow');
    });

    it('should generate proper prompt', () => {
      const prompt = CatPoemStimulus.getPrompt();
      expect(prompt).toContain('You are a literary genius');
      expect(prompt).toContain('Your objective is to write short poems about cats');
      expect(prompt).toContain('Write a creative poem about cats');
      expect(prompt).toContain('Use vivid imagery and descriptive language');
    });

    it('should return correct model options', () => {
      const modelOptions = CatPoemStimulus.getModelOptions();
      expect(modelOptions.temperature).toBe(0.7);
      expect(modelOptions.maxTokens).toBe(200);
    });

    it('should return correct runner type', () => {
      expect(CatPoemStimulus.getRunnerType()).toBe('base');
    });
  });

  describe('CatPoemHaikuStimulus', () => {
    it('should create stimulus with correct properties', () => {
      expect(CatPoemHaikuStimulus.options.id).toBe('cat-poem-haiku');
      expect(CatPoemHaikuStimulus.options.name).toBe('Cat Haiku Generation');
      expect(CatPoemHaikuStimulus.options.role).toBe('haiku master');
      expect(CatPoemHaikuStimulus.options.objective).toBe('write haiku poems about cats');
    });

    it('should have haiku-specific instructions', () => {
      expect(CatPoemHaikuStimulus.options.instructions).toContain('Write a haiku about cats (5-7-5 syllable structure)');
      expect(CatPoemHaikuStimulus.options.instructions).toContain('Focus on nature and seasonal imagery');
      expect(CatPoemHaikuStimulus.options.instructions).toContain('Use simple, clear language');
    });

    it('should have appropriate model options for haiku', () => {
      expect(CatPoemHaikuStimulus.options.temperature).toBe(0.6);
      expect(CatPoemHaikuStimulus.options.maxTokens).toBe(50);
    });

    it('should have haiku examples', () => {
      expect(CatPoemHaikuStimulus.options.examples![0]).toContain('Soft paws on wet grass');
      expect(CatPoemHaikuStimulus.options.examples![0]).toContain('Emerald eyes watch the world');
    });
  });

  describe('CatPoemMelancholyStimulus', () => {
    it('should create stimulus with correct properties', () => {
      expect(CatPoemMelancholyStimulus.options.id).toBe('cat-poem-melancholy');
      expect(CatPoemMelancholyStimulus.options.name).toBe('Melancholy Cat Poem');
      expect(CatPoemMelancholyStimulus.options.role).toBe('poet with a melancholic soul');
      expect(CatPoemMelancholyStimulus.options.objective).toBe('write melancholic poems about cats');
    });

    it('should have melancholic instructions', () => {
      expect(CatPoemMelancholyStimulus.options.instructions).toContain('Write a melancholic poem about cats');
      expect(CatPoemMelancholyStimulus.options.instructions).toContain('Use somber, reflective language');
      expect(CatPoemMelancholyStimulus.options.instructions).toContain('Explore themes of loneliness, loss, or longing');
    });

    it('should have appropriate model options for melancholic tone', () => {
      expect(CatPoemMelancholyStimulus.options.temperature).toBe(0.5);
      expect(CatPoemMelancholyStimulus.options.maxTokens).toBe(150);
    });

    it('should have melancholic examples', () => {
      expect(CatPoemMelancholyStimulus.options.examples![0]).toContain('In the empty room');
      expect(CatPoemMelancholyStimulus.options.examples![0]).toContain('A cat sits by the window');
      expect(CatPoemMelancholyStimulus.options.examples![0]).toContain('Now only silence remains');
    });
  });

  describe('Stimulus functionality', () => {
    it('should allow modification of stimulus properties', () => {
      const customStimulus = new Stimulus({
        role: 'poetry expert',
        objective: 'create beautiful cat poetry'
      });
      
      expect(customStimulus.options.role).toBe('poetry expert');
      expect(customStimulus.options.objective).toBe('create beautiful cat poetry');
    });

    it('should allow adding instructions', () => {
      const customStimulus = new Stimulus();
      customStimulus.addInstruction('Include at least one metaphor');
      customStimulus.addInstruction('Use alliteration sparingly');
      
      expect(customStimulus.options.instructions).toContain('Include at least one metaphor');
      expect(customStimulus.options.instructions).toContain('Use alliteration sparingly');
    });

    it('should allow adding output requirements', () => {
      const customStimulus = new Stimulus();
      customStimulus.addOutput('Include a title for the poem');
      customStimulus.addOutput('End with a memorable closing line');
      
      expect(customStimulus.options.output).toContain('Include a title for the poem');
      expect(customStimulus.options.output).toContain('End with a memorable closing line');
    });

    it('should generate updated prompt after modifications', () => {
      const customStimulus = new Stimulus({
        role: 'feline poetry specialist'
      });
      customStimulus.addInstruction('Focus on cat behavior and characteristics');
      
      const prompt = customStimulus.getPrompt();
      expect(prompt).toContain('You are a feline poetry specialist');
      expect(prompt).toContain('Focus on cat behavior and characteristics');
    });
  });
});
