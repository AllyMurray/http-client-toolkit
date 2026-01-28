export { SQLiteCacheStore } from './sqlite-cache-store.js';
export { SQLiteDedupeStore } from './sqlite-dedupe-store.js';
export { SQLiteRateLimitStore } from './sqlite-rate-limit-store.js';
export { SqliteAdaptiveRateLimitStore } from './sqlite-adaptive-rate-limit-store.js';
export type { SQLiteCacheStoreOptions } from './sqlite-cache-store.js';
export type { SQLiteDedupeStoreOptions } from './sqlite-dedupe-store.js';
export type { SQLiteRateLimitStoreOptions } from './sqlite-rate-limit-store.js';
export type { SqliteAdaptiveRateLimitStoreOptions } from './sqlite-adaptive-rate-limit-store.js';
export type { RateLimitConfig } from '@http-client-toolkit/core';
export * from './schema.js';

// Re-export the store interfaces from the core package for convenience
export type {
  CacheStore,
  DedupeStore,
  RateLimitStore,
  AdaptiveRateLimitStore,
  RequestPriority,
  AdaptiveConfig,
} from '@http-client-toolkit/core';
