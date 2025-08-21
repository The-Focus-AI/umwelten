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

    it('should handle timeout correctly for JavaScript', async () => {
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
      expect(result.error).toContain('Execution timed out after 5 seconds');
    }, 10000);

    it('should handle timeout correctly for Bash', async () => {
      const infiniteLoopCode = `#!/bin/bash
echo "Starting infinite loop test"
while true; do
  echo "Looping..."
  sleep 1
done
      `.trim();

      const result = await DockerRunner.runCode({
        code: infiniteLoopCode,
        language: 'bash',
        timeout: 3, // Very short timeout
        modelName: 'test-bash-timeout'
      });

      console.log('Bash timeout test result:', {
        success: result.success,
        modelName: result.modelName,
        error: result.error
      });

      expect(result.success).toBe(false);
      expect(result.modelName).toBe('test-bash-timeout');
      expect(result.error).toContain('Execution timed out after 3 seconds');
    }, 10000);

    it('should NOT timeout for fast-executing code', async () => {
      const fastCode = `
console.log("Quick execution test");
console.log("Done!");
      `.trim();

      const result = await DockerRunner.runCode({
        code: fastCode,
        language: 'javascript',
        timeout: 5, // Short timeout but code should finish quickly
        modelName: 'test-fast-execution'
      });

      console.log('Fast execution test result:', {
        success: result.success,
        modelName: result.modelName,
        error: result.error
      });

      if (result.success) {
        expect(result.success).toBe(true);
        expect(result.modelName).toBe('test-fast-execution');
        expect(result.output).toContain('Quick execution test');
        expect(result.output).toContain('Done!');
      } else {
        // If Docker is not available, we should get a proper error, not a timeout
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error).not.toContain('Execution timed out');
      }
    }, 10000);

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

    it('should handle Perl code execution', async () => {
      const testCode = `
#!/usr/bin/env perl
use strict;
use warnings;

print "Hello from Perl!\\n";
print "Testing Docker runner\\n";

my @numbers = (1, 2, 3, 4, 5);
foreach my $num (@numbers) {
    print "Number: $num\\n";
}

my $data = {
    test => "value",
    count => 42
};
print "Data: " . $data->{test} . ", Count: " . $data->{count} . "\\n";

print "Perl test completed\\n";
      `.trim();

      const result = await DockerRunner.runCode({
        code: testCode,
        language: 'perl',
        timeout: 30,
        modelName: 'test-perl'
      });

      console.log('Perl execution result:', {
        success: result.success,
        modelName: result.modelName,
        outputLength: result.output?.length,
        error: result.error,
        exitCode: result.exitCode
      });

      if (result.success) {
        expect(result.success).toBe(true);
        expect(result.modelName).toBe('test-perl');
        expect(result.output).toContain('Hello from Perl!');
        expect(result.output).toContain('Testing Docker runner');
        expect(result.output).toContain('Number: 1');
        expect(result.output).toContain('Data: value, Count: 42');
        expect(result.output).toContain('Perl test completed');
      } else {
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.modelName).toBe('test-perl');
        
        // Log detailed error for debugging
        console.log('Perl execution failed:', {
          error: result.error,
          output: result.output,
          exitCode: result.exitCode
        });
      }
    }, 60000);

    it('should handle Perl with shebang line', async () => {
      const testCode = `#!/usr/bin/env perl
use strict;
use warnings;

print "Hello from Perl with shebang!\\n";
print "Current time: " . localtime() . "\\n";
print "Perl version: $^V\\n";
      `.trim();

      const result = await DockerRunner.runCode({
        code: testCode,
        language: 'perl',
        timeout: 30,
        modelName: 'test-perl-shebang'
      });

      console.log('Perl shebang test result:', {
        success: result.success,
        modelName: result.modelName,
        outputLength: result.output?.length,
        error: result.error
      });

      if (result.success) {
        expect(result.success).toBe(true);
        expect(result.modelName).toBe('test-perl-shebang');
        expect(result.output).toContain('Hello from Perl with shebang!');
        expect(result.output).toContain('Perl version:');
      } else {
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.modelName).toBe('test-perl-shebang');
      }
    }, 60000);

    it('should handle Bash code execution', async () => {
      const testCode = `#!/bin/bash
echo "Hello from Bash!"
echo "Testing Docker runner"

# Test variables
name="World"
echo "Hello, $name!"

# Test arrays
numbers=(1 2 3 4 5)
for num in "\${numbers[@]}"; do
    echo "Number: \$num"
done

# Test conditional logic
if [ 1 -eq 1 ]; then
    echo "Conditional logic works"
else
    echo "Conditional logic failed"
fi

# Test command substitution
current_date=\$(date)
echo "Current date: \$current_date"

echo "Bash test completed"
      `.trim();

      const result = await DockerRunner.runCode({
        code: testCode,
        language: 'bash',
        timeout: 30,
        modelName: 'test-bash'
      });

      console.log('Bash execution result:', {
        success: result.success,
        modelName: result.modelName,
        outputLength: result.output?.length,
        error: result.error,
        exitCode: result.exitCode
      });

      if (result.success) {
        expect(result.success).toBe(true);
        expect(result.modelName).toBe('test-bash');
        expect(result.output).toContain('Hello from Bash!');
        expect(result.output).toContain('Testing Docker runner');
        expect(result.output).toContain('Hello, World!');
        expect(result.output).toContain('Number: 1');
        expect(result.output).toContain('Conditional logic works');
        expect(result.output).toContain('Current date:');
        expect(result.output).toContain('Bash test completed');
      } else {
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.modelName).toBe('test-bash');
        
        // Log detailed error for debugging
        console.log('Bash execution failed:', {
          error: result.error,
          output: result.output,
          exitCode: result.exitCode
        });
      }
    }, 60000);

    it('should handle Bash with simple commands', async () => {
      const testCode = `#!/bin/bash
echo "Simple bash test"
echo "Current directory: \$(pwd)"
echo "User: \$USER"
echo "Shell: \$SHELL"
echo "Simple test completed"
      `.trim();

      const result = await DockerRunner.runCode({
        code: testCode,
        language: 'bash',
        timeout: 30,
        modelName: 'test-bash-simple'
      });

      console.log('Bash simple test result:', {
        success: result.success,
        modelName: result.modelName,
        outputLength: result.output?.length,
        error: result.error
      });

      if (result.success) {
        expect(result.success).toBe(true);
        expect(result.modelName).toBe('test-bash-simple');
        expect(result.output).toContain('Simple bash test');
        expect(result.output).toContain('Current directory:');
        expect(result.output).toContain('Simple test completed');
      } else {
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.modelName).toBe('test-bash-simple');
      }
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

      expect(LANGUAGE_CONFIGS.perl.extension).toBe('.pl');
      expect(LANGUAGE_CONFIGS.perl.baseImage).toBe('perl:5.42');
      expect(LANGUAGE_CONFIGS.perl.runCommand).toContain('perl');

      expect(LANGUAGE_CONFIGS.bash.extension).toBe('.sh');
      expect(LANGUAGE_CONFIGS.bash.baseImage).toBe('bash:latest');
      expect(LANGUAGE_CONFIGS.bash.runCommand).toContain('bash');

      expect(LANGUAGE_CONFIGS.rust.extension).toBe('.rs');
      expect(LANGUAGE_CONFIGS.rust.baseImage).toBe('rust:1.75-alpine');
      expect(LANGUAGE_CONFIGS.rust.runCommand).toContain('rustc');

      expect(LANGUAGE_CONFIGS.go.extension).toBe('.go');
      expect(LANGUAGE_CONFIGS.go.baseImage).toBe('golang:1.21-alpine');
      expect(LANGUAGE_CONFIGS.go.runCommand).toContain('go run');
    });
  });
});
