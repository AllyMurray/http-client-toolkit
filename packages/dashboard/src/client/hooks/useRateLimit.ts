import { useCallback } from 'react';
import { usePolling } from './usePolling.js';
import { api } from '../api/client.js';
import type {
  RateLimitStatsResponse,
  RateLimitResourcesResponse,
} from '../api/types.js';

export function useRateLimitStats(
  clientName: string,
  pollIntervalMs: number,
  enabled: boolean = true,
) {
  const fetcher = useCallback(
    () => api.rateLimitStats(clientName),
    [clientName],
  );
  return usePolling<RateLimitStatsResponse>(fetcher, pollIntervalMs, enabled);
}

export function useRateLimitResources(
  clientName: string,
  pollIntervalMs: number,
  enabled: boolean = true,
) {
  const fetcher = useCallback(
    () => api.rateLimitResources(clientName),
    [clientName],
  );
  return usePolling<RateLimitResourcesResponse>(
    fetcher,
    pollIntervalMs,
    enabled,
  );
}
