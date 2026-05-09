import { describe, it, expect } from 'vitest';
import { 
  TemperatureSensitivityStimulus, 
  LowTemperatureStimulus, 
  HighTemperatureStimulus, 
  TemperatureRangeStimulus 
} from './temperature.js';

describe('Temperature Stimuli', () => {
  describe('TemperatureSensitivityStimulus', () => {
    it('should create stimulus with correct properties', () => {
      expect(TemperatureSensitivityStimulus.id).toBe('temperature-sensitivity');
      expect(TemperatureSensitivityStimulus.name).toBe('Temperature Sensitivity Testing');
      expect(TemperatureSensitivityStimulus.description).toContain('temperature settings');
    });

    it('should have correct role and objective', () => {
      expect(TemperatureSensitivityStimulus.role).toBe('helpful assistant');
      expect(TemperatureSensitivityStimulus.objective).toContain('write short poems about cats');
    });

    it('should have appropriate model options', () => {
      expect(TemperatureSensitivityStimulus.temperature).toBe(0.7);
      expect(TemperatureSensitivityStimulus.maxTokens).toBe(100);
      expect(TemperatureSensitivityStimulus.topP).toBe(0.8);
    });

    it('should have temperature testing instructions', () => {
      expect(TemperatureSensitivityStimulus.instructions?.[3]).toContain('consistent quality');
      expect(TemperatureSensitivityStimulus.instructions?.[3]).toContain('temperature setting');
    });

    it('should have poetry output requirements', () => {
      expect(TemperatureSensitivityStimulus.output).toContain('Short poems (4-8 lines)');
      expect(TemperatureSensitivityStimulus.output).toContain('Cat-themed content');
    });
  });

  describe('LowTemperatureStimulus', () => {
    it('should create stimulus with correct properties', () => {
      expect(LowTemperatureStimulus.id).toBe('low-temperature-consistency');
      expect(LowTemperatureStimulus.name).toBe('Low Temperature Consistency');
    });

    it('should focus on consistency', () => {
      expect(LowTemperatureStimulus.objective).toContain('consistent, predictable poems');
      expect(LowTemperatureStimulus.instructions).toContain('Write poems with consistent structure and style');
    });

    it('should have low temperature settings', () => {
      expect(LowTemperatureStimulus.temperature).toBe(0.2);
      expect(LowTemperatureStimulus.maxTokens).toBe(80);
      expect(LowTemperatureStimulus.topP).toBe(0.6);
    });

    it('should have consistency-focused output requirements', () => {
      expect(LowTemperatureStimulus.output).toContain('Consistent structure');
      expect(LowTemperatureStimulus.output).toContain('Predictable patterns');
    });
  });

  describe('HighTemperatureStimulus', () => {
    it('should create stimulus with correct properties', () => {
      expect(HighTemperatureStimulus.id).toBe('high-temperature-creativity');
      expect(HighTemperatureStimulus.name).toBe('High Temperature Creativity');
    });

    it('should focus on creativity', () => {
      expect(HighTemperatureStimulus.objective).toContain('creative, varied poems');
      expect(HighTemperatureStimulus.instructions).toContain('Write poems with high creativity and variation');
    });

    it('should have high temperature settings', () => {
      expect(HighTemperatureStimulus.temperature).toBe(0.9);
      expect(HighTemperatureStimulus.maxTokens).toBe(120);
      expect(HighTemperatureStimulus.topP).toBe(0.95);
    });

    it('should have creativity-focused output requirements', () => {
      expect(HighTemperatureStimulus.output).toContain('High creativity');
      expect(HighTemperatureStimulus.output).toContain('Unexpected imagery');
    });
  });

  describe('TemperatureRangeStimulus', () => {
    it('should create stimulus with correct properties', () => {
      expect(TemperatureRangeStimulus.id).toBe('temperature-range-testing');
      expect(TemperatureRangeStimulus.name).toBe('Temperature Range Testing');
    });

    it('should focus on adaptability', () => {
      expect(TemperatureRangeStimulus.objective).toContain('adapt to different temperature');
      expect(TemperatureRangeStimulus.instructions).toContain('Adapt style to the temperature setting');
    });

    it('should have balanced temperature settings', () => {
      expect(TemperatureRangeStimulus.temperature).toBe(0.5);
      expect(TemperatureRangeStimulus.maxTokens).toBe(100);
      expect(TemperatureRangeStimulus.topP).toBe(0.8);
    });

    it('should have adaptability-focused output requirements', () => {
      expect(TemperatureRangeStimulus.output).toContain('Adaptable to temperature changes');
      expect(TemperatureRangeStimulus.output).toContain('Balances consistency and creativity');
    });
  });
});
