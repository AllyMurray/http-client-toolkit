export { InMemoryCacheStore } from './in-memory-cache-store.js';
export { InMemoryDedupeStore } from './in-memory-dedupe-store.js';
export { InMemoryRateLimitStore } from './in-memory-rate-limit-store.js';
export { AdaptiveRateLimitStore } from './adaptive-rate-limit-store.js';
export type { InMemoryCacheStoreOptions } from './in-memory-cache-store.js';
export type { InMemoryDedupeStoreOptions } from './in-memory-dedupe-store.js';
export type { InMemoryRateLimitStoreOptions } from './in-memory-rate-limit-store.js';
export type { AdaptiveRateLimitStoreOptions } from './adaptive-rate-limit-store.js';
export type { RateLimitConfig } from '@http-client-toolkit/core';

// Re-export the store interfaces from the core package for convenience
export type {
  CacheStore,
  DedupeStore,
  RateLimitStore,
  AdaptiveRateLimitStore as IAdaptiveRateLimitStore,
  RequestPriority,
  AdaptiveConfig,
} from '@http-client-toolkit/core';
