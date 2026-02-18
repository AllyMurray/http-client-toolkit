import { HttpClient } from '@http-client-toolkit/core';
import { InMemoryCacheStore } from '@http-client-toolkit/store-memory';
import { describe, it, expect, afterEach } from 'vitest';
import {
  startDashboard,
  type StandaloneDashboardServer,
} from './standalone.js';

describe('startDashboard', () => {
  let dashboard: StandaloneDashboardServer | undefined;
  let cacheStore: InMemoryCacheStore | undefined;

  afterEach(async () => {
    if (dashboard) {
      await dashboard.close();
      dashboard = undefined;
    }
    if (cacheStore) {
      cacheStore.destroy();
      cacheStore = undefined;
    }
  });

  it('should start a server and respond to health check', async () => {
    cacheStore = new InMemoryCacheStore();
    const client = new HttpClient({ name: 'test-client', cache: cacheStore });
    dashboard = await startDashboard({
      clients: [{ client }],
      port: 0, // Random available port
      host: '127.0.0.1',
    });

    const addr = dashboard.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.clients['test-client']).toBeDefined();
  });

  it('should be closable', async () => {
    cacheStore = new InMemoryCacheStore();
    const client = new HttpClient({ name: 'test-client', cache: cacheStore });
    dashboard = await startDashboard({
      clients: [{ client }],
      port: 0,
      host: '127.0.0.1',
    });

    await dashboard.close();
    dashboard = undefined; // Prevent double-close in afterEach
  });
});
