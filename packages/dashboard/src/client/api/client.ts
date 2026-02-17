import type {
  HealthResponse,
  CacheStatsResponse,
  CacheEntriesResponse,
  DedupeStatsResponse,
  DedupeJobsResponse,
  RateLimitStatsResponse,
  RateLimitResourcesResponse,
  StoreInfo,
} from './types.js';

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetchApi<HealthResponse>('/api/health'),
  stores: () => fetchApi<{ stores: Array<StoreInfo> }>('/api/stores'),

  // Cache
  cacheStats: () => fetchApi<CacheStatsResponse>('/api/cache/stats'),
  cacheEntries: (page = 0, limit = 50) =>
    fetchApi<CacheEntriesResponse>(
      `/api/cache/entries?page=${page}&limit=${limit}`,
    ),
  cacheEntry: (hash: string) =>
    fetchApi<{ hash: string; value: unknown }>(
      `/api/cache/entries/${encodeURIComponent(hash)}`,
    ),
  deleteCacheEntry: (hash: string) =>
    fetchApi<{ deleted: boolean }>(
      `/api/cache/entries/${encodeURIComponent(hash)}`,
      { method: 'DELETE' },
    ),
  clearCache: () =>
    fetchApi<{ cleared: boolean }>('/api/cache/entries', { method: 'DELETE' }),

  // Dedup
  dedupeStats: () => fetchApi<DedupeStatsResponse>('/api/dedup/stats'),
  dedupeJobs: (page = 0, limit = 50) =>
    fetchApi<DedupeJobsResponse>(`/api/dedup/jobs?page=${page}&limit=${limit}`),

  // Rate Limit
  rateLimitStats: () =>
    fetchApi<RateLimitStatsResponse>('/api/rate-limit/stats'),
  rateLimitResources: () =>
    fetchApi<RateLimitResourcesResponse>('/api/rate-limit/resources'),
  rateLimitResource: (name: string) =>
    fetchApi<{ resource: string; remaining: number; limit: number }>(
      `/api/rate-limit/resources/${encodeURIComponent(name)}`,
    ),
  updateRateLimitConfig: (
    name: string,
    config: { limit: number; windowMs: number },
  ) =>
    fetchApi<{ updated: boolean }>(
      `/api/rate-limit/resources/${encodeURIComponent(name)}/config`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      },
    ),
  resetRateLimitResource: (name: string) =>
    fetchApi<{ reset: boolean }>(
      `/api/rate-limit/resources/${encodeURIComponent(name)}/reset`,
      { method: 'POST' },
    ),
};
