import { StatsCard } from './StatsCard.js';
import { StoreInfo } from './StoreInfo.js';
import type { HealthResponse } from '../api/types.js';
import { useCacheStats } from '../hooks/useCacheStats.js';
import { useDedupeStats } from '../hooks/useDedup.js';
import { useRateLimitStats } from '../hooks/useRateLimit.js';

interface DashboardProps {
  health: HealthResponse;
}

export function Dashboard({ health }: DashboardProps) {
  const pollInterval = health.pollIntervalMs;
  const cacheStats = useCacheStats(pollInterval, !!health.stores.cache);
  const dedupeStats = useDedupeStats(pollInterval, !!health.stores.dedup);
  const rateLimitStats = useRateLimitStats(
    pollInterval,
    !!health.stores.rateLimit,
  );

  return (
    <div>
      <h1 className="page-title">Overview</h1>

      {health.stores.cache && (
        <div className="section">
          <div className="section-header">
            <h2 className="section-title">Cache</h2>
            <StoreInfo
              type={health.stores.cache.type}
              capabilities={health.stores.cache.capabilities}
            />
          </div>
          <div className="stats-grid">
            {cacheStats.data && (
              <>
                <StatsCard
                  label="Total Items"
                  value={String(
                    (cacheStats.data.stats as Record<string, number>)
                      .totalItems ?? 0,
                  )}
                />
                <StatsCard
                  label="Memory Usage"
                  value={
                    (cacheStats.data.stats as Record<string, number>)
                      .memoryUsageBytes
                      ? `${Math.round(((cacheStats.data.stats as Record<string, number>).memoryUsageBytes ?? 0) / 1024)} KB`
                      : `${(cacheStats.data.stats as Record<string, number>).databaseSizeKB ?? 0} KB`
                  }
                  variant="info"
                />
                <StatsCard
                  label="Expired"
                  value={String(
                    (cacheStats.data.stats as Record<string, number>).expired ??
                      (cacheStats.data.stats as Record<string, number>)
                        .expiredItems ??
                      0,
                  )}
                  variant={
                    ((cacheStats.data.stats as Record<string, number>)
                      .expired ??
                      (cacheStats.data.stats as Record<string, number>)
                        .expiredItems ??
                      0) > 0
                      ? 'warning'
                      : 'success'
                  }
                />
              </>
            )}
            {cacheStats.loading && <div className="loading">Loading...</div>}
          </div>
        </div>
      )}

      {health.stores.dedup && (
        <div className="section">
          <div className="section-header">
            <h2 className="section-title">Dedup</h2>
            <StoreInfo
              type={health.stores.dedup.type}
              capabilities={health.stores.dedup.capabilities}
            />
          </div>
          <div className="stats-grid">
            {dedupeStats.data && (
              <>
                <StatsCard
                  label="Active Jobs"
                  value={String(
                    (dedupeStats.data.stats as Record<string, number>)
                      .activeJobs ??
                      (dedupeStats.data.stats as Record<string, number>)
                        .pendingJobs ??
                      0,
                  )}
                  variant="info"
                />
                <StatsCard
                  label="Total Processed"
                  value={String(
                    (dedupeStats.data.stats as Record<string, number>)
                      .totalJobsProcessed ??
                      (dedupeStats.data.stats as Record<string, number>)
                        .totalJobs ??
                      0,
                  )}
                />
              </>
            )}
            {dedupeStats.loading && <div className="loading">Loading...</div>}
          </div>
        </div>
      )}

      {health.stores.rateLimit && (
        <div className="section">
          <div className="section-header">
            <h2 className="section-title">Rate Limit</h2>
            <StoreInfo
              type={health.stores.rateLimit.type}
              capabilities={health.stores.rateLimit.capabilities}
            />
          </div>
          <div className="stats-grid">
            {rateLimitStats.data && (
              <>
                <StatsCard
                  label="Total Requests"
                  value={String(
                    (rateLimitStats.data.stats as Record<string, number>)
                      .totalRequests ?? 0,
                  )}
                />
                <StatsCard
                  label="Resources"
                  value={String(
                    (rateLimitStats.data.stats as Record<string, number>)
                      .totalResources ??
                      (rateLimitStats.data.stats as Record<string, number>)
                        .uniqueResources ??
                      0,
                  )}
                />
                <StatsCard
                  label="Rate Limited"
                  value={String(
                    (rateLimitStats.data.stats as Record<string, number>)
                      .rateLimitedResources ?? 0,
                  )}
                  variant={
                    ((rateLimitStats.data.stats as Record<string, number>)
                      .rateLimitedResources ?? 0) > 0
                      ? 'danger'
                      : 'success'
                  }
                />
              </>
            )}
            {rateLimitStats.loading && (
              <div className="loading">Loading...</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
