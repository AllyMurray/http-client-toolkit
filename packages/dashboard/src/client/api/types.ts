export interface StoreInfo {
  name: string;
  type: string;
  capabilities: Record<string, boolean>;
}

export interface HealthResponse {
  status: string;
  stores: {
    cache: { type: string; capabilities: Record<string, boolean> } | null;
    dedup: { type: string; capabilities: Record<string, boolean> } | null;
    rateLimit: { type: string; capabilities: Record<string, boolean> } | null;
  };
  pollIntervalMs: number;
}

export interface CacheEntry {
  hash: string;
  expiresAt: number;
  lastAccessed?: number;
  createdAt?: number;
  size?: number;
}

export interface CacheStatsResponse {
  stats: Record<string, unknown>;
  capabilities: Record<string, boolean>;
}

export interface CacheEntriesResponse {
  entries: Array<CacheEntry>;
  total?: number;
}

export interface DedupeJob {
  hash: string;
  jobId: string;
  status: string;
  createdAt: number;
}

export interface DedupeStatsResponse {
  stats: Record<string, unknown>;
  capabilities: Record<string, boolean>;
}

export interface DedupeJobsResponse {
  jobs: Array<DedupeJob>;
  total?: number;
}

export interface RateLimitResource {
  resource: string;
  requestCount: number;
  limit: number;
  windowMs: number;
}

export interface RateLimitStatsResponse {
  stats: Record<string, unknown>;
  capabilities: Record<string, boolean>;
}

export interface RateLimitResourcesResponse {
  resources: Array<RateLimitResource>;
}
