import { HttpClient } from '@http-client-toolkit/core';
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
          client: new HttpClient({
            name: 'test-client',
            cache: { store: cacheStore },
            dedupe: dedupeStore,
            rateLimit: { store: rateLimitStore },
          }),
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

    it('GET /api/clients/:name/cache/entries with query params should paginate', async () => {
      await cacheStore.set('key1', 'value1', 60);
      await cacheStore.set('key2', 'value2', 60);
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/cache/entries?page=0&limit=1',
      );
      expect(status).toBe(200);
      expect(body.entries).toHaveLength(1);
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
        clients: [
          {
            client: new HttpClient({
              name: 'no-cache',
              dedupe: dedupeStore,
            }),
          },
        ],
      });
      const { status, body } = await fetchJson(
        h,
        '/api/clients/no-cache/cache/stats',
      );
      expect(status).toBe(404);
      expect(body.error).toBe('Cache store not configured');
    });

    it('should return 405 for unsupported method on single cache entry', async () => {
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/cache/entries/key1',
        { method: 'PATCH' },
      );
      expect(status).toBe(405);
      expect(body.error).toBe('Method not allowed');
    });

    it('should return 500 when cache adapter throws', async () => {
      cacheStore.getStats = () => {
        throw new Error('cache boom');
      };
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/cache/stats',
      );
      expect(status).toBe(500);
      expect(body.error).toBe('cache boom');
    });

    it('should return 404 for unknown cache subpath', async () => {
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/cache/unknown-route',
      );
      expect(status).toBe(404);
      expect(body.error).toBe('Not found');
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

    it('GET /api/clients/:name/dedup/jobs/:hash should return a single job', async () => {
      await dedupeStore.register('hash1');
      await dedupeStore.complete('hash1', 'value');
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/dedup/jobs/hash1',
      );
      expect(status).toBe(200);
      expect(body.hash).toBe('hash1');
    });

    it('GET /api/clients/:name/dedup/jobs/:hash should return 404 for missing job', async () => {
      const { status } = await fetchJson(
        handler,
        '/api/clients/test-client/dedup/jobs/nonexistent',
      );
      expect(status).toBe(404);
    });

    it('should return 404 when dedup store not configured', async () => {
      const h = createDashboardHandler({
        clients: [
          {
            client: new HttpClient({
              name: 'no-dedup',
              cache: { store: cacheStore },
            }),
          },
        ],
      });
      const { status, body } = await fetchJson(
        h,
        '/api/clients/no-dedup/dedup/stats',
      );
      expect(status).toBe(404);
      expect(body.error).toBe('Dedup store not configured');
    });

    it('should return 405 for unsupported method on single dedup job', async () => {
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/dedup/jobs/hash1',
        { method: 'PATCH' },
      );
      expect(status).toBe(405);
      expect(body.error).toBe('Method not allowed');
    });

    it('should return 500 when dedup adapter throws', async () => {
      dedupeStore.getStats = () => {
        throw new Error('dedup boom');
      };
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/dedup/stats',
      );
      expect(status).toBe(500);
      expect(body.error).toBe('dedup boom');
    });

    it('should return 404 for unknown dedup subpath', async () => {
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/dedup/unknown-route',
      );
      expect(status).toBe(404);
      expect(body.error).toBe('Not found');
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

    it('PUT /api/clients/:name/rate-limit/resources/:name/config should update config', async () => {
      await rateLimitStore.record('api-resource');
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/rate-limit/resources/api-resource/config',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 100, windowMs: 60000 }),
        },
      );
      expect(status).toBe(200);
      expect(body.updated).toBe(true);
    });

    it('GET /api/clients/:name/rate-limit/resources/:name should return resource status', async () => {
      await rateLimitStore.record('api-resource');
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/rate-limit/resources/api-resource',
      );
      expect(status).toBe(200);
      expect(body.resource).toBe('api-resource');
    });

    it('should return 404 when rate limit store not configured', async () => {
      const h = createDashboardHandler({
        clients: [
          {
            client: new HttpClient({
              name: 'no-rl',
              cache: { store: cacheStore },
            }),
          },
        ],
      });
      const { status, body } = await fetchJson(
        h,
        '/api/clients/no-rl/rate-limit/stats',
      );
      expect(status).toBe(404);
      expect(body.error).toBe('Rate limit store not configured');
    });

    it('should return 405 for unsupported method on single rate-limit resource', async () => {
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/rate-limit/resources/res1',
        { method: 'PATCH' },
      );
      expect(status).toBe(405);
      expect(body.error).toBe('Method not allowed');
    });

    it('should return 500 when rate-limit adapter throws', async () => {
      rateLimitStore.getStats = () => {
        throw new Error('rate-limit boom');
      };
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/rate-limit/stats',
      );
      expect(status).toBe(500);
      expect(body.error).toBe('rate-limit boom');
    });

    it('should return 404 for unknown rate-limit subpath', async () => {
      const { status, body } = await fetchJson(
        handler,
        '/api/clients/test-client/rate-limit/unknown-route',
      );
      expect(status).toBe(404);
      expect(body.error).toBe('Not found');
    });
  });

  it('should return 404 for unknown API routes', async () => {
    const { status } = await fetchJson(handler, '/api/unknown');
    expect(status).toBe(404);
  });

  it('should return 404 for client route with no subpath', async () => {
    const { status, body } = await fetchJson(
      handler,
      '/api/clients/test-client',
    );
    expect(status).toBe(404);
    expect(body.error).toBe('Not found');
  });

  it('should return 404 for unknown client subpath', async () => {
    const { status, body } = await fetchJson(
      handler,
      '/api/clients/test-client/unknown-store/stats',
    );
    expect(status).toBe(404);
    expect(body.error).toBe('Not found');
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

  it('should return 500 for handler-level errors', async () => {
    const badRequest = new Request('http://localhost/api/health');
    Object.defineProperty(badRequest, 'url', {
      get() {
        throw new Error('bad url');
      },
    });
    const res = await handler(badRequest);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal server error');
  });

  describe('basePath support', () => {
    it('should strip basePath from URL', async () => {
      const h = createDashboardHandler({
        clients: [
          {
            client: new HttpClient({
              name: 'test-client',
              cache: { store: cacheStore },
              dedupe: dedupeStore,
              rateLimit: { store: rateLimitStore },
            }),
          },
        ],
        basePath: '/dashboard',
      });
      const { status, body } = await fetchJson(h, '/dashboard/api/health');
      expect(status).toBe(200);
      expect(body.status).toBe('ok');
    });

    it('should serve SPA fallback when URL equals basePath exactly', async () => {
      const h = createDashboardHandler({
        clients: [
          {
            client: new HttpClient({
              name: 'test-client',
              cache: { store: cacheStore },
              dedupe: dedupeStore,
              rateLimit: { store: rateLimitStore },
            }),
          },
        ],
        basePath: '/dashboard',
      });
      const res = await h(makeRequest('/dashboard'));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/html');
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
          {
            client: new HttpClient({
              name: 'client-a',
              cache: { store: cacheA },
            }),
          },
          {
            client: new HttpClient({
              name: 'client-b',
              cache: { store: cacheB },
            }),
          },
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

  describe('partial store configurations', () => {
    it('health should return null for cache when only dedup configured', async () => {
      const dedupOnly = new InMemoryDedupeStore();
      const h = createDashboardHandler({
        clients: [
          {
            client: new HttpClient({
              name: 'dedup-only',
              dedupe: dedupOnly,
            }),
          },
        ],
      });

      const { status, body } = await fetchJson(h, '/api/health');
      expect(status).toBe(200);
      expect(body.clients['dedup-only'].cache).toBeNull();
      expect(body.clients['dedup-only'].dedup).not.toBeNull();
      expect(body.clients['dedup-only'].rateLimit).toBeNull();

      dedupOnly.destroy();
    });

    it('health should return null for dedup when only cache configured', async () => {
      const cacheOnly = new InMemoryCacheStore();
      const h = createDashboardHandler({
        clients: [
          {
            client: new HttpClient({
              name: 'cache-only',
              cache: { store: cacheOnly },
            }),
          },
        ],
      });

      const { status, body } = await fetchJson(h, '/api/health');
      expect(status).toBe(200);
      expect(body.clients['cache-only'].cache).not.toBeNull();
      expect(body.clients['cache-only'].dedup).toBeNull();
      expect(body.clients['cache-only'].rateLimit).toBeNull();

      cacheOnly.destroy();
    });

    it('clients should return null for cache when only dedup configured', async () => {
      const dedupOnly = new InMemoryDedupeStore();
      const h = createDashboardHandler({
        clients: [
          {
            client: new HttpClient({
              name: 'dedup-only',
              dedupe: dedupOnly,
            }),
          },
        ],
      });

      const { status, body } = await fetchJson(h, '/api/clients');
      expect(status).toBe(200);
      expect(body.clients[0].stores.cache).toBeNull();
      expect(body.clients[0].stores.dedup).not.toBeNull();

      dedupOnly.destroy();
    });
  });

  describe('readonly mode', () => {
    let readonlyHandler: DashboardFetchHandler;
    let roCacheStore: InMemoryCacheStore;
    let roRateLimitStore: InMemoryRateLimitStore;

    beforeEach(() => {
      roCacheStore = new InMemoryCacheStore();
      roRateLimitStore = new InMemoryRateLimitStore();

      readonlyHandler = createDashboardHandler({
        clients: [
          {
            client: new HttpClient({
              name: 'test-client',
              cache: { store: roCacheStore },
              rateLimit: { store: roRateLimitStore },
            }),
          },
        ],
        readonly: true,
      });
    });

    afterEach(() => {
      roCacheStore.destroy();
      roRateLimitStore.destroy();
    });

    it('should allow GET requests in readonly mode', async () => {
      const { status } = await fetchJson(
        readonlyHandler,
        '/api/clients/test-client/cache/stats',
      );
      expect(status).toBe(200);
    });

    it('should block DELETE requests in readonly mode', async () => {
      const { status, body } = await fetchJson(
        readonlyHandler,
        '/api/clients/test-client/cache/entries',
        { method: 'DELETE' },
      );
      expect(status).toBe(403);
      expect(body.error).toBe('Dashboard is in readonly mode');
    });

    it('should block PUT requests in readonly mode', async () => {
      const { status, body } = await fetchJson(
        readonlyHandler,
        '/api/clients/test-client/rate-limit/resources/api/config',
        {
          method: 'PUT',
          body: JSON.stringify({ limit: 100, windowMs: 60000 }),
        },
      );
      expect(status).toBe(403);
      expect(body.error).toBe('Dashboard is in readonly mode');
    });

    it('should block POST requests in readonly mode', async () => {
      const { status, body } = await fetchJson(
        readonlyHandler,
        '/api/clients/test-client/rate-limit/resources/api/reset',
        { method: 'POST' },
      );
      expect(status).toBe(403);
      expect(body.error).toBe('Dashboard is in readonly mode');
    });
  });
});
