import { useCallback } from 'react';
import { usePolling } from './usePolling.js';
import { api } from '../api/client.js';
import type { CacheStatsResponse } from '../api/types.js';

export function useCacheStats(pollIntervalMs: number, enabled: boolean = true) {
  const fetcher = useCallback(() => api.cacheStats(), []);
  return usePolling<CacheStatsResponse>(fetcher, pollIntervalMs, enabled);
}
