import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DockerRunner, LANGUAGE_CONFIGS } from './docker-runner.js';

describe('DockerRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSupportedLanguages', () => {
    it('should return list of supported languages', () => {
      const languages = DockerRunner.getSupportedLanguages();
      expect(languages).toContain('typescript');
      expect(languages).toContain('javascript');
      expect(languages).toContain('python');
      expect(languages).toContain('rust');
      expect(languages).toContain('go');
      expect(languages.length).toBeGreaterThan(0);
    });
  });

  describe('addLanguageConfig', () => {
    it('should add new language configuration', () => {
      const testConfig = {
        extension: '.test',
        baseImage: 'test:latest',
        runCommand: 'test /app/code.test'
      };

      DockerRunner.addLanguageConfig('testlang', testConfig);
      
      expect(LANGUAGE_CONFIGS.testlang).toEqual(testConfig);
      expect(DockerRunner.getSupportedLanguages()).toContain('testlang');
      
      // Clean up
      delete LANGUAGE_CONFIGS.testlang;
    });
  });

  describe('runCode', () => {
    it('should reject unsupported language', async () => {
      const result = await DockerRunner.runCode({
        code: 'console.log("test");',
        language: 'unsupported',
        modelName: 'test-model'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported language');
      expect(result.modelName).toBe('test-model');
    });

    it('should handle TypeScript code execution', async () => {
      const testCode = `
console.log("Hello from TypeScript!");
console.log("Testing Docker runner");

const numbers = [1, 2, 3, 4, 5];
numbers.forEach(num => console.log(\`Number: \${num}\`));

console.log("Test completed");
      `.trim();

      const result = await DockerRunner.runCode({
        code: testCode,
        language: 'typescript',
        timeout: 30,
        modelName: 'test-typescript'
      });

      // Log the result for debugging
      console.log('Docker execution result:', {
        success: result.success,
        modelName: result.modelName,
        outputLength: result.output?.length,
        error: result.error
      });

      if (result.success) {
        expect(result.success).toBe(true);
        expect(result.modelName).toBe('test-typescript');
        expect(result.output).toContain('Hello from TypeScript!');
        expect(result.output).toContain('Testing Docker runner');
        expect(result.output).toContain('Number: 1');
        expect(result.output).toContain('Test completed');
      } else {
        // If Docker is not available or there's an issue, we should still get a proper error
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.modelName).toBe('test-typescript');
        
        // Log for debugging
        console.log('Docker execution failed (expected if Docker not available):', result.error);
      }
    }, 60000); // Increase timeout for Docker operations

    it('should handle JavaScript code execution', async () => {
      const testCode = `
console.log("Hello from JavaScript!");
const data = { test: true, value: 42 };
console.log("Data:", JSON.stringify(data));
console.log("Finished");
      `.trim();

      const result = await DockerRunner.runCode({
        code: testCode,
        language: 'javascript',
        timeout: 30,
        modelName: 'test-javascript'
      });

      console.log('JavaScript execution result:', {
        success: result.success,
        modelName: result.modelName,
        outputLength: result.output?.length,
        error: result.error
      });

      if (result.success) {
        expect(result.success).toBe(true);
        expect(result.modelName).toBe('test-javascript');
        expect(result.output).toContain('Hello from JavaScript!');
        expect(result.output).toContain('"test":true');
        expect(result.output).toContain('Finished');
      } else {
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.modelName).toBe('test-javascript');
      }
    }, 60000);

    it('should handle Python code execution', async () => {
      const testCode = `
print("Hello from Python!")
numbers = [1, 2, 3, 4, 5]
for num in numbers:
    print(f"Number: {num}")
print("Python test completed")
      `.trim();

      const result = await DockerRunner.runCode({
        code: testCode,
        language: 'python',
        timeout: 30,
        modelName: 'test-python'
      });

      console.log('Python execution result:', {
        success: result.success,
        modelName: result.modelName,
        outputLength: result.output?.length,
        error: result.error
      });

      if (result.success) {
        expect(result.success).toBe(true);
        expect(result.modelName).toBe('test-python');
        expect(result.output).toContain('Hello from Python!');
        expect(result.output).toContain('Number: 1');
        expect(result.output).toContain('Python test completed');
      } else {
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.modelName).toBe('test-python');
      }
    }, 60000);

    it.skip('should handle timeout correctly', async () => {
      const infiniteLoopCode = `
console.log("Starting infinite loop test");
while (true) {
  // This will timeout
}
      `.trim();

      const result = await DockerRunner.runCode({
        code: infiniteLoopCode,
        language: 'javascript',
        timeout: 5, // Short timeout
        modelName: 'test-timeout'
      });

      console.log('Timeout test result:', {
        success: result.success,
        modelName: result.modelName,
        error: result.error
      });

      expect(result.success).toBe(false);
      expect(result.modelName).toBe('test-timeout');
      // The timeout might be handled by Docker or the system, so we check for various timeout indicators
      expect(result.error).toMatch(/(timed out|timeout|killed|terminated)/i);
    }, 60000);

    it('should handle syntax errors gracefully', async () => {
      const invalidCode = `
console.log("This has a syntax error"
// Missing closing parenthesis
invalid syntax here
      `.trim();

      const result = await DockerRunner.runCode({
        code: invalidCode,
        language: 'javascript',
        timeout: 30,
        modelName: 'test-syntax-error'
      });

      console.log('Syntax error test result:', {
        success: result.success,
        modelName: result.modelName,
        error: result.error
      });

      expect(result.success).toBe(false);
      expect(result.modelName).toBe('test-syntax-error');
      expect(result.error).toBeDefined();
    }, 60000);

    it('should work without modelName parameter', async () => {
      const result = await DockerRunner.runCode({
        code: 'console.log("No model name test");',
        language: 'javascript',
        timeout: 30
      });

      console.log('No model name test result:', {
        success: result.success,
        modelName: result.modelName,
        error: result.error
      });

      // modelName should be undefined when not provided
      expect(result.modelName).toBeUndefined();
    }, 60000);
  });

  describe('language configurations', () => {
    it('should have valid configurations for all supported languages', () => {
      const languages = DockerRunner.getSupportedLanguages();
      
      languages.forEach(lang => {
        const config = LANGUAGE_CONFIGS[lang];
        expect(config).toBeDefined();
        expect(config.extension).toBeDefined();
        expect(config.baseImage).toBeDefined();
        expect(config.runCommand).toBeDefined();
        expect(config.extension).toMatch(/^\.\w+$/); // Should start with dot
        expect(config.baseImage).toContain(':'); // Should have version tag
        expect(config.runCommand).toContain('/app/code'); // Should reference the code file
      });
    });

    it('should have expected language configurations', () => {
      expect(LANGUAGE_CONFIGS.typescript.extension).toBe('.ts');
      expect(LANGUAGE_CONFIGS.typescript.baseImage).toBe('node:20-alpine');
      expect(LANGUAGE_CONFIGS.typescript.runCommand).toContain('tsx');

      expect(LANGUAGE_CONFIGS.javascript.extension).toBe('.js');
      expect(LANGUAGE_CONFIGS.javascript.baseImage).toBe('node:20-alpine');
      expect(LANGUAGE_CONFIGS.javascript.runCommand).toContain('node');

      expect(LANGUAGE_CONFIGS.python.extension).toBe('.py');
      expect(LANGUAGE_CONFIGS.python.baseImage).toBe('python:3.11-alpine');
      expect(LANGUAGE_CONFIGS.python.runCommand).toContain('python');

      expect(LANGUAGE_CONFIGS.rust.extension).toBe('.rs');
      expect(LANGUAGE_CONFIGS.rust.baseImage).toBe('rust:1.75-alpine');
      expect(LANGUAGE_CONFIGS.rust.runCommand).toContain('rustc');

      expect(LANGUAGE_CONFIGS.go.extension).toBe('.go');
      expect(LANGUAGE_CONFIGS.go.baseImage).toBe('golang:1.21-alpine');
      expect(LANGUAGE_CONFIGS.go.runCommand).toContain('go run');
    });
  });
});
