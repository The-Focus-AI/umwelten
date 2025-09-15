import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EvaluationCache } from './cache-service.js';
import { ModelDetails } from '../../cognition/types.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('EvaluationCache', () => {
  let cache: EvaluationCache;
  let testDir: string;
  let mockModel: ModelDetails;

  beforeEach(() => {
    // Create a unique test directory for each test
    testDir = path.join(__dirname, '..', '..', '..', 'test-output', `cache-test-${Date.now()}`);
    cache = new EvaluationCache('test-evaluation', {
      baseDir: testDir,
      verbose: false,
      maxAge: 0, // No expiration for tests
    });
    
    mockModel = {
      name: 'test-model',
      provider: 'test-provider',
      contextLength: 4096,
      costs: {
        promptTokens: 0.001,
        completionTokens: 0.002,
      },
    };
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create cache with default config', () => {
      const defaultCache = new EvaluationCache('test');
      expect(defaultCache).toBeDefined();
    });

    it('should create cache with custom config', () => {
      const customCache = new EvaluationCache('test', {
        baseDir: '/custom/path',
        verbose: true,
        maxAge: 1000,
      });
      expect(customCache).toBeDefined();
    });
  });

  describe('getWorkdir', () => {
    it('should create and return working directory', () => {
      const workdir = cache.getWorkdir();
      expect(workdir).toBe(path.join(testDir, 'test-evaluation'));
      expect(fs.existsSync(workdir)).toBe(true);
    });

    it('should return same directory on multiple calls', () => {
      const workdir1 = cache.getWorkdir();
      const workdir2 = cache.getWorkdir();
      expect(workdir1).toBe(workdir2);
    });
  });

  describe('getCachedFile', () => {
    it('should fetch and cache data on first call', async () => {
      const key = 'test-data';
      const testData = { message: 'Hello, World!', timestamp: Date.now() };
      
      const fetchFn = vi.fn().mockResolvedValue(testData);
      
      const result = await cache.getCachedFile(key, fetchFn);
      
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual(testData);
      
      // Check that file was created
      const filePath = path.join(cache.getWorkdir(), `${key}.json`);
      expect(fs.existsSync(filePath)).toBe(true);
      
      const cachedData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(cachedData).toEqual(testData);
    });

    it('should return cached data on second call', async () => {
      const key = 'test-data';
      const testData = { message: 'Cached data' };
      
      const fetchFn = vi.fn().mockResolvedValue(testData);
      
      // First call
      await cache.getCachedFile(key, fetchFn);
      
      // Second call
      const result = await cache.getCachedFile(key, fetchFn);
      
      expect(fetchFn).toHaveBeenCalledTimes(1); // Should not be called again
      expect(result).toEqual(testData);
    });

    it('should handle fetch errors gracefully', async () => {
      const key = 'error-test';
      const error = new Error('Fetch failed');
      const fallbackData = { fallback: true };
      
      const fetchFn = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(fallbackData);
      
      // First call should fail and retry
      const result = await cache.getCachedFile(key, fetchFn);
      
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(result).toEqual(fallbackData);
    });

    it('should respect maxAge setting', async () => {
      const shortLivedCache = new EvaluationCache('short-lived', {
        baseDir: testDir,
        maxAge: 100, // 100ms
      });
      
      const key = 'short-lived-data';
      const testData = { message: 'Short lived' };
      
      const fetchFn = vi.fn().mockResolvedValue(testData);
      
      // First call
      await shortLivedCache.getCachedFile(key, fetchFn);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Second call should fetch again
      await shortLivedCache.getCachedFile(key, fetchFn);
      
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCachedModelResponse', () => {
    it('should cache model responses with proper key structure', async () => {
      const stimulusId = 'test-stimulus';
      const mockResponse = {
        content: 'Test response',
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          tokenUsage: { promptTokens: 10, completionTokens: 20 },
          provider: 'test-provider',
          model: 'test-model',
          cost: { promptTokens: 0.01, completionTokens: 0.02, total: 0.03 },
        },
      };
      
      const fetchFn = vi.fn().mockResolvedValue(mockResponse);
      
      const result = await cache.getCachedModelResponse(mockModel, stimulusId, fetchFn);
      
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockResponse);
      
      // Check that file was created in correct location
      const expectedPath = path.join(cache.getWorkdir(), 'responses', stimulusId, 'test-model-test-provider.json');
      expect(fs.existsSync(expectedPath)).toBe(true);
    });

    it('should return cached model response on second call', async () => {
      const stimulusId = 'test-stimulus';
      const startTime = new Date();
      const endTime = new Date();
      const mockResponse = {
        content: 'Cached response',
        metadata: {
          startTime,
          endTime,
          tokenUsage: { promptTokens: 5, completionTokens: 10 },
          provider: 'test-provider',
          model: 'test-model',
          cost: { promptTokens: 0.005, completionTokens: 0.01, total: 0.015 },
        },
      };
      
      const fetchFn = vi.fn().mockResolvedValue(mockResponse);
      
      // First call
      await cache.getCachedModelResponse(mockModel, stimulusId, fetchFn);
      
      // Second call
      const result = await cache.getCachedModelResponse(mockModel, stimulusId, fetchFn);
      
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result.content).toBe(mockResponse.content);
      expect(result.metadata.tokenUsage).toEqual(mockResponse.metadata.tokenUsage);
      expect(result.metadata.cost).toEqual(mockResponse.metadata.cost);
    });
  });

  describe('getCachedScore', () => {
    it('should cache scores with proper key structure', async () => {
      const stimulusId = 'test-stimulus';
      const scoreType = 'quality';
      const mockScore = { score: 0.85, details: 'High quality response' };
      
      const fetchFn = vi.fn().mockResolvedValue(mockScore);
      
      const result = await cache.getCachedScore(mockModel, stimulusId, scoreType, fetchFn);
      
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockScore);
      
      // Check that file was created in correct location
      const expectedPath = path.join(cache.getWorkdir(), 'scores', stimulusId, scoreType, 'test-model-test-provider.json');
      expect(fs.existsSync(expectedPath)).toBe(true);
    });
  });

  describe('getCachedExternalData', () => {
    it('should cache external data with proper key structure', async () => {
      const dataType = 'html';
      const identifier = 'https://example.com';
      const mockData = '<html><body>Test content</body></html>';
      
      const fetchFn = vi.fn().mockResolvedValue(mockData);
      
      const result = await cache.getCachedExternalData(dataType, identifier, fetchFn);
      
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result).toBe(mockData);
      
      // Check that file was created in correct location
      const expectedPath = path.join(cache.getWorkdir(), 'external', dataType, 'https-example.com.json');
      expect(fs.existsSync(expectedPath)).toBe(true);
      
      // Check the cached content structure
      const cachedContent = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
      expect(cachedContent).toHaveProperty('content');
      expect(cachedContent).toHaveProperty('timestamp');
      expect(cachedContent.content).toBe(mockData);
    });

    it('should sanitize identifiers for file paths', async () => {
      const dataType = 'api';
      const identifier = 'https://api.example.com/v1/data?param=value&other=123';
      const mockData = '{"result": "success"}';
      
      const fetchFn = vi.fn().mockResolvedValue(mockData);
      
      await cache.getCachedExternalData(dataType, identifier, fetchFn);
      
      // Check that file was created with sanitized name
      const expectedPath = path.join(cache.getWorkdir(), 'external', dataType, 'https-api.example.com-v1-data-param-value-other-123.json');
      expect(fs.existsSync(expectedPath)).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should track cache statistics', async () => {
      const key = 'stats-test';
      const testData = { test: true };
      
      const fetchFn = vi.fn().mockResolvedValue(testData);
      
      // Initial stats
      let stats = cache.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
      
      // First call (miss)
      await cache.getCachedFile(key, fetchFn);
      stats = cache.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0);
      
      // Second call (hit)
      await cache.getCachedFile(key, fetchFn);
      stats = cache.getStats();
      expect(stats.totalRequests).toBe(2);
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
    });
  });

  describe('clearCache', () => {
    it('should clear all cached data', async () => {
      const key = 'clear-test';
      const testData = { test: true };
      
      const fetchFn = vi.fn().mockResolvedValue(testData);
      
      // Cache some data
      await cache.getCachedFile(key, fetchFn);
      expect(fs.existsSync(cache.getWorkdir())).toBe(true);
      
      // Verify file was created
      const filePath = path.join(cache.getWorkdir(), `${key}.json`);
      expect(fs.existsSync(filePath)).toBe(true);
      
      // Clear cache
      cache.clearCache();
      
      // The cached file should be removed (directory might be recreated by getWorkdir)
      expect(fs.existsSync(filePath)).toBe(false);
      
      // Stats should be reset
      const stats = cache.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });
});
