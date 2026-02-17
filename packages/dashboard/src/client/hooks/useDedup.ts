import { useCallback, useState } from 'react';
import { usePolling } from './usePolling.js';
import { api } from '../api/client.js';
import type { DedupeStatsResponse, DedupeJobsResponse } from '../api/types.js';

export function useDedupeStats(
  pollIntervalMs: number,
  enabled: boolean = true,
) {
  const fetcher = useCallback(() => api.dedupeStats(), []);
  return usePolling<DedupeStatsResponse>(fetcher, pollIntervalMs, enabled);
}

export function useDedupeJobs(pollIntervalMs: number, enabled: boolean = true) {
  const [page, setPage] = useState(0);
  const limit = 50;
  const fetcher = useCallback(() => api.dedupeJobs(page, limit), [page]);
  const result = usePolling<DedupeJobsResponse>(
    fetcher,
    pollIntervalMs,
    enabled,
  );
  return { ...result, page, setPage, limit };
}
