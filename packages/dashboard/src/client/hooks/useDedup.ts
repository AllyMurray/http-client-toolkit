import { useCallback, useState } from 'react';
import { usePolling } from './usePolling.js';
import { api } from '../api/client.js';
import type { DedupeStatsResponse, DedupeJobsResponse } from '../api/types.js';

export function useDedupeStats(
  clientName: string,
  pollIntervalMs: number,
  enabled: boolean = true,
) {
  const fetcher = useCallback(() => api.dedupeStats(clientName), [clientName]);
  return usePolling<DedupeStatsResponse>(fetcher, pollIntervalMs, enabled);
}

export function useDedupeJobs(
  clientName: string,
  pollIntervalMs: number,
  enabled: boolean = true,
) {
  const [page, setPage] = useState(0);
  const limit = 50;
  const fetcher = useCallback(
    () => api.dedupeJobs(clientName, page, limit),
    [clientName, page],
  );
  const result = usePolling<DedupeJobsResponse>(
    fetcher,
    pollIntervalMs,
    enabled,
  );
  return { ...result, page, setPage, limit };
}
