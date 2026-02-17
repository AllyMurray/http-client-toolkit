import { useCallback } from 'react';
import { usePolling } from './usePolling.js';
import { api } from '../api/client.js';
import type { CacheStatsResponse } from '../api/types.js';

export function useCacheStats(
  clientName: string,
  pollIntervalMs: number,
  enabled: boolean = true,
) {
  const fetcher = useCallback(() => api.cacheStats(clientName), [clientName]);
  return usePolling<CacheStatsResponse>(fetcher, pollIntervalMs, enabled);
}
