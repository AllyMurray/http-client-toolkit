import type { DedupeStore } from '@http-client-toolkit/core';
import type { DedupeStoreAdapter, DedupeJobInfo } from '../types.js';

interface SQLiteDedupeStoreLike extends DedupeStore {
  getStats(): Promise<{
    totalJobs: number;
    pendingJobs: number;
    completedJobs: number;
    failedJobs: number;
    expiredJobs: number;
  }>;
  listJobs(
    offset?: number,
    limit?: number,
  ): Promise<
    Array<{
      hash: string;
      jobId: string;
      status: string;
      createdAt: number;
    }>
  >;
}

export function createSqliteDedupeAdapter(
  store: DedupeStore,
): DedupeStoreAdapter {
  const sqlStore = store as SQLiteDedupeStoreLike;

  return {
    type: 'sqlite',
    capabilities: {
      canList: true,
      canGetStats: true,
    },

    async getStats() {
      return sqlStore.getStats();
    },

    async listJobs(
      page: number,
      limit: number,
    ): Promise<{ jobs: Array<DedupeJobInfo> }> {
      const offset = page * limit;
      const results = await sqlStore.listJobs(offset, limit);
      return { jobs: results };
    },

    async getJob(hash: string): Promise<DedupeJobInfo | undefined> {
      const results = await sqlStore.listJobs(0, 1000);
      return results.find((j) => j.hash === hash);
    },
  };
}
