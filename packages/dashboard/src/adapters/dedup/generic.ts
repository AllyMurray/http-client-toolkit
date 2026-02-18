import type { DedupeStore } from '@http-client-toolkit/core';
import type { DedupeStoreAdapter, DedupeJobInfo } from '../types.js';

export function createGenericDedupeAdapter(
  _store: DedupeStore,
): DedupeStoreAdapter {
  return {
    type: 'generic',
    capabilities: {
      canList: false,
      canGetStats: false,
    },

    async getStats() {
      return { message: 'Stats not available for this store type' };
    },

    async listJobs(): Promise<{ jobs: Array<DedupeJobInfo> }> {
      return { jobs: [] };
    },

    async getJob(): Promise<DedupeJobInfo | undefined> {
      return undefined;
    },
  };
}
