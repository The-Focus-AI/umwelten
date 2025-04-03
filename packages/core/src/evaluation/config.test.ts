import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadEvaluationConfig, validateConfig } from './config';
import { join } from 'path';
import { writeFile, mkdir, rm } from 'fs/promises';

describe('Evaluation Configuration', () => {
  const testDir = join(process.cwd(), '..', 'evaluations', 'test-eval');
  
  // Test fixtures
  const promptConfig = {
    title: 'Test Evaluation',
    question: 'Test question?',
    context: 'Test context',
    parameters: {
      max_tokens: 1000,
      temperature: 0.7,
      top_p: 0.95
    },
    metadata: {
      created: '2024-03-26',
      version: '1.0',
      description: 'Test description',
      expected_themes: ['theme1', 'theme2']
    }
  };

  const rubricConfig = {
    evaluation_prompt: 'Test evaluation prompt',
    scoring_criteria: {
      criterion1: {
        description: 'Test criterion 1',
        points: 5,
        key_aspects: ['aspect1', 'aspect2']
      },
      criterion2: {
        description: 'Test criterion 2',
        points: 5,
        key_aspects: ['aspect3', 'aspect4']
      }
    },
    scoring_instructions: {
      method: 'Test method',
      scale: '0-10',
      minimum_pass: 6,
      excellent_threshold: 8
    },
    metadata: {
      created: '2024-03-26',
      version: '1.0',
      evaluator_model: 'gpt-4',
      notes: 'Test notes'
    }
  };

  const modelsConfig = {
    evaluator: {
      modelId: 'gpt-4-turbo-preview',
      route: 'openrouter',
      provider: 'openai',
      parameters: {
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 1000
      }
    },
    models: [
      {
        modelId: 'gemini-1.5-pro',
        route: 'direct',
        provider: 'google',
        description: 'Test model 1',
        parameters: {
          temperature: 0.7,
          top_p: 0.95,
          max_tokens: 1000
        }
      }
    ],
    metadata: {
      created: '2024-03-26',
      version: '1.0',
      notes: 'Test models',
      requirements: {
        google: 'GOOGLE_GENERATIVE_AI_API_KEY'
      }
    }
  };

  // Setup test environment
  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
    await Promise.all([
      writeFile(join(testDir, 'prompt.json'), JSON.stringify(promptConfig, null, 2)),
      writeFile(join(testDir, 'rubric.json'), JSON.stringify(rubricConfig, null, 2)),
      writeFile(join(testDir, 'models.json'), JSON.stringify(modelsConfig, null, 2))
    ]);
  });

  // Cleanup test environment
  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('loadEvaluationConfig', () => {
    it('should load and validate all configuration files', async () => {
      const config = await loadEvaluationConfig(testDir);
      
      // Check prompt config
      expect(config.prompt).toBeDefined();
      expect(config.prompt.title).toBe('Test Evaluation');
      expect(config.prompt.parameters.max_tokens).toBe(1000);

      // Check rubric config
      expect(config.rubric).toBeDefined();
      expect(config.rubric.scoring_criteria).toBeDefined();
      expect(Object.keys(config.rubric.scoring_criteria)).toHaveLength(2);

      // Check models config
      expect(config.models).toBeDefined();
      expect(config.models.models).toHaveLength(1);
      expect(config.models.models[0].provider).toBe('google');
    });

    it('should throw EvaluationConfigError for missing files', async () => {
      await expect(loadEvaluationConfig(join(testDir, 'nonexistent')))
        .rejects
        .toThrow('Failed to load evaluation config');
    });
  });

  describe('validateConfig', () => {
    let config: Awaited<ReturnType<typeof loadEvaluationConfig>>;

    beforeAll(async () => {
      config = await loadEvaluationConfig(testDir);
    });

    it('should validate configuration consistency', async () => {
      const warnings = await validateConfig(config);
      
      // Log warnings for debugging
      if (warnings.length > 0) {
        console.log('Configuration warnings:', warnings);
      }

      // Check specific validations
      const hasMaxTokensWarning = warnings.some(w => w.includes('max_tokens'));
      const hasPointsTotalWarning = warnings.some(w => w.includes('total points'));
      
      // We expect no warnings about max_tokens since they're consistent
      expect(hasMaxTokensWarning).toBe(false);
      // We expect no warnings about points total since it adds up to 10
      expect(hasPointsTotalWarning).toBe(false);
    });

    it('should check for required API keys', async () => {
      // Temporarily clear environment variables
      const originalEnv = { ...process.env };
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

      const warnings = await validateConfig(config);
      
      // Restore environment variables
      process.env = originalEnv;

      // Should have warnings about missing API keys
      expect(warnings).toContain(
        'Missing required API key for google (GOOGLE_GENERATIVE_AI_API_KEY not set in environment)'
      );
    });
  });
}); 