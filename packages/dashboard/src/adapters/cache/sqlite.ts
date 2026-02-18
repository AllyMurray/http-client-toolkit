import type { CacheStore } from '@http-client-toolkit/core';
import type { CacheStoreAdapter, CacheEntryInfo } from '../types.js';

interface SQLiteCacheStoreLike extends CacheStore {
  getStats(): Promise<{
    totalItems: number;
    expiredItems: number;
    databaseSizeKB: number;
  }>;
  listEntries(
    offset?: number,
    limit?: number,
  ): Promise<
    Array<{
      hash: string;
      expiresAt: number;
      createdAt: number;
    }>
  >;
}

export function createSqliteCacheAdapter(store: CacheStore): CacheStoreAdapter {
  const sqlStore = store as SQLiteCacheStoreLike;

  return {
    type: 'sqlite',
    capabilities: {
      canList: true,
      canDelete: true,
      canClear: true,
      canGetStats: true,
    },

    async getStats() {
      return sqlStore.getStats();
    },

    async listEntries(
      page: number,
      limit: number,
    ): Promise<{ entries: Array<CacheEntryInfo> }> {
      const offset = page * limit;
      const results = await sqlStore.listEntries(offset, limit);
      const entries: Array<CacheEntryInfo> = results.map((r) => ({
        hash: r.hash,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
      }));
      return { entries };
    },

    async getEntry(hash: string) {
      return sqlStore.get(hash);
    },

    async deleteEntry(hash: string) {
      await sqlStore.delete(hash);
    },

    async clearAll() {
      await sqlStore.clear();
    },
  };
}
