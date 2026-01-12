/**
 * Type definitions for Dagger-based code runner
 */

/**
 * Configuration for running code in Dagger containers
 * Maintains backward compatibility with DockerRunConfig
 */
export interface DaggerRunConfig {
  code: string;
  language: string;
  timeout?: number; // Default: 30 seconds
  modelName?: string; // For tracking which model generated this code
  packages?: string[]; // Optional package hints
  useAIConfig?: boolean; // Force AI-based container configuration
}

/**
 * Result of running code in a Dagger container
 * Maintains backward compatibility with DockerRunResult
 */
export interface DaggerRunResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
  modelName?: string;
  containerConfig?: ContainerConfig; // Optional: the config used
  cached?: boolean; // Whether config was cached
  executionTime?: number; // Execution duration in ms
}

/**
 * LLM-generated container configuration
 */
export interface ContainerConfig {
  baseImage: string; // e.g., "python:3.11-alpine"
  setupCommands: string[]; // Commands to run before code execution
  runCommand: string[]; // Command to execute the code
  environment?: Record<string, string>; // Environment variables
  workdir?: string; // Working directory (default: /app)
  cacheVolumes?: CacheVolumeConfig[]; // Cache volumes for dependencies
}

/**
 * Cache volume configuration for package managers
 */
export interface CacheVolumeConfig {
  name: string; // Cache volume name
  mountPath: string; // Where to mount in container
}

/**
 * Cache entry for container configurations
 */
export interface ContainerConfigCacheEntry {
  config: ContainerConfig;
  language: string;
  packages: string[];
  createdAt: Date;
  hitCount: number;
  lastAccessed: Date;
}
