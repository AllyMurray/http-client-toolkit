import { useState } from 'react';
import { CacheView } from './components/CacheView.js';
import { Dashboard } from './components/Dashboard.js';
import { DedupeView } from './components/DedupeView.js';
import { Layout } from './components/Layout.js';
import { RateLimitView } from './components/RateLimitView.js';
import { useStores } from './hooks/useStores.js';

function getInitialView(): string {
  const hash = window.location.hash.replace('#', '');
  return hash || 'overview';
}

export function App() {
  const [currentView, setCurrentView] = useState(getInitialView);
  const { health, error, loading } = useStores();

  const handleNavigate = (view: string) => {
    setCurrentView(view);
    window.location.hash = view;
  };

  if (loading) {
    return (
      <div className="loading" style={{ height: '100vh' }}>
        Loading dashboard...
      </div>
    );
  }

  if (error || !health) {
    return (
      <div
        className="loading"
        style={{ height: '100vh', flexDirection: 'column', gap: '0.5rem' }}
      >
        <div style={{ fontWeight: 600 }}>Failed to connect</div>
        <div
          style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}
        >
          {error ?? 'Could not reach the dashboard API.'}
        </div>
      </div>
    );
  }

  const renderView = () => {
    switch (currentView) {
      case 'cache':
        return <CacheView health={health} />;
      case 'dedup':
        return <DedupeView health={health} />;
      case 'rate-limit':
        return <RateLimitView health={health} />;
      default:
        return <Dashboard health={health} />;
    }
  };

  return (
    <Layout
      currentView={currentView}
      onNavigate={handleNavigate}
      hasCache={!!health.stores.cache}
      hasDedup={!!health.stores.dedup}
      hasRateLimit={!!health.stores.rateLimit}
    >
      {renderView()}
    </Layout>
  );
}
