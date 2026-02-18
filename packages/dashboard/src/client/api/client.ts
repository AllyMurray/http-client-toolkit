import type {
  HealthResponse,
  CacheStatsResponse,
  CacheEntriesResponse,
  DedupeStatsResponse,
  DedupeJobsResponse,
  RateLimitStatsResponse,
  RateLimitResourcesResponse,
  ClientInfo,
} from './types.js';

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function clientPath(clientName: string, path: string): string {
  return `/api/clients/${encodeURIComponent(clientName)}${path}`;
}

export const api = {
  health: () => fetchApi<HealthResponse>('/api/health'),
  clients: () => fetchApi<{ clients: Array<ClientInfo> }>('/api/clients'),

  // Cache
  cacheStats: (clientName: string) =>
    fetchApi<CacheStatsResponse>(clientPath(clientName, '/cache/stats')),
  cacheEntries: (clientName: string, page = 0, limit = 50) =>
    fetchApi<CacheEntriesResponse>(
      clientPath(clientName, `/cache/entries?page=${page}&limit=${limit}`),
    ),
  cacheEntry: (clientName: string, hash: string) =>
    fetchApi<{ hash: string; value: unknown }>(
      clientPath(clientName, `/cache/entries/${encodeURIComponent(hash)}`),
    ),
  deleteCacheEntry: (clientName: string, hash: string) =>
    fetchApi<{ deleted: boolean }>(
      clientPath(clientName, `/cache/entries/${encodeURIComponent(hash)}`),
      { method: 'DELETE' },
    ),
  clearCache: (clientName: string) =>
    fetchApi<{ cleared: boolean }>(clientPath(clientName, '/cache/entries'), {
      method: 'DELETE',
    }),

  // Dedup
  dedupeStats: (clientName: string) =>
    fetchApi<DedupeStatsResponse>(clientPath(clientName, '/dedup/stats')),
  dedupeJobs: (clientName: string, page = 0, limit = 50) =>
    fetchApi<DedupeJobsResponse>(
      clientPath(clientName, `/dedup/jobs?page=${page}&limit=${limit}`),
    ),

  // Rate Limit
  rateLimitStats: (clientName: string) =>
    fetchApi<RateLimitStatsResponse>(
      clientPath(clientName, '/rate-limit/stats'),
    ),
  rateLimitResources: (clientName: string) =>
    fetchApi<RateLimitResourcesResponse>(
      clientPath(clientName, '/rate-limit/resources'),
    ),
  rateLimitResource: (clientName: string, name: string) =>
    fetchApi<{ resource: string; remaining: number; limit: number }>(
      clientPath(
        clientName,
        `/rate-limit/resources/${encodeURIComponent(name)}`,
      ),
    ),
  updateRateLimitConfig: (
    clientName: string,
    name: string,
    config: { limit: number; windowMs: number },
  ) =>
    fetchApi<{ updated: boolean }>(
      clientPath(
        clientName,
        `/rate-limit/resources/${encodeURIComponent(name)}/config`,
      ),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      },
    ),
  resetRateLimitResource: (clientName: string, name: string) =>
    fetchApi<{ reset: boolean }>(
      clientPath(
        clientName,
        `/rate-limit/resources/${encodeURIComponent(name)}/reset`,
      ),
      { method: 'POST' },
    ),
};
