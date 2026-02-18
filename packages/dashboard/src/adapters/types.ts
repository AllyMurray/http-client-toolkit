export interface CacheEntryInfo {
  hash: string;
  expiresAt: number;
  lastAccessed?: number;
  createdAt?: number;
  size?: number;
}

export interface CacheStoreAdapter {
  type: string;
  capabilities: {
    canList: boolean;
    canDelete: boolean;
    canClear: boolean;
    canGetStats: boolean;
  };
  getStats(): Promise<Record<string, unknown>>;
  listEntries(
    page: number,
    limit: number,
  ): Promise<{ entries: Array<CacheEntryInfo>; total?: number }>;
  getEntry(hash: string): Promise<unknown | undefined>;
  deleteEntry(hash: string): Promise<void>;
  clearAll(): Promise<void>;
}

export interface DedupeJobInfo {
  hash: string;
  jobId: string;
  status: string;
  createdAt: number;
}

export interface DedupeStoreAdapter {
  type: string;
  capabilities: {
    canList: boolean;
    canGetStats: boolean;
  };
  getStats(): Promise<Record<string, unknown>>;
  listJobs(
    page: number,
    limit: number,
  ): Promise<{ jobs: Array<DedupeJobInfo>; total?: number }>;
  getJob(hash: string): Promise<DedupeJobInfo | undefined>;
}

export interface RateLimitResourceInfo {
  resource: string;
  requestCount: number;
  limit: number;
  windowMs: number;
}

export interface RateLimitStoreAdapter {
  type: string;
  capabilities: {
    canList: boolean;
    canGetStats: boolean;
    canUpdateConfig: boolean;
    canReset: boolean;
  };
  getStats(): Promise<Record<string, unknown>>;
  listResources(): Promise<Array<RateLimitResourceInfo>>;
  getResourceStatus(
    name: string,
  ): Promise<{ remaining: number; resetTime: Date; limit: number }>;
  updateResourceConfig(
    name: string,
    config: { limit: number; windowMs: number },
  ): Promise<void>;
  resetResource(name: string): Promise<void>;
}
