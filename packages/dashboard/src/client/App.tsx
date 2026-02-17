import { useState, useEffect } from 'react';
import { CacheView } from './components/CacheView.js';
import { Dashboard } from './components/Dashboard.js';
import { DedupeView } from './components/DedupeView.js';
import { Layout } from './components/Layout.js';
import { RateLimitView } from './components/RateLimitView.js';
import { useStores } from './hooks/useStores.js';

function parseHash(): { client: string | undefined; view: string } {
  const hash = window.location.hash.replace('#', '');
  if (!hash) return { client: undefined, view: 'overview' };
  const slashIndex = hash.indexOf('/');
  if (slashIndex === -1) return { client: hash, view: 'overview' };
  return {
    client: hash.slice(0, slashIndex),
    view: hash.slice(slashIndex + 1) || 'overview',
  };
}

export function App() {
  const { health, error, loading } = useStores();
  const [selectedClient, setSelectedClient] = useState<string | undefined>();
  const [currentView, setCurrentView] = useState('overview');

  const clientNames = health ? Object.keys(health.clients) : [];

  // Initialize from hash or auto-select first client
  useEffect(() => {
    if (!health) return;
    const names = Object.keys(health.clients);
    if (names.length === 0) return;

    const { client, view } = parseHash();
    if (client && names.includes(client)) {
      setSelectedClient(client);
      setCurrentView(view);
    } else if (!selectedClient || !names.includes(selectedClient)) {
      setSelectedClient(names[0]);
      setCurrentView(view);
    }
  }, [health]);

  const handleNavigate = (view: string) => {
    setCurrentView(view);
    if (selectedClient) {
      window.location.hash = `${selectedClient}/${view}`;
    }
  };

  const handleSelectClient = (name: string) => {
    setSelectedClient(name);
    window.location.hash = `${name}/${currentView}`;
  };

  if (loading) {
    return (
      <div className="loading" style={{ height: '100vh' }}>
        <span className="loading-dot" />
        <span className="loading-dot" />
        <span className="loading-dot" />
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

  if (!selectedClient || !health.clients[selectedClient]) {
    return null;
  }

  const stores = health.clients[selectedClient];
  const pollIntervalMs = health.pollIntervalMs;

  const renderView = () => {
    switch (currentView) {
      case 'cache':
        return (
          <CacheView
            clientName={selectedClient}
            stores={stores}
            pollIntervalMs={pollIntervalMs}
          />
        );
      case 'dedup':
        return (
          <DedupeView
            clientName={selectedClient}
            stores={stores}
            pollIntervalMs={pollIntervalMs}
          />
        );
      case 'rate-limit':
        return (
          <RateLimitView
            clientName={selectedClient}
            stores={stores}
            pollIntervalMs={pollIntervalMs}
          />
        );
      default:
        return (
          <Dashboard
            clientName={selectedClient}
            stores={stores}
            pollIntervalMs={pollIntervalMs}
          />
        );
    }
  };

  return (
    <Layout
      currentView={currentView}
      onNavigate={handleNavigate}
      hasCache={!!stores.cache}
      hasDedup={!!stores.dedup}
      hasRateLimit={!!stores.rateLimit}
      clientNames={clientNames}
      selectedClient={selectedClient}
      onSelectClient={handleSelectClient}
    >
      {renderView()}
    </Layout>
  );
}
