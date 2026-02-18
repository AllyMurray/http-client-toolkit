import { useCallback, useState } from 'react';
import { usePolling } from './usePolling.js';
import { api } from '../api/client.js';
import type { CacheEntriesResponse } from '../api/types.js';

export function useCacheEntries(
  clientName: string,
  pollIntervalMs: number,
  enabled: boolean = true,
) {
  const [page, setPage] = useState(0);
  const limit = 50;

  const fetcher = useCallback(
    () => api.cacheEntries(clientName, page, limit),
    [clientName, page],
  );
  const result = usePolling<CacheEntriesResponse>(
    fetcher,
    pollIntervalMs,
    enabled,
  );

  return { ...result, page, setPage, limit };
}
