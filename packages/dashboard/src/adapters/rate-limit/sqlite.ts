import type { RateLimitStore } from '@http-client-toolkit/core';
import type { RateLimitStoreAdapter, RateLimitResourceInfo } from '../types.js';

interface SQLiteRateLimitStoreLike extends RateLimitStore {
  getStats(): Promise<{
    totalRequests: number;
    uniqueResources: number;
    rateLimitedResources: Array<string>;
  }>;
  listResources(): Promise<
    Array<{
      resource: string;
      requestCount: number;
      limit: number;
      windowMs: number;
    }>
  >;
  setResourceConfig(
    resource: string,
    config: { limit: number; windowMs: number },
  ): void;
  getResourceConfig(resource: string): { limit: number; windowMs: number };
}

export function createSqliteRateLimitAdapter(
  store: RateLimitStore,
): RateLimitStoreAdapter {
  const sqlStore = store as SQLiteRateLimitStoreLike;

  return {
    type: 'sqlite',
    capabilities: {
      canList: true,
      canGetStats: true,
      canUpdateConfig: true,
      canReset: true,
    },

    async getStats() {
      return sqlStore.getStats();
    },

    async listResources(): Promise<Array<RateLimitResourceInfo>> {
      return sqlStore.listResources();
    },

    async getResourceStatus(name: string) {
      return sqlStore.getStatus(name);
    },

    async updateResourceConfig(
      name: string,
      config: { limit: number; windowMs: number },
    ) {
      sqlStore.setResourceConfig(name, config);
    },

    async resetResource(name: string) {
      await sqlStore.reset(name);
    },
  };
}
