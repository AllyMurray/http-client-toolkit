import type { CacheStore } from '@http-client-toolkit/core';
import type { CacheStoreAdapter, CacheEntryInfo } from '../types.js';

interface InMemoryCacheStoreLike extends CacheStore {
  getStats(): {
    totalItems: number;
    expired: number;
    memoryUsageBytes: number;
    maxItems: number;
    maxMemoryBytes: number;
    memoryUtilization: number;
    itemUtilization: number;
  };
  listEntries(
    offset?: number,
    limit?: number,
  ): Array<{
    hash: string;
    expiresAt: number;
    lastAccessed: number;
    size: number;
  }>;
}

export function createMemoryCacheAdapter(store: CacheStore): CacheStoreAdapter {
  const memStore = store as InMemoryCacheStoreLike;

  return {
    type: 'memory',
    capabilities: {
      canList: true,
      canDelete: true,
      canClear: true,
      canGetStats: true,
    },

    async getStats() {
      return memStore.getStats();
    },

    async listEntries(
      page: number,
      limit: number,
    ): Promise<{ entries: Array<CacheEntryInfo> }> {
      const offset = page * limit;
      const entries = memStore.listEntries(offset, limit);
      return { entries };
    },

    async getEntry(hash: string) {
      return memStore.get(hash);
    },

    async deleteEntry(hash: string) {
      await memStore.delete(hash);
    },

    async clearAll() {
      await memStore.clear();
    },
  };
}
