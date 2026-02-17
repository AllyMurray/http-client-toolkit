import { DataTable } from './DataTable.js';
import { EmptyState } from './EmptyState.js';
import { StatsCard } from './StatsCard.js';
import { api } from '../api/client.js';
import type { RateLimitResource, HealthResponse } from '../api/types.js';
import {
  useRateLimitStats,
  useRateLimitResources,
} from '../hooks/useRateLimit.js';

interface RateLimitViewProps {
  health: HealthResponse;
}

function formatWindow(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60000).toFixed(0)}m`;
}

function utilizationBadge(requestCount: number, limit: number) {
  const ratio = limit > 0 ? requestCount / limit : 0;
  const variant =
    ratio >= 1
      ? 'badge-danger'
      : ratio >= 0.8
        ? 'badge-warning'
        : 'badge-success';
  return <span className={`badge ${variant}`}>{Math.round(ratio * 100)}%</span>;
}

export function RateLimitView({ health }: RateLimitViewProps) {
  const storeInfo = health.stores.rateLimit;
  const pollInterval = health.pollIntervalMs;
  const stats = useRateLimitStats(pollInterval, !!storeInfo);
  const resources = useRateLimitResources(
    pollInterval,
    storeInfo?.capabilities.canList ?? false,
  );

  if (!storeInfo) {
    return (
      <EmptyState
        title="Rate limit store not configured"
        description="No rate limit store was provided to the dashboard."
      />
    );
  }

  const handleReset = async (name: string) => {
    await api.resetRateLimitResource(name);
    resources.refresh();
    stats.refresh();
  };

  const columns = [
    {
      key: 'resource',
      header: 'Resource',
      render: (item: RateLimitResource) => (
        <span className="truncate" title={item.resource}>
          {item.resource}
        </span>
      ),
    },
    {
      key: 'requests',
      header: 'Requests',
      render: (item: RateLimitResource) =>
        `${item.requestCount} / ${item.limit}`,
    },
    {
      key: 'utilization',
      header: 'Utilization',
      render: (item: RateLimitResource) =>
        utilizationBadge(item.requestCount, item.limit),
    },
    {
      key: 'window',
      header: 'Window',
      render: (item: RateLimitResource) => formatWindow(item.windowMs),
    },
    ...(storeInfo.capabilities.canReset
      ? [
          {
            key: 'actions',
            header: '',
            render: (item: RateLimitResource) => (
              <button
                className="btn btn-sm"
                onClick={() => handleReset(item.resource)}
              >
                Reset
              </button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Rate Limit</h1>
        <p className="page-subtitle">Request throttling and resource limits</p>
      </div>

      {stats.data && (
        <div className="stats-grid">
          <StatsCard
            label="Total Requests"
            value={String(
              (stats.data.stats as Record<string, number>).totalRequests ?? 0,
            )}
          />
          <StatsCard
            label="Resources"
            value={String(
              (stats.data.stats as Record<string, number>).totalResources ??
                (stats.data.stats as Record<string, number>).uniqueResources ??
                0,
            )}
          />
          <StatsCard
            label="Rate Limited"
            value={String(
              (stats.data.stats as Record<string, number>)
                .rateLimitedResources ?? 0,
            )}
            variant={
              ((stats.data.stats as Record<string, number>)
                .rateLimitedResources ?? 0) > 0
                ? 'danger'
                : 'success'
            }
          />
        </div>
      )}

      <div className="section-panel">
        <div className="section-panel-header">
          <h2 className="section-title">Resources</h2>
        </div>
        {storeInfo.capabilities.canList ? (
          <DataTable
            columns={columns}
            data={resources.data?.resources ?? []}
            keyExtractor={(item) => item.resource}
          />
        ) : (
          <EmptyState
            title="Listing not available"
            description="This store type does not support resource listing."
          />
        )}
      </div>
    </div>
  );
}
