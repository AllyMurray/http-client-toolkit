import type {
  CacheStore,
  DedupeStore,
  RateLimitStore,
} from '@http-client-toolkit/core';
import { createGenericCacheAdapter } from './cache/generic.js';
import { createMemoryCacheAdapter } from './cache/memory.js';
import { createSqliteCacheAdapter } from './cache/sqlite.js';
import { createGenericDedupeAdapter } from './dedup/generic.js';
import { createMemoryDedupeAdapter } from './dedup/memory.js';
import { createSqliteDedupeAdapter } from './dedup/sqlite.js';
import { createGenericRateLimitAdapter } from './rate-limit/generic.js';
import { createMemoryRateLimitAdapter } from './rate-limit/memory.js';
import { createSqliteRateLimitAdapter } from './rate-limit/sqlite.js';
import type {
  CacheStoreAdapter,
  DedupeStoreAdapter,
  RateLimitStoreAdapter,
} from './types.js';

function isMemoryStore(store: unknown): boolean {
  if (!store || typeof store !== 'object') return false;
  const s = store as Record<string, unknown>;
  return (
    typeof s.destroy === 'function' &&
    typeof s.getStats === 'function' &&
    typeof s.cleanup === 'function' &&
    typeof s.getLRUItems === 'function'
  );
}

function isSqliteStore(store: unknown): boolean {
  if (!store || typeof store !== 'object') return false;
  const s = store as Record<string, unknown>;
  return (
    typeof s.destroy === 'function' &&
    typeof s.getStats === 'function' &&
    typeof s.close === 'function'
  );
}

function isMemoryDedupeStore(store: unknown): boolean {
  if (!store || typeof store !== 'object') return false;
  const s = store as Record<string, unknown>;
  return (
    typeof s.destroy === 'function' &&
    typeof s.getStats === 'function' &&
    typeof s.listJobs === 'function' &&
    typeof s.cleanup === 'function' &&
    !('close' in s && typeof s.close === 'function')
  );
}

function isSqliteDedupeStore(store: unknown): boolean {
  if (!store || typeof store !== 'object') return false;
  const s = store as Record<string, unknown>;
  return (
    typeof s.destroy === 'function' &&
    typeof s.getStats === 'function' &&
    typeof s.close === 'function' &&
    typeof s.listJobs === 'function'
  );
}

function isMemoryRateLimitStore(store: unknown): boolean {
  if (!store || typeof store !== 'object') return false;
  const s = store as Record<string, unknown>;
  return (
    typeof s.destroy === 'function' &&
    typeof s.getStats === 'function' &&
    typeof s.listResources === 'function' &&
    typeof s.setResourceConfig === 'function' &&
    !('close' in s && typeof s.close === 'function')
  );
}

function isSqliteRateLimitStore(store: unknown): boolean {
  if (!store || typeof store !== 'object') return false;
  const s = store as Record<string, unknown>;
  return (
    typeof s.destroy === 'function' &&
    typeof s.getStats === 'function' &&
    typeof s.close === 'function' &&
    typeof s.listResources === 'function' &&
    typeof s.setResourceConfig === 'function'
  );
}

export function detectCacheAdapter(store: CacheStore): CacheStoreAdapter {
  if (isMemoryStore(store)) {
    return createMemoryCacheAdapter(store);
  }
  if (isSqliteStore(store)) {
    return createSqliteCacheAdapter(store);
  }
  return createGenericCacheAdapter(store);
}

export function detectDedupeAdapter(store: DedupeStore): DedupeStoreAdapter {
  if (isMemoryDedupeStore(store)) {
    return createMemoryDedupeAdapter(store);
  }
  if (isSqliteDedupeStore(store)) {
    return createSqliteDedupeAdapter(store);
  }
  return createGenericDedupeAdapter(store);
}

export function detectRateLimitAdapter(
  store: RateLimitStore,
): RateLimitStoreAdapter {
  if (isMemoryRateLimitStore(store)) {
    return createMemoryRateLimitAdapter(store);
  }
  if (isSqliteRateLimitStore(store)) {
    return createSqliteRateLimitAdapter(store);
  }
  return createGenericRateLimitAdapter(store);
}
