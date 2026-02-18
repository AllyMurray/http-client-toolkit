import type { RateLimitStore } from '@http-client-toolkit/core';
import type { RateLimitStoreAdapter, RateLimitResourceInfo } from '../types.js';

export function createGenericRateLimitAdapter(
  store: RateLimitStore,
): RateLimitStoreAdapter {
  return {
    type: 'generic',
    capabilities: {
      canList: false,
      canGetStats: false,
      canUpdateConfig: false,
      canReset: true,
    },

    async getStats() {
      return { message: 'Stats not available for this store type' };
    },

    async listResources(): Promise<Array<RateLimitResourceInfo>> {
      return [];
    },

    async getResourceStatus(name: string) {
      return store.getStatus(name);
    },

    async updateResourceConfig() {
      throw new Error('Config updates not supported for this store type');
    },

    async resetResource(name: string) {
      await store.reset(name);
    },
  };
}
