/**
 * Dagger-based code runner with LLM integration for dynamic container configuration
 *
 * This class replaces DockerRunner with a Dagger-based implementation that:
 * 1. Uses Dagger's LLM integration to dynamically configure containers for any language
 * 2. Automatically detects required packages and installs them
 * 3. Caches container configurations to avoid repeated LLM calls
 * 4. Maintains backward compatibility with the DockerRunner interface
 */

import { dag, connection, type Container } from '@dagger.io/dagger';
import type { DaggerRunConfig, DaggerRunResult, ContainerConfig } from './dagger/types.js';
import { LLMContainerBuilder } from './dagger/llm-container-builder.js';
import { getExtension, getKnownLanguages } from './dagger/language-detector.js';

// Re-export types for backward compatibility
export type { DaggerRunConfig, DaggerRunResult, ContainerConfig };

// Backward compatibility types (alias to old names)
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
 * Dagger-based code runner that uses LLM integration for dynamic container configuration
 *
 * This class maintains the same interface as DockerRunner for backward compatibility
 * while leveraging Dagger's caching, LLM integration, and cleaner container management.
 */
export class DaggerRunner {
  private static containerBuilder: LLMContainerBuilder | null = null;

  /**
   * Gets or creates the container builder singleton
   */
  private static getContainerBuilder(): LLMContainerBuilder {
    if (!this.containerBuilder) {
      this.containerBuilder = new LLMContainerBuilder();
    }
    return this.containerBuilder;
  }

  /**
   * Runs code in a Dagger container
   *
   * @param config - Configuration for the code execution
   * @returns Result of the execution
   */
  static async runCode(config: DaggerRunConfig): Promise<DaggerRunResult> {
    const { code, language, timeout = 30, modelName, useAIConfig = false } = config;
    const startTime = Date.now();

    try {
      // Get container configuration (from cache, static config, or LLM)
      const builder = this.getContainerBuilder();
      const { config: containerConfig, cached } = await builder.getContainerConfig(
        code,
        language.toLowerCase(),
        useAIConfig
      );

      // Execute code in container
      const result = await this.executeInContainer(
        code,
        language.toLowerCase(),
        containerConfig,
        timeout
      );

      return {
        ...result,
        modelName,
        containerConfig,
        cached,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: `Dagger execution error: ${error instanceof Error ? error.message : String(error)}`,
        modelName,
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Executes code in a configured Dagger container
   */
  private static async executeInContainer(
    code: string,
    language: string,
    config: ContainerConfig,
    timeout: number
  ): Promise<DaggerRunResult> {
    let output = '';
    let error = '';
    let exitCode = 0;

    try {
      await connection(
        async () => {
          const extension = getExtension(language);
          const codeFile = `/app/code${extension}`;

          // Start with base container
          let container: Container = dag
            .container()
            .from(config.baseImage)
            .withWorkdir(config.workdir || '/app');

          // Mount cache volumes for package managers
          if (config.cacheVolumes && config.cacheVolumes.length > 0) {
            for (const vol of config.cacheVolumes) {
              const cacheVol = dag.cacheVolume(vol.name);
              container = container.withMountedCache(vol.mountPath, cacheVol);
            }
          }

          // Set environment variables
          if (config.environment) {
            for (const [key, value] of Object.entries(config.environment)) {
              container = container.withEnvVariable(key, value);
            }
          }

          // Add the code file
          container = container.withNewFile(codeFile, code);

          // Run setup commands
          if (config.setupCommands && config.setupCommands.length > 0) {
            for (const cmd of config.setupCommands) {
              // Parse command string into shell execution
              container = container.withExec(['sh', '-c', cmd]);
            }
          }

          // Build the run command with timeout wrapper
          const runCmd = this.buildTimeoutCommand(config.runCommand, timeout);

          // Execute with error capture
          try {
            container = container.withExec(runCmd);
            output = await container.stdout();
            error = await container.stderr();
            exitCode = 0;
          } catch (execError: any) {
            // Try to extract output even on failure
            try {
              output = await container.stdout();
            } catch {
              output = '';
            }
            try {
              error = await container.stderr();
            } catch {
              error = execError.message || String(execError);
            }
            exitCode = 1;

            // Check for timeout
            if (
              error.includes('timeout') ||
              error.includes('124') ||
              execError.message?.includes('timeout')
            ) {
              exitCode = 124;
            }
          }
        },
        { LogOutput: process.stderr }
      );

      // Check for timeout (exit code 124)
      if (exitCode === 124) {
        return {
          success: false,
          output,
          error: `Execution timed out after ${timeout} seconds`,
          exitCode,
        };
      }

      return {
        success: exitCode === 0,
        output: output.trim(),
        error: exitCode !== 0 ? error.trim() : undefined,
        exitCode,
      };
    } catch (connectionError) {
      const errorMessage =
        connectionError instanceof Error ? connectionError.message : String(connectionError);

      // Check for timeout indicators
      if (errorMessage.includes('124') || errorMessage.includes('timed out')) {
        return {
          success: false,
          error: `Execution timed out after ${timeout} seconds`,
          exitCode: 124,
        };
      }

      return {
        success: false,
        error: errorMessage,
        exitCode: 1,
      };
    }
  }

  /**
   * Builds a command with timeout wrapper
   */
  private static buildTimeoutCommand(runCommand: string[], timeout: number): string[] {
    const cmdString = runCommand.join(' ');
    return [
      'sh',
      '-c',
      `timeout ${timeout} ${cmdString} 2>&1 || (exit_code=$?; [ $exit_code -eq 124 ] && echo "Execution timed out" && exit 124; exit $exit_code)`,
    ];
  }

  /**
   * Gets the list of supported languages (both static and dynamically configurable)
   */
  static getSupportedLanguages(): string[] {
    return getKnownLanguages();
  }

  /**
   * Gets cache statistics
   */
  static getCacheStats() {
    return this.getContainerBuilder().getCacheStats();
  }

  /**
   * Clears all caches (config cache)
   */
  static clearCache(): void {
    this.getContainerBuilder().clearCache();
  }
}

/**
 * Backward compatibility: Export DockerRunner as alias to DaggerRunner
 * This allows existing code to continue working without changes
 */
export const DockerRunner = DaggerRunner;
