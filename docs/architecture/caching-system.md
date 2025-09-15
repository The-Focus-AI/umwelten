# Caching System

## Overview

The caching system provides comprehensive caching capabilities to improve performance, reduce costs, and ensure consistent results across evaluations. It includes multiple caching layers for different types of data.

## Caching Layers

### 1. Model Response Caching
Caches model responses to avoid re-running expensive model calls.

**Key Features:**
- Automatic cache invalidation based on model parameters
- Configurable TTL (Time To Live) settings
- Support for different storage backends
- Cache hit/miss statistics

**Usage:**
```typescript
import { CacheService } from '../src/evaluation/caching/cache-service.js';

const cache = new CacheService({
  ttl: 3600, // 1 hour
  maxSize: 1000, // Maximum number of cached items
  storage: 'memory' // or 'file', 'redis', etc.
});

// Cache a model response
await cache.set('model-response-key', response, {
  model: 'gpt-4',
  prompt: 'Hello, world!',
  temperature: 0.7
});

// Retrieve a cached response
const cachedResponse = await cache.get('model-response-key');
```

### 2. File Caching
Caches processed files and metadata to avoid re-processing.

**Key Features:**
- Automatic file change detection
- Metadata caching (file size, modification time, etc.)
- Support for large files
- Incremental processing

**Usage:**
```typescript
import { FileCache } from '../src/evaluation/caching/file-cache.js';

const fileCache = new FileCache({
  baseDir: './cache/files',
  ttl: 86400 // 24 hours
});

// Cache a processed file
await fileCache.set('processed-file-key', processedData, {
  sourceFile: '/path/to/source.pdf',
  processingType: 'text-extraction'
});

// Retrieve cached file data
const cachedData = await fileCache.get('processed-file-key');
```

### 3. Score Caching
Caches evaluation scores and results to avoid re-computing.

**Key Features:**
- Score computation caching
- Result aggregation caching
- Support for different scoring strategies
- Automatic cache invalidation

**Usage:**
```typescript
import { ScoreCache } from '../src/evaluation/caching/score-cache.js';

const scoreCache = new ScoreCache({
  ttl: 7200, // 2 hours
  strategy: 'semantic' // or 'exact', 'fuzzy', etc.
});

// Cache a score
await scoreCache.set('score-key', score, {
  evaluationId: 'my-evaluation',
  testCaseId: 'test-1',
  model: 'gpt-4',
  scoringStrategy: 'semantic'
});

// Retrieve cached score
const cachedScore = await scoreCache.get('score-key');
```

## Cache Configuration

### Global Configuration
```typescript
import { CacheConfig } from '../src/evaluation/caching/cache-config.js';

const config = new CacheConfig({
  // Global settings
  defaultTTL: 3600,
  maxMemoryUsage: '512MB',
  enableCompression: true,
  
  // Model response cache settings
  modelResponseCache: {
    ttl: 3600,
    maxSize: 1000,
    storage: 'memory'
  },
  
  // File cache settings
  fileCache: {
    ttl: 86400,
    maxSize: '1GB',
    storage: 'file',
    baseDir: './cache/files'
  },
  
  // Score cache settings
  scoreCache: {
    ttl: 7200,
    maxSize: 500,
    storage: 'memory'
  }
});
```

### Per-Evaluation Configuration
```typescript
const evaluation = new SimpleEvaluation({
  id: 'my-evaluation',
  name: 'My Evaluation',
  description: 'An evaluation with custom caching',
  
  // Custom cache settings
  cache: {
    enabled: true,
    ttl: 1800, // 30 minutes
    strategy: 'aggressive' // or 'conservative', 'balanced'
  }
});
```

## Cache Strategies

### 1. Aggressive Caching
- Cache everything possible
- Long TTL values
- High cache hit rates
- Use when cost is more important than freshness

### 2. Conservative Caching
- Cache only expensive operations
- Short TTL values
- Lower cache hit rates
- Use when freshness is more important than cost

### 3. Balanced Caching
- Moderate caching approach
- Medium TTL values
- Balanced hit rates
- Good for most use cases

## Cache Storage Backends

### Memory Storage
- Fastest access
- Limited by available memory
- Lost on restart
- Good for temporary caching

### File Storage
- Persistent across restarts
- Limited by disk space
- Slower than memory
- Good for long-term caching

### Redis Storage
- Fast and persistent
- Distributed caching
- Requires Redis server
- Good for production use

## Cache Invalidation

### Automatic Invalidation
- Based on TTL expiration
- File change detection
- Model parameter changes
- Configuration updates

### Manual Invalidation
```typescript
// Invalidate specific cache entries
await cache.invalidate('specific-key');

// Invalidate by pattern
await cache.invalidatePattern('evaluation-*');

// Invalidate all caches
await cache.clear();

// Invalidate by model
await cache.invalidateByModel('gpt-4');
```

## Performance Monitoring

### Cache Statistics
```typescript
const stats = await cache.getStatistics();
console.log('Cache Hit Rate:', stats.hitRate);
console.log('Total Requests:', stats.totalRequests);
console.log('Cache Size:', stats.cacheSize);
console.log('Memory Usage:', stats.memoryUsage);
```

### Performance Metrics
- **Hit Rate**: Percentage of cache hits
- **Response Time**: Average response time
- **Memory Usage**: Current memory consumption
- **Storage Usage**: Disk space usage

## Best Practices

### 1. Choose Appropriate TTL Values
- Short TTL for frequently changing data
- Long TTL for stable data
- Consider data freshness requirements
- Monitor cache hit rates

### 2. Use Appropriate Storage Backends
- Memory for temporary, fast access
- File for persistent, medium-term storage
- Redis for distributed, high-performance caching

### 3. Monitor Cache Performance
- Track hit rates and response times
- Monitor memory and storage usage
- Set up alerts for cache issues
- Regular cache cleanup

### 4. Handle Cache Misses Gracefully
- Implement fallback strategies
- Provide meaningful error messages
- Log cache miss events
- Consider cache warming strategies

### 5. Optimize Cache Keys
- Use descriptive, unique keys
- Include relevant parameters
- Avoid overly long keys
- Use consistent naming conventions

## Troubleshooting

### Common Issues

#### High Memory Usage
- Reduce cache size limits
- Use file storage for large data
- Implement cache eviction policies
- Monitor memory usage patterns

#### Low Cache Hit Rates
- Increase TTL values
- Check cache key consistency
- Verify invalidation logic
- Monitor cache usage patterns

#### Slow Cache Performance
- Use faster storage backends
- Optimize cache key generation
- Implement cache warming
- Consider distributed caching

### Debug Mode
```typescript
const cache = new CacheService({
  debug: true,
  logLevel: 'verbose'
});
```

## API Reference

For detailed API documentation, see the [API Reference](../api/caching-system.md).

## Related Documentation

- [Evaluation Framework](evaluation-framework.md)
- [Performance Optimization](performance-optimization.md)
- [Troubleshooting Guide](troubleshooting.md)
