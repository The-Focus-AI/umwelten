import path from 'path';
import fs from 'fs';
import { ModelDetails, ModelResponse } from '../../cognition/types.js';

/**
 * Configuration for the EvaluationCache
 */
export interface CacheConfig {
  /** Base directory for all cache files */
  baseDir?: string;
  /** Whether to enable verbose logging */
  verbose?: boolean;
  /** Maximum age for cached files in milliseconds (default: no expiration) */
  maxAge?: number;
}

/**
 * Statistics about cache usage
 */
export interface CacheStats {
  hits: number;
  misses: number;
  errors: number;
  totalRequests: number;
  hitRate: number;
}

/**
 * Comprehensive caching service for evaluation data
 * 
 * Provides caching for:
 * - Model responses
 * - External data (HTML, API responses)
 * - Scores and analysis results
 * - Generic file data
 * 
 * All cache operations are organized by evaluation ID and data type.
 */
export class EvaluationCache {
  private evaluationId: string;
  private config: Required<CacheConfig>;
  private stats: CacheStats;

  constructor(evaluationId: string, config: CacheConfig = {}) {
    this.evaluationId = evaluationId;
    this.config = {
      baseDir: config.baseDir || path.join(process.cwd(), 'output', 'evaluations'),
      verbose: config.verbose || false,
      maxAge: config.maxAge || 0, // 0 means no expiration
    };
    this.stats = {
      hits: 0,
      misses: 0,
      errors: 0,
      totalRequests: 0,
      hitRate: 0,
    };
  }

  /**
   * Get the working directory for this evaluation
   */
  getWorkdir(): string {
    const workdir = path.join(this.config.baseDir, this.evaluationId);
    if (!fs.existsSync(workdir)) {
      fs.mkdirSync(workdir, { recursive: true });
    }
    return workdir;
  }

  /**
   * Generic file caching with automatic directory management
   * 
   * @param key - Unique key for this cached data
   * @param fetch - Function to fetch data if not cached
   * @returns Cached or freshly fetched data
   */
  async getCachedFile<T>(key: string, fetch: () => Promise<T>): Promise<T> {
    this.stats.totalRequests++;
    
    try {
      const filePath = this.getFilePath(key);
      
      // Check if file exists and is not expired
      if (this.isFileValid(filePath)) {
        this.stats.hits++;
        this.updateHitRate();
        
        if (this.config.verbose) {
          console.log(`Cache hit for key: ${key}`);
        }
        
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content);
      }
      
      // File doesn't exist or is expired, fetch new data
      this.stats.misses++;
      this.updateHitRate();
      
      if (this.config.verbose) {
        console.log(`Cache miss for key: ${key}, fetching...`);
      }
      
      const data = await fetch();
      
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Write to cache
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      
      return data;
    } catch (error) {
      this.stats.errors++;
      this.updateHitRate();
      
      if (this.config.verbose) {
        console.error(`Cache error for key: ${key}:`, error);
      }
      
      // If caching fails, still try to fetch the data
      return await fetch();
    }
  }

  /**
   * Cache model responses with automatic file naming
   * 
   * @param model - Model details for naming the cache file
   * @param stimulusId - Stimulus identifier for organization
   * @param fetch - Function to fetch model response if not cached
   * @returns Cached or freshly fetched model response
   */
  async getCachedModelResponse(
    model: ModelDetails, 
    stimulusId: string, 
    fetch: () => Promise<ModelResponse>
  ): Promise<ModelResponse> {
    const key = `responses/${stimulusId}/${this.getModelKey(model)}`;
    return this.getCachedFile(key, fetch);
  }

  /**
   * Cache scores and analysis results
   * 
   * @param model - Model details for naming the cache file
   * @param stimulusId - Stimulus identifier for organization
   * @param scoreType - Type of score (e.g., 'quality', 'accuracy')
   * @param fetch - Function to fetch score if not cached
   * @returns Cached or freshly fetched score
   */
  async getCachedScore(
    model: ModelDetails, 
    stimulusId: string, 
    scoreType: string, 
    fetch: () => Promise<any>
  ): Promise<any> {
    const key = `scores/${stimulusId}/${scoreType}/${this.getModelKey(model)}`;
    return this.getCachedFile(key, fetch);
  }

  /**
   * Cache external data (HTML, API responses, etc.)
   * 
   * @param dataType - Type of external data (e.g., 'html', 'api', 'json')
   * @param identifier - Unique identifier for this data (e.g., URL, filename)
   * @param fetch - Function to fetch external data if not cached
   * @returns Cached or freshly fetched external data
   */
  async getCachedExternalData(
    dataType: string, 
    identifier: string, 
    fetch: () => Promise<string>
  ): Promise<string> {
    const key = `external/${dataType}/${this.sanitizeIdentifier(identifier)}`;
    return this.getCachedFile(key, async () => {
      const data = await fetch();
      return { content: data, timestamp: new Date().toISOString() };
    }).then(result => result.content);
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Clear all cache files for this evaluation
   */
  clearCache(): void {
    const workdir = this.getWorkdir();
    if (fs.existsSync(workdir)) {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
    this.stats = {
      hits: 0,
      misses: 0,
      errors: 0,
      totalRequests: 0,
      hitRate: 0,
    };
  }

  /**
   * Get the file path for a given cache key
   */
  private getFilePath(key: string): string {
    return path.join(this.getWorkdir(), `${key}.json`);
  }

  /**
   * Check if a file exists and is not expired
   */
  private isFileValid(filePath: string): boolean {
    if (!fs.existsSync(filePath)) {
      return false;
    }

    // If no max age is set, file is always valid
    if (this.config.maxAge === 0) {
      return true;
    }

    // Check if file is within max age
    const stats = fs.statSync(filePath);
    const age = Date.now() - stats.mtime.getTime();
    return age < this.config.maxAge;
  }

  /**
   * Generate a consistent key for a model
   */
  private getModelKey(model: ModelDetails): string {
    return `${model.name.replace('/', '-')}-${model.provider}`;
  }

  /**
   * Sanitize identifier for use in file paths
   */
  private sanitizeIdentifier(identifier: string): string {
    return identifier
      .replace(/[^a-zA-Z0-9.-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Update hit rate calculation
   */
  private updateHitRate(): void {
    if (this.stats.totalRequests > 0) {
      this.stats.hitRate = this.stats.hits / this.stats.totalRequests;
    }
  }
}
