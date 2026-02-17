import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from 'http';
import {
  InMemoryCacheStore,
  InMemoryDedupeStore,
  InMemoryRateLimitStore,
} from '@http-client-toolkit/store-memory';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDashboard } from './middleware.js';

function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function fetchJson(port: number, path: string, init?: RequestInit) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  return { status: res.status, body: await res.json() };
}

describe('createDashboard middleware', () => {
  let cacheStore: InMemoryCacheStore;
  let dedupeStore: InMemoryDedupeStore;
  let rateLimitStore: InMemoryRateLimitStore;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    cacheStore = new InMemoryCacheStore();
    dedupeStore = new InMemoryDedupeStore();
    rateLimitStore = new InMemoryRateLimitStore();

    const middleware = createDashboard({
      cacheStore,
      dedupeStore,
      rateLimitStore,
    });

    const result = await startServer(middleware);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    await closeServer(server);
    cacheStore.destroy();
    dedupeStore.destroy();
    rateLimitStore.destroy();
  });

  it('GET /api/health should return ok', async () => {
    const { status, body } = await fetchJson(port, '/api/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.stores.cache.type).toBe('memory');
    expect(body.stores.dedup.type).toBe('memory');
    expect(body.stores.rateLimit.type).toBe('memory');
  });

  it('GET /api/stores should list connected stores', async () => {
    const { status, body } = await fetchJson(port, '/api/stores');
    expect(status).toBe(200);
    expect(body.stores).toHaveLength(3);
  });

  describe('cache API', () => {
    it('GET /api/cache/stats should return stats', async () => {
      await cacheStore.set('key1', 'value1', 60);
      const { status, body } = await fetchJson(port, '/api/cache/stats');
      expect(status).toBe(200);
      expect(body.stats.totalItems).toBe(1);
    });

    it('GET /api/cache/entries should list entries', async () => {
      await cacheStore.set('key1', 'value1', 60);
      await cacheStore.set('key2', 'value2', 60);
      const { status, body } = await fetchJson(port, '/api/cache/entries');
      expect(status).toBe(200);
      expect(body.entries).toHaveLength(2);
    });

    it('GET /api/cache/entries/:hash should return entry', async () => {
      await cacheStore.set('key1', 'value1', 60);
      const { status, body } = await fetchJson(port, '/api/cache/entries/key1');
      expect(status).toBe(200);
      expect(body.value).toBe('value1');
    });

    it('GET /api/cache/entries/:hash should return 404 for missing', async () => {
      const { status } = await fetchJson(port, '/api/cache/entries/missing');
      expect(status).toBe(404);
    });

    it('DELETE /api/cache/entries/:hash should delete entry', async () => {
      await cacheStore.set('key1', 'value1', 60);
      const { status, body } = await fetchJson(
        port,
        '/api/cache/entries/key1',
        { method: 'DELETE' },
      );
      expect(status).toBe(200);
      expect(body.deleted).toBe(true);

      const val = await cacheStore.get('key1');
      expect(val).toBeUndefined();
    });

    it('DELETE /api/cache/entries should clear all', async () => {
      await cacheStore.set('key1', 'value1', 60);
      await cacheStore.set('key2', 'value2', 60);
      const { status, body } = await fetchJson(port, '/api/cache/entries', {
        method: 'DELETE',
      });
      expect(status).toBe(200);
      expect(body.cleared).toBe(true);
    });
  });

  describe('dedup API', () => {
    it('GET /api/dedup/stats should return stats', async () => {
      const { status, body } = await fetchJson(port, '/api/dedup/stats');
      expect(status).toBe(200);
      expect(body.stats).toBeDefined();
    });

    it('GET /api/dedup/jobs should list jobs', async () => {
      await dedupeStore.register('hash1');
      await dedupeStore.complete('hash1', 'value');
      const { status, body } = await fetchJson(port, '/api/dedup/jobs');
      expect(status).toBe(200);
      expect(body.jobs).toHaveLength(1);
    });
  });

  describe('rate limit API', () => {
    it('GET /api/rate-limit/stats should return stats', async () => {
      const { status, body } = await fetchJson(port, '/api/rate-limit/stats');
      expect(status).toBe(200);
      expect(body.stats).toBeDefined();
    });

    it('GET /api/rate-limit/resources should list resources', async () => {
      await rateLimitStore.record('api-resource');
      const { status, body } = await fetchJson(
        port,
        '/api/rate-limit/resources',
      );
      expect(status).toBe(200);
      expect(body.resources.length).toBeGreaterThanOrEqual(1);
    });

    it('POST /api/rate-limit/resources/:name/reset should reset', async () => {
      await rateLimitStore.record('api-resource');
      const { status, body } = await fetchJson(
        port,
        '/api/rate-limit/resources/api-resource/reset',
        { method: 'POST' },
      );
      expect(status).toBe(200);
      expect(body.reset).toBe(true);
    });
  });

  it('should return 404 for unknown API routes', async () => {
    const { status } = await fetchJson(port, '/api/unknown');
    expect(status).toBe(404);
  });

  it('should serve SPA fallback for non-API routes', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/some/page`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html');
  });
});
