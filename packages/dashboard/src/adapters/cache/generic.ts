import type { CacheStore } from '@http-client-toolkit/core';
import type { CacheStoreAdapter, CacheEntryInfo } from '../types.js';

export function createGenericCacheAdapter(
  store: CacheStore,
): CacheStoreAdapter {
  return {
    type: 'generic',
    capabilities: {
      canList: false,
      canDelete: true,
      canClear: true,
      canGetStats: false,
    },

    async getStats() {
      return { message: 'Stats not available for this store type' };
    },

    async listEntries(): Promise<{ entries: Array<CacheEntryInfo> }> {
      return { entries: [] };
    },

    async getEntry(hash: string) {
      return store.get(hash);
    },

    async deleteEntry(hash: string) {
      await store.delete(hash);
    },

    async clearAll() {
      await store.clear();
    },
  };
}
