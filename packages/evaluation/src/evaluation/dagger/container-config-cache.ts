/**
 * Cache for LLM-generated container configurations
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ContainerConfig, ContainerConfigCacheEntry } from './types.js';

/**
 * Cache for LLM-generated container configurations
 * Stores configs by language + packages hash
 */
export class ContainerConfigCache {
  private cacheDir: string;
  private memoryCache: Map<string, ContainerConfigCacheEntry>;
  private maxMemoryCacheSize: number;

  constructor(cacheDir?: string, maxMemoryCacheSize = 100) {
    this.cacheDir = cacheDir || path.join(process.cwd(), '.dagger-cache', 'configs');
    this.memoryCache = new Map();
    this.maxMemoryCacheSize = maxMemoryCacheSize;

    // Ensure cache directory exists
    this.ensureCacheDir();
  }

  /**
   * Ensures the cache directory exists
   */
  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Generates a cache key from language and packages
   */
  private generateKey(language: string, packages: string[]): string {
    const sortedPackages = [...packages].sort().join(',');
    const data = `${language}:${sortedPackages}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  /**
   * Gets cached config or returns null
   */
  async get(language: string, packages: string[]): Promise<ContainerConfig | null> {
    const key = this.generateKey(language, packages);

    // Check memory cache first
    if (this.memoryCache.has(key)) {
      const entry = this.memoryCache.get(key)!;
      entry.hitCount++;
      entry.lastAccessed = new Date();
      return entry.config;
    }

    // Check disk cache
    const filePath = path.join(this.cacheDir, `${key}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const entry: ContainerConfigCacheEntry = {
          config: data.config,
          language: data.language,
          packages: data.packages,
          createdAt: new Date(data.createdAt),
          hitCount: data.hitCount + 1,
          lastAccessed: new Date(),
        };

        // Update disk cache with new hit count
        fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));

        // Add to memory cache
        this.addToMemoryCache(key, entry);

        return entry.config;
      } catch (error) {
        console.warn(`Failed to read cache file ${filePath}:`, error);
        return null;
      }
    }

    return null;
  }

  /**
   * Stores config in cache
   */
  async set(language: string, packages: string[], config: ContainerConfig): Promise<void> {
    const key = this.generateKey(language, packages);

    const entry: ContainerConfigCacheEntry = {
      config,
      language,
      packages,
      createdAt: new Date(),
      hitCount: 1,
      lastAccessed: new Date(),
    };

    // Store in memory cache
    this.addToMemoryCache(key, entry);

    // Store on disk
    this.ensureCacheDir();
    const filePath = path.join(this.cacheDir, `${key}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
    } catch (error) {
      console.warn(`Failed to write cache file ${filePath}:`, error);
    }
  }

  /**
   * Adds entry to memory cache with LRU eviction
   */
  private addToMemoryCache(key: string, entry: ContainerConfigCacheEntry): void {
    if (this.memoryCache.size >= this.maxMemoryCacheSize) {
      // Evict least recently accessed entry
      let oldestKey: string | null = null;
      let oldestTime = Date.now();

      this.memoryCache.forEach((v, k) => {
        if (v.lastAccessed.getTime() < oldestTime) {
          oldestTime = v.lastAccessed.getTime();
          oldestKey = k;
        }
      });

      if (oldestKey) {
        this.memoryCache.delete(oldestKey);
      }
    }

    this.memoryCache.set(key, entry);
  }

  /**
   * Clears all cached configurations
   */
  clear(): void {
    this.memoryCache.clear();

    if (fs.existsSync(this.cacheDir)) {
      try {
        const files = fs.readdirSync(this.cacheDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(this.cacheDir, file));
          }
        }
      } catch (error) {
        console.warn('Failed to clear cache directory:', error);
      }
    }
  }

  /**
   * Gets cache statistics
   */
  getStats(): { memorySize: number; diskSize: number; cacheDir: string } {
    let diskSize = 0;
    if (fs.existsSync(this.cacheDir)) {
      try {
        const files = fs.readdirSync(this.cacheDir);
        diskSize = files.filter((f) => f.endsWith('.json')).length;
      } catch {
        // Ignore errors
      }
    }

    return {
      memorySize: this.memoryCache.size,
      diskSize,
      cacheDir: this.cacheDir,
    };
  }
}
