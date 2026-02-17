import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog.js';
import { DataTable } from './DataTable.js';
import { EmptyState } from './EmptyState.js';
import { StatsCard } from './StatsCard.js';
import { api } from '../api/client.js';
import type { CacheEntry, HealthResponse } from '../api/types.js';
import { useCacheEntries } from '../hooks/useCacheEntries.js';
import { useCacheStats } from '../hooks/useCacheStats.js';

interface CacheViewProps {
  health: HealthResponse;
}

function formatExpiry(expiresAt: number): string {
  if (expiresAt === 0) return 'Never';
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'Expired';
  if (diff < 60000) return `${Math.round(diff / 1000)}s`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m`;
  return `${Math.round(diff / 3600000)}h`;
}

function formatSize(bytes?: number): string {
  if (bytes === undefined) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CacheView({ health }: CacheViewProps) {
  const storeInfo = health.stores.cache;
  const pollInterval = health.pollIntervalMs;
  const stats = useCacheStats(pollInterval, !!storeInfo);
  const entries = useCacheEntries(
    pollInterval,
    storeInfo?.capabilities.canList ?? false,
  );
  const [confirmClear, setConfirmClear] = useState(false);

  if (!storeInfo) {
    return (
      <EmptyState
        title="Cache store not configured"
        description="No cache store was provided to the dashboard."
      />
    );
  }

  const handleDelete = async (hash: string) => {
    await api.deleteCacheEntry(hash);
    entries.refresh();
    stats.refresh();
  };

  const handleClear = async () => {
    await api.clearCache();
    setConfirmClear(false);
    entries.refresh();
    stats.refresh();
  };

  const columns = [
    {
      key: 'hash',
      header: 'Hash',
      render: (item: CacheEntry) => (
        <span className="truncate" title={item.hash}>
          {item.hash}
        </span>
      ),
    },
    {
      key: 'expires',
      header: 'Expires',
      render: (item: CacheEntry) => formatExpiry(item.expiresAt),
    },
    ...(storeInfo.type === 'memory'
      ? [
          {
            key: 'size',
            header: 'Size',
            render: (item: CacheEntry) => formatSize(item.size),
          },
        ]
      : []),
    ...(storeInfo.capabilities.canDelete
      ? [
          {
            key: 'actions',
            header: '',
            render: (item: CacheEntry) => (
              <button
                className="btn btn-danger btn-sm"
                onClick={() => handleDelete(item.hash)}
              >
                Delete
              </button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Cache</h1>
        <p className="page-subtitle">Cached responses and storage metrics</p>
      </div>

      {stats.data && (
        <div className="stats-grid">
          <StatsCard
            label="Total Items"
            value={String(
              (stats.data.stats as Record<string, number>).totalItems ?? 0,
            )}
          />
          <StatsCard
            label="Memory"
            value={
              (stats.data.stats as Record<string, number>).memoryUsageBytes
                ? formatSize(
                    (stats.data.stats as Record<string, number>)
                      .memoryUsageBytes,
                  )
                : `${(stats.data.stats as Record<string, number>).databaseSizeKB ?? 0} KB`
            }
            variant="info"
          />
        </div>
      )}

      <div className="section-panel">
        <div className="section-panel-header">
          <h2 className="section-title">Entries</h2>
          {storeInfo.capabilities.canClear && (
            <button
              className="btn btn-danger btn-sm"
              onClick={() => setConfirmClear(true)}
            >
              Clear All
            </button>
          )}
        </div>

        {storeInfo.capabilities.canList ? (
          <>
            <DataTable
              columns={columns}
              data={entries.data?.entries ?? []}
              keyExtractor={(item) => item.hash}
            />
            <div className="pagination">
              <button
                className="btn btn-sm"
                disabled={entries.page === 0}
                onClick={() => entries.setPage(Math.max(0, entries.page - 1))}
              >
                Previous
              </button>
              <span>Page {entries.page + 1}</span>
              <button
                className="btn btn-sm"
                disabled={(entries.data?.entries.length ?? 0) < entries.limit}
                onClick={() => entries.setPage(entries.page + 1)}
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <EmptyState
            title="Listing not available"
            description="This store type does not support entry listing."
          />
        )}
      </div>

      {confirmClear && (
        <ConfirmDialog
          title="Clear Cache"
          message="This will permanently delete all cached entries. This action cannot be undone."
          confirmLabel="Clear All"
          onConfirm={handleClear}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
