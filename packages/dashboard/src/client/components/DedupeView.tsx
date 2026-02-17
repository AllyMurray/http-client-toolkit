import { DataTable } from './DataTable.js';
import { EmptyState } from './EmptyState.js';
import { StatsCard } from './StatsCard.js';
import type { DedupeJob, HealthResponse } from '../api/types.js';
import { useDedupeStats, useDedupeJobs } from '../hooks/useDedup.js';

interface DedupeViewProps {
  health: HealthResponse;
}

function formatAge(createdAt: number): string {
  const age = Date.now() - createdAt;
  if (age < 1000) return 'just now';
  if (age < 60000) return `${Math.round(age / 1000)}s ago`;
  if (age < 3600000) return `${Math.round(age / 60000)}m ago`;
  return `${Math.round(age / 3600000)}h ago`;
}

function statusBadge(status: string) {
  const variant =
    status === 'completed'
      ? 'badge-success'
      : status === 'pending'
        ? 'badge-warning'
        : 'badge-danger';
  return <span className={`badge ${variant}`}>{status}</span>;
}

export function DedupeView({ health }: DedupeViewProps) {
  const storeInfo = health.stores.dedup;
  const pollInterval = health.pollIntervalMs;
  const stats = useDedupeStats(pollInterval, !!storeInfo);
  const jobs = useDedupeJobs(
    pollInterval,
    storeInfo?.capabilities.canList ?? false,
  );

  if (!storeInfo) {
    return (
      <EmptyState
        title="Dedup store not configured"
        description="No dedup store was provided to the dashboard."
      />
    );
  }

  const columns = [
    {
      key: 'hash',
      header: 'Hash',
      render: (item: DedupeJob) => (
        <span className="truncate" title={item.hash}>
          {item.hash}
        </span>
      ),
    },
    {
      key: 'jobId',
      header: 'Job ID',
      render: (item: DedupeJob) => (
        <span className="truncate" title={item.jobId}>
          {item.jobId.slice(0, 8)}...
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (item: DedupeJob) => statusBadge(item.status),
    },
    {
      key: 'created',
      header: 'Created',
      render: (item: DedupeJob) => formatAge(item.createdAt),
    },
  ];

  return (
    <div>
      <h1 className="page-title">Dedup</h1>

      {stats.data && (
        <div className="stats-grid">
          <StatsCard
            label="Active Jobs"
            value={String(
              (stats.data.stats as Record<string, number>).activeJobs ??
                (stats.data.stats as Record<string, number>).pendingJobs ??
                0,
            )}
            variant="info"
          />
          <StatsCard
            label="Total Processed"
            value={String(
              (stats.data.stats as Record<string, number>).totalJobsProcessed ??
                (stats.data.stats as Record<string, number>).totalJobs ??
                0,
            )}
          />
          <StatsCard
            label="Failed"
            value={String(
              (stats.data.stats as Record<string, number>).failedJobs ?? 0,
            )}
            variant={
              ((stats.data.stats as Record<string, number>).failedJobs ?? 0) > 0
                ? 'danger'
                : 'success'
            }
          />
        </div>
      )}

      <div className="section">
        <h2 className="section-title" style={{ marginBottom: '1rem' }}>
          Jobs
        </h2>
        {storeInfo.capabilities.canList ? (
          <>
            <DataTable
              columns={columns}
              data={jobs.data?.jobs ?? []}
              keyExtractor={(item) => item.hash}
            />
            <div className="pagination">
              <button
                className="btn btn-sm"
                disabled={jobs.page === 0}
                onClick={() => jobs.setPage(Math.max(0, jobs.page - 1))}
              >
                Previous
              </button>
              <span>Page {jobs.page + 1}</span>
              <button
                className="btn btn-sm"
                disabled={(jobs.data?.jobs.length ?? 0) < jobs.limit}
                onClick={() => jobs.setPage(jobs.page + 1)}
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <EmptyState
            title="Listing not available"
            description="This store type does not support job listing."
          />
        )}
      </div>
    </div>
  );
}
