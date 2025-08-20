/**
 * Docker Runner
 * Utilities for running code in Docker containers for different languages
 */

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

export interface LanguageConfig {
  extension: string;
  baseImage: string;
  runCommand: string;
  setupCommands?: string[];
}

export interface DockerRunConfig {
  code: string;
  language: string;
  timeout?: number;
  modelName?: string;
}

export interface DockerRunResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
  modelName?: string;
}

/**
 * Language configurations for different programming languages
 */
export const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  typescript: {
    extension: '.ts',
    baseImage: 'node:20-alpine',
    runCommand: 'npx tsx /app/code.ts',
    setupCommands: ['npm install -g tsx']
  },
  javascript: {
    extension: '.js',
    baseImage: 'node:20-alpine',
    runCommand: 'node /app/code.js'
  },
  python: {
    extension: '.py',
    baseImage: 'python:3.11-alpine',
    runCommand: 'python /app/code.py'
  },
  ruby: {
    extension: '.rb',
    baseImage: 'ruby:3.2-alpine',
    runCommand: 'ruby /app/code.rb'
  },
  perl: {
    extension: '.pl',
    baseImage: 'perl:5.38-alpine',
    runCommand: 'perl /app/code.pl'
  },
  bash: {
    extension: '.sh',
    baseImage: 'alpine:latest',
    runCommand: 'sh /app/code.sh',
    setupCommands: ['chmod +x /app/code.sh']
  },
  php: {
    extension: '.php',
    baseImage: 'php:8.2-alpine',
    runCommand: 'php /app/code.php'
  },
  java: {
    extension: '.java',
    baseImage: 'openjdk:17-alpine',
    runCommand: 'javac /app/code.java && java -cp /app Main'
  },
  rust: {
    extension: '.rs',
    baseImage: 'rust:1.75-alpine',
    runCommand: 'rustc /app/code.rs -o /app/code && /app/code'
  },
  go: {
    extension: '.go',
    baseImage: 'golang:1.21-alpine',
    runCommand: 'go run /app/code.go'
  }
};

/**
 * Docker Runner for executing code in isolated containers
 */
export class DockerRunner {
  /**
   * Runs code in a Docker container for the specified language
   */
  static async runCode(config: DockerRunConfig): Promise<DockerRunResult> {
    const { code, language, timeout = 30, modelName } = config;
    
    const langConfig = LANGUAGE_CONFIGS[language];
    if (!langConfig) {
      return {
        success: false,
        error: `Unsupported language: ${language}. Supported languages: ${Object.keys(LANGUAGE_CONFIGS).join(', ')}`,
        modelName
      };
    }

    let tempDir: string | undefined;
    
    try {
      // Create temporary directory for Docker build
      tempDir = await fs.promises.mkdtemp(path.join(process.cwd(), 'docker-temp-'));
      const codeFile = path.join(tempDir, `code${langConfig.extension}`);
      
      // Write code to file
      await fs.promises.writeFile(codeFile, code);
      
      // Create Dockerfile
      const dockerfile = this.generateDockerfile(langConfig);
      await fs.promises.writeFile(path.join(tempDir, 'Dockerfile'), dockerfile);
      
      // Build and run Docker container
      const result = await this.buildAndRun(tempDir, timeout, modelName);
      
      return result;
      
    } catch (error) {
      return {
        success: false,
        error: `Docker execution error: ${error instanceof Error ? error.message : String(error)}`,
        modelName
      };
    } finally {
      // Always clean up temporary directory
      if (tempDir) {
        try {
          await fs.promises.rm(tempDir, { recursive: true, force: true });
        } catch (cleanupError) {
          console.warn(`Failed to cleanup temporary directory ${tempDir}:`, cleanupError);
        }
      }
    }
  }

  /**
   * Generates a Dockerfile for the given language configuration
   */
  private static generateDockerfile(langConfig: LanguageConfig): string {
    let dockerfile = `FROM ${langConfig.baseImage}\n`;
    dockerfile += `WORKDIR /app\n`;
    
    // Copy code file first
    dockerfile += `COPY code${langConfig.extension} .\n`;
    
    // Add setup commands after copying (for things like chmod)
    if (langConfig.setupCommands) {
      langConfig.setupCommands.forEach(cmd => {
        dockerfile += `RUN ${cmd}\n`;
      });
    }
    
    // Set run command
    dockerfile += `CMD ["sh", "-c", "${langConfig.runCommand}"]\n`;
    
    return dockerfile;
  }

  /**
   * Builds and runs the Docker container
   */
  private static async buildAndRun(tempDir: string, timeout: number, modelName?: string): Promise<DockerRunResult> {
    const containerName = `code-runner-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // Build Docker image
      const buildCommand = `cd "${tempDir}" && docker build -t ${containerName} .`;
      const buildResult = await execAsync(buildCommand);
      
      // Check if build actually failed (Docker outputs build info to stderr even on success)
      if (buildResult.stderr && buildResult.stderr.includes('ERROR:')) {
        return {
          success: false,
          error: `Build failed: ${buildResult.stderr}`,
          modelName
        };
      }
      
      // Run Docker container with timeout
      const runCommand = `timeout ${timeout} docker run --rm --name ${containerName}-run ${containerName}`;
      const runResult = await execAsync(runCommand);
      
      return {
        success: true,
        output: runResult.stdout,
        exitCode: 0,
        modelName
      };
      
    } catch (error: any) {
      // Check if it's a timeout
      if (error.code === 124) {
              return {
        success: false,
        error: `Execution timed out after ${timeout} seconds`,
        modelName
      };
      }
      
      // Check if it's a Docker run error (non-zero exit code)
      if (error.stdout || error.stderr) {
              return {
        success: false,
        output: error.stdout,
        error: error.stderr,
        exitCode: error.code,
        modelName
      };
      }
      
      return {
        success: false,
        error: `Docker execution error: ${error.message}`,
        modelName
      };
      
    } finally {
      // Clean up Docker image
      try {
        await execAsync(`docker rmi ${containerName} 2>/dev/null || true`);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Gets the list of supported languages
   */
  static getSupportedLanguages(): string[] {
    return Object.keys(LANGUAGE_CONFIGS);
  }

  /**
   * Adds a new language configuration
   */
  static addLanguageConfig(language: string, config: LanguageConfig): void {
    LANGUAGE_CONFIGS[language] = config;
  }

  /**
   * Cleans up any leftover temporary directories from previous runs
   */
  static async cleanupTempDirectories(): Promise<void> {
    try {
      const files = await fs.promises.readdir(process.cwd());
      const tempDirs = files.filter(file => file.startsWith('docker-temp-'));
      
      for (const tempDir of tempDirs) {
        try {
          await fs.promises.rm(path.join(process.cwd(), tempDir), { recursive: true, force: true });
          console.log(`Cleaned up leftover temporary directory: ${tempDir}`);
        } catch (error) {
          console.warn(`Failed to cleanup temporary directory ${tempDir}:`, error);
        }
      }
    } catch (error) {
      console.warn('Failed to scan for temporary directories:', error);
    }
  }
}
