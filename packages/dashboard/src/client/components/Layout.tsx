import type { ReactNode } from 'react';

interface LayoutProps {
  currentView: string;
  onNavigate: (view: string) => void;
  hasCache: boolean;
  hasDedup: boolean;
  hasRateLimit: boolean;
  clientNames: Array<string>;
  selectedClient: string;
  onSelectClient: (name: string) => void;
  children: ReactNode;
}

export function Layout({
  currentView,
  onNavigate,
  hasCache,
  hasDedup,
  hasRateLimit,
  clientNames,
  selectedClient,
  onSelectClient,
  children,
}: LayoutProps) {
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-brand">HTTP Client Toolkit</div>

        {clientNames.length > 1 && (
          <>
            <div className="sidebar-title">Clients</div>
            <div className="client-selector">
              {clientNames.map((name) => (
                <button
                  key={name}
                  className={`client-item ${selectedClient === name ? 'active' : ''}`}
                  onClick={() => onSelectClient(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="sidebar-title">Dashboard</div>

        <button
          className={`nav-item ${currentView === 'overview' ? 'active' : ''}`}
          onClick={() => onNavigate('overview')}
        >
          Overview
        </button>

        {hasCache && (
          <button
            className={`nav-item ${currentView === 'cache' ? 'active' : ''}`}
            onClick={() => onNavigate('cache')}
          >
            Cache
          </button>
        )}

        {hasDedup && (
          <button
            className={`nav-item ${currentView === 'dedup' ? 'active' : ''}`}
            onClick={() => onNavigate('dedup')}
          >
            Dedup
          </button>
        )}

        {hasRateLimit && (
          <button
            className={`nav-item ${currentView === 'rate-limit' ? 'active' : ''}`}
            onClick={() => onNavigate('rate-limit')}
          >
            Rate Limit
          </button>
        )}
      </nav>

      <main className="main">{children}</main>
    </div>
  );
}
