import { StoreInfo } from './StoreInfo.js';
import type { HealthResponse } from '../api/types.js';
import { useCacheStats } from '../hooks/useCacheStats.js';
import { useDedupeStats } from '../hooks/useDedup.js';
import { useRateLimitStats } from '../hooks/useRateLimit.js';

interface DashboardProps {
  health: HealthResponse;
}

function OverviewStat({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant?: string;
}) {
  return (
    <div className="overview-stat">
      <div className="overview-stat-label">{label}</div>
      <div className={`overview-stat-value ${variant ?? ''}`}>{value}</div>
    </div>
  );
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
      <div className="page-header">
        <h1 className="page-title">Overview</h1>
        <p className="page-subtitle">Real-time store monitoring</p>
      </div>

      {health.stores.cache && (
        <div className="overview-section">
          <div className="overview-section-header">
            <h2 className="overview-section-title">Cache</h2>
            <StoreInfo
              type={health.stores.cache.type}
              capabilities={health.stores.cache.capabilities}
            />
          </div>
          {cacheStats.data && (
            <div className="overview-stats">
              <OverviewStat
                label="Total Items"
                value={String(
                  (cacheStats.data.stats as Record<string, number>)
                    .totalItems ?? 0,
                )}
              />
              <OverviewStat
                label="Memory Usage"
                value={
                  (cacheStats.data.stats as Record<string, number>)
                    .memoryUsageBytes
                    ? `${Math.round(((cacheStats.data.stats as Record<string, number>).memoryUsageBytes ?? 0) / 1024)} KB`
                    : `${(cacheStats.data.stats as Record<string, number>).databaseSizeKB ?? 0} KB`
                }
                variant="info"
              />
              <OverviewStat
                label="Expired"
                value={String(
                  (cacheStats.data.stats as Record<string, number>).expired ??
                    (cacheStats.data.stats as Record<string, number>)
                      .expiredItems ??
                    0,
                )}
                variant={
                  ((cacheStats.data.stats as Record<string, number>).expired ??
                    (cacheStats.data.stats as Record<string, number>)
                      .expiredItems ??
                    0) > 0
                    ? 'warning'
                    : 'success'
                }
              />
            </div>
          )}
          {cacheStats.loading && (
            <div className="loading">
              <span className="loading-dot" />
              <span className="loading-dot" />
              <span className="loading-dot" />
            </div>
          )}
        </div>
      )}

      {health.stores.dedup && (
        <div className="overview-section">
          <div className="overview-section-header">
            <h2 className="overview-section-title">Dedup</h2>
            <StoreInfo
              type={health.stores.dedup.type}
              capabilities={health.stores.dedup.capabilities}
            />
          </div>
          {dedupeStats.data && (
            <div className="overview-stats">
              <OverviewStat
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
              <OverviewStat
                label="Total Processed"
                value={String(
                  (dedupeStats.data.stats as Record<string, number>)
                    .totalJobsProcessed ??
                    (dedupeStats.data.stats as Record<string, number>)
                      .totalJobs ??
                    0,
                )}
              />
            </div>
          )}
          {dedupeStats.loading && (
            <div className="loading">
              <span className="loading-dot" />
              <span className="loading-dot" />
              <span className="loading-dot" />
            </div>
          )}
        </div>
      )}

      {health.stores.rateLimit && (
        <div className="overview-section">
          <div className="overview-section-header">
            <h2 className="overview-section-title">Rate Limit</h2>
            <StoreInfo
              type={health.stores.rateLimit.type}
              capabilities={health.stores.rateLimit.capabilities}
            />
          </div>
          {rateLimitStats.data && (
            <div className="overview-stats">
              <OverviewStat
                label="Total Requests"
                value={String(
                  (rateLimitStats.data.stats as Record<string, number>)
                    .totalRequests ?? 0,
                )}
              />
              <OverviewStat
                label="Resources"
                value={String(
                  (rateLimitStats.data.stats as Record<string, number>)
                    .totalResources ??
                    (rateLimitStats.data.stats as Record<string, number>)
                      .uniqueResources ??
                    0,
                )}
              />
              <OverviewStat
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
            </div>
          )}
          {rateLimitStats.loading && (
            <div className="loading">
              <span className="loading-dot" />
              <span className="loading-dot" />
              <span className="loading-dot" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
