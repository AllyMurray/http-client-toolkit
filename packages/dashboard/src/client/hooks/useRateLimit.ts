import { useCallback } from 'react';
import { usePolling } from './usePolling.js';
import { api } from '../api/client.js';
import type {
  RateLimitStatsResponse,
  RateLimitResourcesResponse,
} from '../api/types.js';

export function useRateLimitStats(
  pollIntervalMs: number,
  enabled: boolean = true,
) {
  const fetcher = useCallback(() => api.rateLimitStats(), []);
  return usePolling<RateLimitStatsResponse>(fetcher, pollIntervalMs, enabled);
}

export function useRateLimitResources(
  pollIntervalMs: number,
  enabled: boolean = true,
) {
  const fetcher = useCallback(() => api.rateLimitResources(), []);
  return usePolling<RateLimitResourcesResponse>(
    fetcher,
    pollIntervalMs,
    enabled,
  );
}
