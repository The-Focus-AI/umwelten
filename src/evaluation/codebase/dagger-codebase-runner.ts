/**
 * Dagger codebase runner - runs validation commands on full codebases in containers
 *
 * This extends the DaggerRunner pattern to:
 * 1. Mount entire codebase directories using dag.host().directory()
 * 2. Automatically detect and install dependencies (npm, pip, cargo, etc.)
 * 3. Run validation commands (test, build, lint) in isolated containers
 * 4. Report detailed results with timing and output capture
 */

import { dag, connection, type Container } from '@dagger.io/dagger';
import { detectProjectType } from './context-provider.js';
import type {
  CodebaseConfig,
  ValidationCommand,
  ValidationResult,
  ApplicationResult,
} from './types.js';

/**
 * Configuration for running validation in Dagger
 */
export interface DaggerCodebaseRunConfig {
  /** Path to the codebase (or working directory from ApplicationResult) */
  codebasePath: string;

  /** Project type (auto-detected if not provided) */
  projectType?: string;

  /** Validation commands to run */
  validations: ValidationCommand[];

  /** Whether to run setup commands (npm install, etc.) */
  runSetup?: boolean;

  /** Custom setup commands (overrides auto-detected) */
  customSetupCommands?: string[];

  /** Global timeout for entire validation run (seconds) */
  globalTimeout?: number;

  /** Whether to continue on validation failures */
  continueOnFailure?: boolean;
}

/**
 * Result of running all validations on a codebase
 */
export interface DaggerCodebaseRunResult {
  /** Whether all validations passed */
  success: boolean;

  /** Individual validation results */
  validations: ValidationResult[];

  /** Project type that was detected/used */
  projectType: string;

  /** Setup commands that were run */
  setupCommands: string[];

  /** Total execution time (ms) */
  totalDuration: number;

  /** Overall error if catastrophic failure */
  error?: string;
}

/**
 * Base images for different project types
 */
const PROJECT_BASE_IMAGES: Record<string, string> = {
  npm: 'node:20-alpine',
  pip: 'python:3.11-alpine',
  cargo: 'rust:1.75-alpine',
  go: 'golang:1.21-alpine',
  maven: 'maven:3.9-eclipse-temurin-17-alpine',
  gradle: 'gradle:8.5-jdk17-alpine',
  unknown: 'ubuntu:22.04',
};

/**
 * Default setup commands for project types
 */
const PROJECT_SETUP_COMMANDS: Record<string, string[]> = {
  npm: ['npm install'],
  pip: ['pip install -r requirements.txt || pip install -e . || true'],
  cargo: ['cargo fetch'],
  go: ['go mod download'],
  maven: ['mvn dependency:resolve'],
  gradle: ['gradle dependencies'],
  unknown: [],
};

/**
 * Cache volume configurations for project types
 */
const PROJECT_CACHE_VOLUMES: Record<
  string,
  Array<{ name: string; mountPath: string }>
> = {
  npm: [
    { name: 'npm-cache', mountPath: '/root/.npm' },
    { name: 'node-modules', mountPath: '/app/node_modules' },
  ],
  pip: [
    { name: 'pip-cache', mountPath: '/root/.cache/pip' },
    { name: 'python-packages', mountPath: '/usr/local/lib/python3.11/site-packages' },
  ],
  cargo: [
    { name: 'cargo-registry', mountPath: '/usr/local/cargo/registry' },
    { name: 'cargo-git', mountPath: '/usr/local/cargo/git' },
    { name: 'cargo-target', mountPath: '/app/target' },
  ],
  go: [
    { name: 'go-mod-cache', mountPath: '/go/pkg/mod' },
    { name: 'go-build-cache', mountPath: '/root/.cache/go-build' },
  ],
  maven: [{ name: 'maven-repo', mountPath: '/root/.m2/repository' }],
  gradle: [{ name: 'gradle-cache', mountPath: '/root/.gradle' }],
  unknown: [],
};

/**
 * Runs codebase validations in Dagger containers
 */
export class DaggerCodebaseRunner {
  /**
   * Run validation commands on a codebase
   */
  static async runValidations(
    config: DaggerCodebaseRunConfig
  ): Promise<DaggerCodebaseRunResult> {
    const startTime = Date.now();
    const {
      codebasePath,
      validations,
      runSetup = true,
      customSetupCommands,
      globalTimeout,
      continueOnFailure = false,
    } = config;

    try {
      // Detect project type if not provided
      const projectType = config.projectType || (await detectProjectType(codebasePath));

      // Determine setup commands
      const setupCommands =
        customSetupCommands ||
        (runSetup ? PROJECT_SETUP_COMMANDS[projectType] || [] : []);

      // Run validations in Dagger
      const validationResults = await this.executeValidations(
        codebasePath,
        projectType,
        setupCommands,
        validations,
        globalTimeout,
        continueOnFailure
      );

      // Check overall success
      const success = validationResults.every(v => v.passed);

      return {
        success,
        validations: validationResults,
        projectType,
        setupCommands,
        totalDuration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        validations: [],
        projectType: config.projectType || 'unknown',
        setupCommands: [],
        totalDuration: Date.now() - startTime,
        error: `Dagger validation error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Execute validations in a Dagger container
   */
  private static async executeValidations(
    codebasePath: string,
    projectType: string,
    setupCommands: string[],
    validations: ValidationCommand[],
    globalTimeout?: number,
    continueOnFailure = false
  ): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    await connection(
      async () => {
        // Select base image
        const baseImage = PROJECT_BASE_IMAGES[projectType] || PROJECT_BASE_IMAGES.unknown;

        // Start with base container
        let container: Container = dag
          .container()
          .from(baseImage)
          .withWorkdir('/app');

        // Mount the codebase directory from host
        const hostDir = dag.host().directory(codebasePath, {
          exclude: [
            'node_modules',
            'dist',
            'build',
            'target',
            '.git',
            '__pycache__',
            '*.pyc',
            'venv',
            '.venv',
            'env',
          ],
        });
        container = container.withDirectory('/app', hostDir);

        // Mount cache volumes for dependencies
        const cacheVolumes = PROJECT_CACHE_VOLUMES[projectType] || [];
        for (const vol of cacheVolumes) {
          const cacheVol = dag.cacheVolume(vol.name);
          container = container.withMountedCache(vol.mountPath, cacheVol);
        }

        // Run setup commands
        for (const cmd of setupCommands) {
          try {
            container = container.withExec(['sh', '-c', cmd]);
            // Force execution to catch setup errors
            await container.stdout();
          } catch (error) {
            // Setup failure - could be OK if dependencies are optional
            console.warn(`Setup command failed: ${cmd}`, error);
          }
        }

        // Run each validation command
        for (const validation of validations) {
          const result = await this.runValidationCommand(
            container,
            validation,
            globalTimeout
          );

          results.push(result);

          // Stop on first failure if not continuing
          if (!continueOnFailure && !result.passed) {
            break;
          }
        }
      },
      { LogOutput: process.stderr }
    );

    return results;
  }

  /**
   * Run a single validation command
   */
  private static async runValidationCommand(
    baseContainer: Container,
    validation: ValidationCommand,
    globalTimeout?: number
  ): Promise<ValidationResult> {
    const {
      name,
      command,
      workdir = '/app',
      timeout = 60,
      expectedExitCode = 0,
      outputMustMatch = [],
      outputMustNotMatch = [],
    } = validation;

    const effectiveTimeout = globalTimeout || timeout;
    const startTime = Date.now();

    let container = baseContainer;

    // Set working directory if different
    if (workdir !== '/app') {
      container = container.withWorkdir(workdir);
    }

    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let timedOut = false;
    const failures: string[] = [];

    try {
      // Build timeout command
      const timeoutCmd = [
        'sh',
        '-c',
        `timeout ${effectiveTimeout} ${command} 2>&1 || exit $?`,
      ];

      // Execute command
      container = container.withExec(timeoutCmd);

      try {
        stdout = await container.stdout();
        exitCode = 0;
      } catch (error: any) {
        // Command failed - try to get output
        try {
          stdout = await container.stdout();
        } catch {
          stdout = '';
        }

        // Check if it was a timeout (exit code 124)
        if (
          error.message?.includes('124') ||
          error.message?.includes('timeout') ||
          error.message?.includes('timed out')
        ) {
          exitCode = 124;
          timedOut = true;
          failures.push(`Command timed out after ${effectiveTimeout}s`);
        } else {
          // Extract exit code from error if possible
          const exitCodeMatch = error.message?.match(/exit code: (\d+)/);
          exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : 1;
        }

        stderr = error.message || String(error);
      }

      // Check exit code
      if (exitCode !== expectedExitCode && !timedOut) {
        failures.push(
          `Expected exit code ${expectedExitCode}, got ${exitCode}`
        );
      }

      // Check output patterns
      const combinedOutput = stdout + '\n' + stderr;

      for (const pattern of outputMustMatch) {
        const regex = new RegExp(pattern);
        if (!regex.test(combinedOutput)) {
          failures.push(`Output must match pattern: ${pattern}`);
        }
      }

      for (const pattern of outputMustNotMatch) {
        const regex = new RegExp(pattern);
        if (regex.test(combinedOutput)) {
          failures.push(`Output must not match pattern: ${pattern}`);
        }
      }
    } catch (error) {
      // Catastrophic failure
      exitCode = 1;
      stderr = error instanceof Error ? error.message : String(error);
      failures.push(`Execution failed: ${stderr}`);
    }

    const passed = failures.length === 0 && exitCode === expectedExitCode;
    const duration = Date.now() - startTime;

    return {
      name,
      command,
      passed,
      exitCode,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      duration,
      timedOut,
      failures: failures.length > 0 ? failures : undefined,
    };
  }

  /**
   * Convenience method: run validations on an ApplicationResult
   */
  static async runValidationsOnApplication(
    applicationResult: ApplicationResult,
    validations: ValidationCommand[],
    projectType?: string
  ): Promise<DaggerCodebaseRunResult> {
    return this.runValidations({
      codebasePath: applicationResult.workdir,
      validations,
      projectType,
      runSetup: true,
    });
  }
}
