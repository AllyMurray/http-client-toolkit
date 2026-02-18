import {
  InMemoryCacheStore,
  InMemoryDedupeStore,
  InMemoryRateLimitStore,
} from '@http-client-toolkit/store-memory';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createDashboardHandler,
  type DashboardFetchHandler,
} from './web-handler.js';

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost${path}`, init);
}

async function fetchJson(
  handler: DashboardFetchHandler,
  path: string,
  init?: RequestInit,
) {
  const res = await handler(makeRequest(path, init));
  return { status: res.status, body: await res.json() };
}

describe('createDashboardHandler', () => {
  let cacheStore: InMemoryCacheStore;
  let dedupeStore: InMemoryDedupeStore;
  let rateLimitStore: InMemoryRateLimitStore;
  let handler: DashboardFetchHandler;

  beforeEach(() => {
    cacheStore = new InMemoryCacheStore();
    dedupeStore = new InMemoryDedupeStore();
    rateLimitStore = new InMemoryRateLimitStore();

    handler = createDashboardHandler({
      clients: [
        {
          name: 'test-client',
          cacheStore,
          dedupeStore,
          rateLimitStore,
        },
      ],
    });
  });

  afterEach(() => {
    cacheStore.destroy();
    dedupeStore.destroy();
    rateLimitStore.destroy();
  });

  it('GET /api/health should return ok with clients', async () => {
    const { status, body } = await fetchJson(handler, '/api/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.clients['test-client'].cache.type).toBe('memory');
    expect(body.clients['test-client'].dedup.type).toBe('memory');
    expect(body.clients['test-client'].rateLimit.type).toBe('memory');
  });

  it('GET /api/clients should list clients', async () => {
    const { status, body } = await fetchJson(handler, '/api/clients');
    expect(status).toBe(200);
    expect(body.clients).toHaveLength(1);
    expect(body.clients[0].name).toBe('test-client');
  });

  describe('cache API', () => {
    it('GET /api/clients/:name/cache/stats should return stats', async () => {
      await cacheStore.set('key1', 'value1', 60);
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/cache/stats',
      );
      expect(status).toBe(200);
      expect(body.stats.totalItems).toBe(1);
    });

    it('GET /api/clients/:name/cache/entries should list entries', async () => {
      await cacheStore.set('key1', 'value1', 60);
      await cacheStore.set('key2', 'value2', 60);
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/cache/entries',
      );
      expect(status).toBe(200);
      expect(body.entries).toHaveLength(2);
    });

    it('GET /api/clients/:name/cache/entries/:hash should return entry', async () => {
      await cacheStore.set('key1', 'value1', 60);
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/cache/entries/key1',
      );
      expect(status).toBe(200);
      expect(body.value).toBe('value1');
    });

    it('GET /api/clients/:name/cache/entries/:hash should return 404 for missing', async () => {
      const { status } = await fetchJson(
        handler,
        '/api/clients/test-client/cache/entries/missing',
      );
      expect(status).toBe(404);
    });

    it('DELETE /api/clients/:name/cache/entries/:hash should delete entry', async () => {
      await cacheStore.set('key1', 'value1', 60);
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/cache/entries/key1',
        { method: 'DELETE' },
      );
      expect(status).toBe(200);
      expect(body.deleted).toBe(true);

      const val = await cacheStore.get('key1');
      expect(val).toBeUndefined();
    });

    it('DELETE /api/clients/:name/cache/entries should clear all', async () => {
      await cacheStore.set('key1', 'value1', 60);
      await cacheStore.set('key2', 'value2', 60);
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/cache/entries',
        { method: 'DELETE' },
      );
      expect(status).toBe(200);
      expect(body.cleared).toBe(true);
    });

    it('should return 404 when cache store not configured', async () => {
      const h = createDashboardHandler({
        clients: [{ name: 'no-cache', dedupeStore }],
      });
      const { status, body } = await fetchJson(
        h,
        '/api/clients/no-cache/cache/stats',
      );
      expect(status).toBe(404);
      expect(body.error).toBe('Cache store not configured');
    });
  });

  describe('dedup API', () => {
    it('GET /api/clients/:name/dedup/stats should return stats', async () => {
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/dedup/stats',
      );
      expect(status).toBe(200);
      expect(body.stats).toBeDefined();
    });

    it('GET /api/clients/:name/dedup/jobs should list jobs', async () => {
      await dedupeStore.register('hash1');
      await dedupeStore.complete('hash1', 'value');
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/dedup/jobs',
      );
      expect(status).toBe(200);
      expect(body.jobs).toHaveLength(1);
    });

    it('should return 404 when dedup store not configured', async () => {
      const h = createDashboardHandler({
        clients: [{ name: 'no-dedup', cacheStore }],
      });
      const { status, body } = await fetchJson(
        h,
        '/api/clients/no-dedup/dedup/stats',
      );
      expect(status).toBe(404);
      expect(body.error).toBe('Dedup store not configured');
    });
  });

  describe('rate limit API', () => {
    it('GET /api/clients/:name/rate-limit/stats should return stats', async () => {
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/rate-limit/stats',
      );
      expect(status).toBe(200);
      expect(body.stats).toBeDefined();
    });

    it('GET /api/clients/:name/rate-limit/resources should list resources', async () => {
      await rateLimitStore.record('api-resource');
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/rate-limit/resources',
      );
      expect(status).toBe(200);
      expect(body.resources.length).toBeGreaterThanOrEqual(1);
    });

    it('POST /api/clients/:name/rate-limit/resources/:name/reset should reset', async () => {
      await rateLimitStore.record('api-resource');
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/rate-limit/resources/api-resource/reset',
        { method: 'POST' },
      );
      expect(status).toBe(200);
      expect(body.reset).toBe(true);
    });

    it('should return 404 when rate limit store not configured', async () => {
      const h = createDashboardHandler({
        clients: [{ name: 'no-rl', cacheStore }],
      });
      const { status, body } = await fetchJson(
        h,
        '/api/clients/no-rl/rate-limit/stats',
      );
      expect(status).toBe(404);
      expect(body.error).toBe('Rate limit store not configured');
    });
  });

  it('should return 404 for unknown API routes', async () => {
    const { status } = await fetchJson(handler, '/api/unknown');
    expect(status).toBe(404);
  });

  it('should return 404 for unknown client', async () => {
    const { status, body } = await fetchJson(
      handler,
      '/api/clients/unknown-client/cache/stats',
    );
    expect(status).toBe(404);
    expect(body.error).toContain('Unknown client');
  });

  it('should serve SPA fallback for non-API routes', async () => {
    const res = await handler(makeRequest('/some/page'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html');
  });

  describe('basePath support', () => {
    it('should strip basePath from URL', async () => {
      const h = createDashboardHandler({
        clients: [
          {
            name: 'test-client',
            cacheStore,
            dedupeStore,
            rateLimitStore,
          },
        ],
        basePath: '/dashboard',
      });
      const { status, body } = await fetchJson(h, '/dashboard/api/health');
      expect(status).toBe(200);
      expect(body.status).toBe('ok');
    });
  });

  describe('multi-client support', () => {
    it('should route to independent clients', async () => {
      const cacheA = new InMemoryCacheStore();
      const cacheB = new InMemoryCacheStore();
      await cacheA.set('key-a', 'value-a', 60);
      await cacheB.set('key-b', 'value-b', 60);

      const h = createDashboardHandler({
        clients: [
          { name: 'client-a', cacheStore: cacheA },
          { name: 'client-b', cacheStore: cacheB },
        ],
      });

      const { body: bodyA } = await fetchJson(
        h,
        '/api/clients/client-a/cache/stats',
      );
      expect(bodyA.stats.totalItems).toBe(1);

      const { body: bodyB } = await fetchJson(
        h,
        '/api/clients/client-b/cache/stats',
      );
      expect(bodyB.stats.totalItems).toBe(1);

      cacheA.destroy();
      cacheB.destroy();
    });
  });
});
