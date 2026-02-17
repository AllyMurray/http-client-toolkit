import type { DedupeStore } from '@http-client-toolkit/core';
import type { DedupeStoreAdapter, DedupeJobInfo } from '../types.js';

interface InMemoryDedupeStoreLike extends DedupeStore {
  getStats(): {
    activeJobs: number;
    totalJobsProcessed: number;
    expiredJobs: number;
    oldestJobAgeMs: number;
  };
  listJobs(
    offset?: number,
    limit?: number,
  ): Array<{
    hash: string;
    jobId: string;
    status: 'pending' | 'completed' | 'failed';
    createdAt: number;
  }>;
}

export function createMemoryDedupeAdapter(
  store: DedupeStore,
): DedupeStoreAdapter {
  const memStore = store as InMemoryDedupeStoreLike;

  return {
    type: 'memory',
    capabilities: {
      canList: true,
      canGetStats: true,
    },

    async getStats() {
      return memStore.getStats();
    },

    async listJobs(
      page: number,
      limit: number,
    ): Promise<{ jobs: Array<DedupeJobInfo> }> {
      const offset = page * limit;
      const jobs = memStore.listJobs(offset, limit);
      return { jobs };
    },

    async getJob(hash: string): Promise<DedupeJobInfo | undefined> {
      const jobs = memStore.listJobs(0, 1000);
      return jobs.find((j) => j.hash === hash);
    },
  };
}
