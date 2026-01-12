/**
 * LLM-based container configuration builder using Dagger's LLM integration
 */

import { dag, connection } from '@dagger.io/dagger';
import type { ContainerConfig } from './types.js';
import { CONTAINER_CONFIG_PROMPT } from './prompts.js';
import { ContainerConfigCache } from './container-config-cache.js';
import {
  detectPackages,
  isKnownLanguage,
  getStaticConfig,
  getExtension,
} from './language-detector.js';

/**
 * Builds container configurations using Dagger's LLM integration
 */
export class LLMContainerBuilder {
  private cache: ContainerConfigCache;

  constructor(cacheDir?: string) {
    this.cache = new ContainerConfigCache(cacheDir);
  }

  /**
   * Gets or builds container configuration for code execution
   */
  async getContainerConfig(
    code: string,
    language: string,
    forceAI: boolean = false
  ): Promise<{ config: ContainerConfig; cached: boolean }> {
    // Detect packages first
    const packages = detectPackages(code, language);

    // Check cache first
    const cached = await this.cache.get(language, packages);
    if (cached && !forceAI) {
      return { config: cached, cached: true };
    }

    // For known languages with no external packages, use static config
    if (isKnownLanguage(language) && packages.length === 0 && !forceAI) {
      const staticConfig = getStaticConfig(language);
      if (staticConfig) {
        await this.cache.set(language, packages, staticConfig);
        return { config: staticConfig, cached: false };
      }
    }

    // Use LLM to generate configuration
    const config = await this.buildConfigWithLLM(code, language, packages);

    // Cache the result
    await this.cache.set(language, packages, config);

    return { config, cached: false };
  }

  /**
   * Uses Dagger's LLM integration to build container configuration
   */
  private async buildConfigWithLLM(
    code: string,
    language: string,
    detectedPackages: string[]
  ): Promise<ContainerConfig> {
    let configJson: string = '';

    try {
      await connection(
        async () => {
          // Build the prompt
          const prompt = CONTAINER_CONFIG_PROMPT.replace('{{language}}', language)
            .replace('{{code}}', code.slice(0, 2000)) // Limit code size
            .replace(
              '{{detectedPackages}}',
              detectedPackages.length > 0 ? detectedPackages.join(', ') : 'none detected'
            );

          // Create environment for LLM
          const env = dag
            .env()
            .withStringInput('prompt', prompt, 'The container configuration request')
            .withStringOutput('config', 'The JSON configuration response');

          // Use LLM to generate config
          const llm = dag.llm().withEnv(env).withPrompt(prompt);

          // Get the response
          configJson = await llm.lastReply();
        },
        { LogOutput: process.stderr }
      );

      // Parse the LLM response
      return this.parseConfigResponse(configJson, language, detectedPackages);
    } catch (error) {
      console.warn(`LLM config generation failed, using fallback:`, error);
      return this.getFallbackConfig(language, detectedPackages);
    }
  }

  /**
   * Parses LLM response into ContainerConfig
   */
  private parseConfigResponse(
    response: string,
    language: string,
    detectedPackages: string[]
  ): ContainerConfig {
    try {
      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || response.match(/(\{[\s\S]*\})/);

      if (!jsonMatch) {
        throw new Error('No JSON found in LLM response');
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr.trim());

      return {
        baseImage: parsed.baseImage || this.getDefaultImage(language),
        setupCommands: parsed.setupCommands || [],
        runCommand: parsed.runCommand || this.getDefaultRunCommand(language),
        cacheVolumes: parsed.cacheVolumes || [],
        workdir: parsed.workdir || '/app',
        environment: parsed.environment,
      };
    } catch (error) {
      console.warn(`Failed to parse LLM config response:`, error);
      return this.getFallbackConfig(language, detectedPackages);
    }
  }

  /**
   * Gets fallback configuration when LLM fails
   */
  private getFallbackConfig(language: string, detectedPackages: string[]): ContainerConfig {
    // Try static config first
    const staticConfig = getStaticConfig(language);
    if (staticConfig) {
      // Add package installation if we detected packages
      if (detectedPackages.length > 0) {
        const packageInstall = this.getPackageInstallCommand(language, detectedPackages);
        if (packageInstall) {
          return {
            ...staticConfig,
            setupCommands: [...staticConfig.setupCommands, packageInstall],
          };
        }
      }
      return staticConfig;
    }

    // Last resort: generic config
    return {
      baseImage: this.getDefaultImage(language),
      setupCommands: [],
      runCommand: this.getDefaultRunCommand(language),
      cacheVolumes: [],
      workdir: '/app',
    };
  }

  /**
   * Gets default image for a language
   */
  private getDefaultImage(language: string): string {
    const defaultImages: Record<string, string> = {
      typescript: 'node:20-alpine',
      javascript: 'node:20-alpine',
      python: 'python:3.11-alpine',
      ruby: 'ruby:3.2-alpine',
      go: 'golang:1.21-alpine',
      rust: 'rust:1.75-alpine',
      java: 'openjdk:17-alpine',
      php: 'php:8.2-alpine',
      perl: 'perl:5.42',
      bash: 'bash:latest',
      swift: 'swift:5.9-focal',
    };

    return defaultImages[language] || `${language}:latest`;
  }

  /**
   * Gets default run command for a language
   */
  private getDefaultRunCommand(language: string): string[] {
    const extension = getExtension(language);
    const codeFile = `/app/code${extension}`;

    const defaultCommands: Record<string, string[]> = {
      typescript: ['npx', 'tsx', codeFile],
      javascript: ['node', codeFile],
      python: ['python', codeFile],
      ruby: ['ruby', codeFile],
      go: ['go', 'run', codeFile],
      rust: ['/app/code'], // Assumes compiled
      java: ['java', '-cp', '/app', 'Main'],
      php: ['php', codeFile],
      perl: ['perl', codeFile],
      bash: ['bash', codeFile],
      swift: ['swift', codeFile],
    };

    return defaultCommands[language] || [language, codeFile];
  }

  /**
   * Gets package install command for a language
   */
  private getPackageInstallCommand(language: string, packages: string[]): string | null {
    if (packages.length === 0) return null;

    const pkgList = packages.join(' ');

    switch (language) {
      case 'python':
        return `pip install --no-cache-dir ${pkgList}`;
      case 'typescript':
      case 'javascript':
        return `npm install ${pkgList}`;
      case 'ruby':
        return `gem install ${pkgList}`;
      default:
        return null;
    }
  }

  /**
   * Gets cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Clears the configuration cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}
