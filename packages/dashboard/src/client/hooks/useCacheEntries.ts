import { useCallback, useState } from 'react';
import { usePolling } from './usePolling.js';
import { api } from '../api/client.js';
import type { CacheEntriesResponse } from '../api/types.js';

export function useCacheEntries(
  pollIntervalMs: number,
  enabled: boolean = true,
) {
  const [page, setPage] = useState(0);
  const limit = 50;

  const fetcher = useCallback(() => api.cacheEntries(page, limit), [page]);
  const result = usePolling<CacheEntriesResponse>(
    fetcher,
    pollIntervalMs,
    enabled,
  );

  return { ...result, page, setPage, limit };
}
