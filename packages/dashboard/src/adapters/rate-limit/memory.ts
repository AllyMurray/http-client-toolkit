import type { RateLimitStore } from '@http-client-toolkit/core';
import type { RateLimitStoreAdapter, RateLimitResourceInfo } from '../types.js';

interface InMemoryRateLimitStoreLike extends RateLimitStore {
  getStats(): {
    totalResources: number;
    activeResources: number;
    rateLimitedResources: number;
    totalRequests: number;
  };
  listResources(): Array<{
    resource: string;
    requestCount: number;
    limit: number;
    windowMs: number;
  }>;
  setResourceConfig(
    resource: string,
    config: { limit: number; windowMs: number },
  ): void;
  getResourceConfig(resource: string): { limit: number; windowMs: number };
}

export function createMemoryRateLimitAdapter(
  store: RateLimitStore,
): RateLimitStoreAdapter {
  const memStore = store as InMemoryRateLimitStoreLike;

  return {
    type: 'memory',
    capabilities: {
      canList: true,
      canGetStats: true,
      canUpdateConfig: true,
      canReset: true,
    },

    async getStats() {
      return memStore.getStats();
    },

    async listResources(): Promise<Array<RateLimitResourceInfo>> {
      return memStore.listResources();
    },

    async getResourceStatus(name: string) {
      return memStore.getStatus(name);
    },

    async updateResourceConfig(
      name: string,
      config: { limit: number; windowMs: number },
    ) {
      memStore.setResourceConfig(name, config);
    },

    async resetResource(name: string) {
      await memStore.reset(name);
    },
  };
}
