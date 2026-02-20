import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from 'http';
import { HttpClient } from '@http-client-toolkit/core';
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

    const client = new HttpClient({
      name: 'test-client',
      cache: { store: cacheStore },
      dedupe: dedupeStore,
      rateLimit: { store: rateLimitStore },
    });

    const middleware = createDashboard({
      clients: [{ client }],
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

  it('GET /api/health should return ok with clients', async () => {
    const { status, body } = await fetchJson(port, '/api/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.clients['test-client'].cache.type).toBe('memory');
    expect(body.clients['test-client'].dedup.type).toBe('memory');
    expect(body.clients['test-client'].rateLimit.type).toBe('memory');
  });

  it('GET /api/clients should list clients', async () => {
    const { status, body } = await fetchJson(port, '/api/clients');
    expect(status).toBe(200);
    expect(body.clients).toHaveLength(1);
    expect(body.clients[0].name).toBe('test-client');
    expect(body.clients[0].stores.cache).not.toBeNull();
  });

  describe('cache API', () => {
    it('GET /api/clients/:name/cache/stats should return stats', async () => {
      await cacheStore.set('key1', 'value1', 60);
      const { status, body } = await fetchJson(
        port,
        '/api/clients/test-client/cache/stats',
      );
      expect(status).toBe(200);
      expect(body.stats.totalItems).toBe(1);
    });

    it('GET /api/clients/:name/cache/entries should list entries', async () => {
      await cacheStore.set('key1', 'value1', 60);
      await cacheStore.set('key2', 'value2', 60);
      const { status, body } = await fetchJson(
        port,
        '/api/clients/test-client/cache/entries',
      );
      expect(status).toBe(200);
      expect(body.entries).toHaveLength(2);
    });

    it('GET /api/clients/:name/cache/entries/:hash should return entry', async () => {
      await cacheStore.set('key1', 'value1', 60);
      const { status, body } = await fetchJson(
        port,
        '/api/clients/test-client/cache/entries/key1',
      );
      expect(status).toBe(200);
      expect(body.value).toBe('value1');
    });

    it('GET /api/clients/:name/cache/entries/:hash should return 404 for missing', async () => {
      const { status } = await fetchJson(
        port,
        '/api/clients/test-client/cache/entries/missing',
      );
      expect(status).toBe(404);
    });

    it('PUT /api/clients/:name/cache/entries/:hash should return 405', async () => {
      await cacheStore.set('key1', 'value1', 60);
      const { status, body } = await fetchJson(
        port,
        '/api/clients/test-client/cache/entries/key1',
        { method: 'PUT' },
      );
      expect(status).toBe(405);
      expect(body.error).toBe('Method not allowed');
    });

    it('DELETE /api/clients/:name/cache/entries/:hash should delete entry', async () => {
      await cacheStore.set('key1', 'value1', 60);
      const { status, body } = await fetchJson(
        port,
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
        port,
        '/api/clients/test-client/cache/entries',
        { method: 'DELETE' },
      );
      expect(status).toBe(200);
      expect(body.cleared).toBe(true);
    });
  });

  describe('dedup API', () => {
    it('GET /api/clients/:name/dedup/stats should return stats', async () => {
      const { status, body } = await fetchJson(
        port,
        '/api/clients/test-client/dedup/stats',
      );
      expect(status).toBe(200);
      expect(body.stats).toBeDefined();
    });

    it('GET /api/clients/:name/dedup/jobs should list jobs', async () => {
      await dedupeStore.register('hash1');
      await dedupeStore.complete('hash1', 'value');
      const { status, body } = await fetchJson(
        port,
        '/api/clients/test-client/dedup/jobs',
      );
      expect(status).toBe(200);
      expect(body.jobs).toHaveLength(1);
    });

    it('GET /api/clients/:name/dedup/jobs/:hash should return a single job', async () => {
      await dedupeStore.register('hash1');
      await dedupeStore.complete('hash1', 'result-value');
      const { status, body } = await fetchJson(
        port,
        '/api/clients/test-client/dedup/jobs/hash1',
      );
      expect(status).toBe(200);
      expect(body.hash).toBe('hash1');
    });
  });

  describe('rate limit API', () => {
    it('GET /api/clients/:name/rate-limit/stats should return stats', async () => {
      const { status, body } = await fetchJson(
        port,
        '/api/clients/test-client/rate-limit/stats',
      );
      expect(status).toBe(200);
      expect(body.stats).toBeDefined();
    });

    it('GET /api/clients/:name/rate-limit/resources should list resources', async () => {
      await rateLimitStore.record('api-resource');
      const { status, body } = await fetchJson(
        port,
        '/api/clients/test-client/rate-limit/resources',
      );
      expect(status).toBe(200);
      expect(body.resources.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/clients/:name/rate-limit/resources/:name should return resource status', async () => {
      await rateLimitStore.record('api-resource');
      const { status, body } = await fetchJson(
        port,
        '/api/clients/test-client/rate-limit/resources/api-resource',
      );
      expect(status).toBe(200);
      expect(body.resource).toBe('api-resource');
    });

    it('PUT /api/clients/:name/rate-limit/resources/:name/config should update config', async () => {
      await rateLimitStore.record('api-resource');
      const { status, body } = await fetchJson(
        port,
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

    it('POST /api/clients/:name/rate-limit/resources/:name/reset should reset', async () => {
      await rateLimitStore.record('api-resource');
      const { status, body } = await fetchJson(
        port,
        '/api/clients/test-client/rate-limit/resources/api-resource/reset',
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

  it('should return 404 for unknown client', async () => {
    const { status, body } = await fetchJson(
      port,
      '/api/clients/unknown-client/cache/stats',
    );
    expect(status).toBe(404);
    expect(body.error).toContain('Unknown client');
  });

  it('should serve SPA fallback for non-API routes', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/some/page`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html');
  });

  describe('multi-client support', () => {
    let multiServer: Server;
    let multiPort: number;
    let cacheStoreA: InMemoryCacheStore;
    let cacheStoreB: InMemoryCacheStore;

    afterEach(async () => {
      if (multiServer) await closeServer(multiServer);
      cacheStoreA?.destroy();
      cacheStoreB?.destroy();
    });

    it('should route to independent clients', async () => {
      cacheStoreA = new InMemoryCacheStore();
      cacheStoreB = new InMemoryCacheStore();

      await cacheStoreA.set('key-a', 'value-a', 60);
      await cacheStoreB.set('key-b', 'value-b', 60);

      const middleware = createDashboard({
        clients: [
          {
            client: new HttpClient({
              name: 'client-a',
              cache: { store: cacheStoreA },
            }),
          },
          {
            client: new HttpClient({
              name: 'client-b',
              cache: { store: cacheStoreB },
            }),
          },
        ],
      });

      const result = await startServer(middleware);
      multiServer = result.server;
      multiPort = result.port;

      const { body: bodyA } = await fetchJson(
        multiPort,
        '/api/clients/client-a/cache/stats',
      );
      expect(bodyA.stats.totalItems).toBe(1);

      const { body: bodyB } = await fetchJson(
        multiPort,
        '/api/clients/client-b/cache/stats',
      );
      expect(bodyB.stats.totalItems).toBe(1);

      const { body: health } = await fetchJson(multiPort, '/api/health');
      expect(Object.keys(health.clients)).toHaveLength(2);
    });
  });

  describe('basePath support', () => {
    let basePathServer: Server;
    let basePathPort: number;

    afterEach(async () => {
      if (basePathServer) await closeServer(basePathServer);
    });

    it('should strip basePath and route correctly', async () => {
      const middleware = createDashboard({
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

      const result = await startServer(middleware);
      basePathServer = result.server;
      basePathPort = result.port;

      const { status, body } = await fetchJson(
        basePathPort,
        '/dashboard/api/health',
      );
      expect(status).toBe(200);
      expect(body.status).toBe('ok');
    });
  });

  describe('dedup job not found', () => {
    it('GET /api/clients/:name/dedup/jobs/:hash should return 404 for missing job', async () => {
      const { status, body } = await fetchJson(
        port,
        '/api/clients/test-client/dedup/jobs/nonexistent',
      );
      expect(status).toBe(404);
      expect(body.error).toBe('Not found');
    });
  });

  describe('method not allowed on dedup single job', () => {
    it('PUT /api/clients/:name/dedup/jobs/:hash should return 405', async () => {
      await dedupeStore.register('hash1');
      await dedupeStore.complete('hash1', 'value');
      const { status, body } = await fetchJson(
        port,
        '/api/clients/test-client/dedup/jobs/hash1',
        { method: 'PUT' },
      );
      expect(status).toBe(405);
      expect(body.error).toBe('Method not allowed');
    });
  });

  describe('method not allowed on rate-limit single resource', () => {
    it('PUT /api/clients/:name/rate-limit/resources/:name should return 405', async () => {
      await rateLimitStore.record('api-resource');
      const { status, body } = await fetchJson(
        port,
        '/api/clients/test-client/rate-limit/resources/api-resource',
        { method: 'PUT' },
      );
      expect(status).toBe(405);
      expect(body.error).toBe('Method not allowed');
    });
  });

  describe('unknown subpath fall-through', () => {
    it('GET /api/clients/:name/unknown should return 404', async () => {
      const { status, body } = await fetchJson(
        port,
        '/api/clients/test-client/unknown',
      );
      expect(status).toBe(404);
      expect(body.error).toBe('Not found');
    });
  });

  describe('partial store configurations', () => {
    let partialServer: Server;
    let partialPort: number;
    let partialCacheStore: InMemoryCacheStore;
    let partialDedupeStore: InMemoryDedupeStore;

    afterEach(async () => {
      if (partialServer) await closeServer(partialServer);
      partialCacheStore?.destroy();
      partialDedupeStore?.destroy();
    });

    it('health should return null for missing stores', async () => {
      partialCacheStore = new InMemoryCacheStore();
      const middleware = createDashboard({
        clients: [
          {
            client: new HttpClient({
              name: 'cache-only',
              cache: { store: partialCacheStore },
            }),
          },
        ],
      });

      const result = await startServer(middleware);
      partialServer = result.server;
      partialPort = result.port;

      const { status, body } = await fetchJson(partialPort, '/api/health');
      expect(status).toBe(200);
      expect(body.clients['cache-only'].cache).not.toBeNull();
      expect(body.clients['cache-only'].dedup).toBeNull();
      expect(body.clients['cache-only'].rateLimit).toBeNull();
    });

    it('clients should return null for missing stores', async () => {
      partialCacheStore = new InMemoryCacheStore();
      const middleware = createDashboard({
        clients: [
          {
            client: new HttpClient({
              name: 'cache-only',
              cache: { store: partialCacheStore },
            }),
          },
        ],
      });

      const result = await startServer(middleware);
      partialServer = result.server;
      partialPort = result.port;

      const { status, body } = await fetchJson(partialPort, '/api/clients');
      expect(status).toBe(200);
      expect(body.clients[0].stores.cache).not.toBeNull();
      expect(body.clients[0].stores.dedup).toBeNull();
      expect(body.clients[0].stores.rateLimit).toBeNull();
    });

    it('should return 404 for dedup routes when dedup not configured', async () => {
      partialCacheStore = new InMemoryCacheStore();
      const middleware = createDashboard({
        clients: [
          {
            client: new HttpClient({
              name: 'cache-only',
              cache: { store: partialCacheStore },
            }),
          },
        ],
      });

      const result = await startServer(middleware);
      partialServer = result.server;
      partialPort = result.port;

      const { status, body } = await fetchJson(
        partialPort,
        '/api/clients/cache-only/dedup/stats',
      );
      expect(status).toBe(404);
      expect(body.error).toContain('Dedup store not configured');
    });

    it('should return 404 for rate-limit routes when rateLimit not configured', async () => {
      partialCacheStore = new InMemoryCacheStore();
      const middleware = createDashboard({
        clients: [
          {
            client: new HttpClient({
              name: 'cache-only',
              cache: { store: partialCacheStore },
            }),
          },
        ],
      });

      const result = await startServer(middleware);
      partialServer = result.server;
      partialPort = result.port;

      const { status, body } = await fetchJson(
        partialPort,
        '/api/clients/cache-only/rate-limit/stats',
      );
      expect(status).toBe(404);
      expect(body.error).toContain('Rate limit store not configured');
    });

    it('health should return null for cache when only dedup configured', async () => {
      partialDedupeStore = new InMemoryDedupeStore();
      const middleware = createDashboard({
        clients: [
          {
            client: new HttpClient({
              name: 'dedup-only',
              dedupe: partialDedupeStore,
            }),
          },
        ],
      });

      const result = await startServer(middleware);
      partialServer = result.server;
      partialPort = result.port;

      const { status, body } = await fetchJson(partialPort, '/api/health');
      expect(status).toBe(200);
      expect(body.clients['dedup-only'].cache).toBeNull();
      expect(body.clients['dedup-only'].dedup).not.toBeNull();
      expect(body.clients['dedup-only'].rateLimit).toBeNull();
    });

    it('clients should return null for cache when only dedup configured', async () => {
      partialDedupeStore = new InMemoryDedupeStore();
      const middleware = createDashboard({
        clients: [
          {
            client: new HttpClient({
              name: 'dedup-only',
              dedupe: partialDedupeStore,
            }),
          },
        ],
      });

      const result = await startServer(middleware);
      partialServer = result.server;
      partialPort = result.port;

      const { status, body } = await fetchJson(partialPort, '/api/clients');
      expect(status).toBe(200);
      expect(body.clients[0].stores.cache).toBeNull();
      expect(body.clients[0].stores.dedup).not.toBeNull();
    });

    it('should return 404 for cache routes when cache not configured', async () => {
      partialDedupeStore = new InMemoryDedupeStore();
      const middleware = createDashboard({
        clients: [
          {
            client: new HttpClient({
              name: 'dedup-only',
              dedupe: partialDedupeStore,
            }),
          },
        ],
      });

      const result = await startServer(middleware);
      partialServer = result.server;
      partialPort = result.port;

      const { status, body } = await fetchJson(
        partialPort,
        '/api/clients/dedup-only/cache/stats',
      );
      expect(status).toBe(404);
      expect(body.error).toContain('Cache store not configured');
    });
  });

  describe('handler error paths', () => {
    let errServer: Server;
    let errPort: number;
    let errCacheStore: InMemoryCacheStore;
    let errDedupeStore: InMemoryDedupeStore;
    let errRateLimitStore: InMemoryRateLimitStore;

    afterEach(async () => {
      if (errServer) await closeServer(errServer);
      errCacheStore?.destroy();
      errDedupeStore?.destroy();
      errRateLimitStore?.destroy();
    });

    async function setupErrServer() {
      const middleware = createDashboard({
        clients: [
          {
            client: new HttpClient({
              name: 'err-client',
              cache: { store: errCacheStore },
              dedupe: errDedupeStore,
              rateLimit: { store: errRateLimitStore },
            }),
          },
        ],
      });
      const result = await startServer(middleware);
      errServer = result.server;
      errPort = result.port;
    }

    it('cache stats error returns 500', async () => {
      errCacheStore = new InMemoryCacheStore();
      errDedupeStore = new InMemoryDedupeStore();
      errRateLimitStore = new InMemoryRateLimitStore();

      // Monkey-patch getStats to throw after adapter is created
      const origGetStats = errCacheStore.getStats.bind(errCacheStore);
      errCacheStore.getStats = () => {
        throw new Error('stats boom');
      };

      await setupErrServer();

      const { status, body } = await fetchJson(
        errPort,
        '/api/clients/err-client/cache/stats',
      );
      expect(status).toBe(500);
      expect(body.error).toBe('stats boom');

      // Restore so destroy works
      errCacheStore.getStats = origGetStats;
    });

    it('cache entries error returns 500', async () => {
      errCacheStore = new InMemoryCacheStore();
      errDedupeStore = new InMemoryDedupeStore();
      errRateLimitStore = new InMemoryRateLimitStore();

      const origListEntries = errCacheStore.listEntries.bind(errCacheStore);
      errCacheStore.listEntries = () => {
        throw new Error('list entries boom');
      };

      await setupErrServer();

      const { status, body } = await fetchJson(
        errPort,
        '/api/clients/err-client/cache/entries',
      );
      expect(status).toBe(500);
      expect(body.error).toBe('list entries boom');

      errCacheStore.listEntries = origListEntries;
    });

    it('cache single entry error returns 500', async () => {
      errCacheStore = new InMemoryCacheStore();
      errDedupeStore = new InMemoryDedupeStore();
      errRateLimitStore = new InMemoryRateLimitStore();

      await errCacheStore.set('key1', 'value1', 60);

      // Monkey-patch get to throw
      const origGet = errCacheStore.get.bind(errCacheStore);
      errCacheStore.get = () => {
        throw new Error('get entry boom');
      };

      await setupErrServer();

      const { status, body } = await fetchJson(
        errPort,
        '/api/clients/err-client/cache/entries/key1',
      );
      expect(status).toBe(500);
      expect(body.error).toBe('get entry boom');

      errCacheStore.get = origGet;
    });

    it('cache delete entry error returns 500', async () => {
      errCacheStore = new InMemoryCacheStore();
      errDedupeStore = new InMemoryDedupeStore();
      errRateLimitStore = new InMemoryRateLimitStore();

      const origDelete = errCacheStore.delete.bind(errCacheStore);
      errCacheStore.delete = () => {
        throw new Error('delete entry boom');
      };

      await setupErrServer();

      const { status, body } = await fetchJson(
        errPort,
        '/api/clients/err-client/cache/entries/somekey',
        { method: 'DELETE' },
      );
      expect(status).toBe(500);
      expect(body.error).toBe('delete entry boom');

      errCacheStore.delete = origDelete;
    });

    it('cache clear error returns 500', async () => {
      errCacheStore = new InMemoryCacheStore();
      errDedupeStore = new InMemoryDedupeStore();
      errRateLimitStore = new InMemoryRateLimitStore();

      const origClear = errCacheStore.clear.bind(errCacheStore);
      errCacheStore.clear = () => {
        throw new Error('clear boom');
      };

      await setupErrServer();

      const { status, body } = await fetchJson(
        errPort,
        '/api/clients/err-client/cache/entries',
        { method: 'DELETE' },
      );
      expect(status).toBe(500);
      expect(body.error).toBe('clear boom');

      errCacheStore.clear = origClear;
    });

    it('dedup stats error returns 500', async () => {
      errCacheStore = new InMemoryCacheStore();
      errDedupeStore = new InMemoryDedupeStore();
      errRateLimitStore = new InMemoryRateLimitStore();

      const origGetStats = errDedupeStore.getStats.bind(errDedupeStore);
      errDedupeStore.getStats = () => {
        throw new Error('dedup stats boom');
      };

      await setupErrServer();

      const { status, body } = await fetchJson(
        errPort,
        '/api/clients/err-client/dedup/stats',
      );
      expect(status).toBe(500);
      expect(body.error).toBe('dedup stats boom');

      errDedupeStore.getStats = origGetStats;
    });

    it('dedup jobs list error returns 500', async () => {
      errCacheStore = new InMemoryCacheStore();
      errDedupeStore = new InMemoryDedupeStore();
      errRateLimitStore = new InMemoryRateLimitStore();

      const origListJobs = errDedupeStore.listJobs.bind(errDedupeStore);
      errDedupeStore.listJobs = () => {
        throw new Error('dedup jobs boom');
      };

      await setupErrServer();

      const { status, body } = await fetchJson(
        errPort,
        '/api/clients/err-client/dedup/jobs',
      );
      expect(status).toBe(500);
      expect(body.error).toBe('dedup jobs boom');

      errDedupeStore.listJobs = origListJobs;
    });

    it('dedup single job error returns 500', async () => {
      errCacheStore = new InMemoryCacheStore();
      errDedupeStore = new InMemoryDedupeStore();
      errRateLimitStore = new InMemoryRateLimitStore();

      const origListJobs = errDedupeStore.listJobs.bind(errDedupeStore);
      errDedupeStore.listJobs = () => {
        throw new Error('dedup job boom');
      };

      await setupErrServer();

      const { status, body } = await fetchJson(
        errPort,
        '/api/clients/err-client/dedup/jobs/somehash',
      );
      expect(status).toBe(500);
      expect(body.error).toBe('dedup job boom');

      errDedupeStore.listJobs = origListJobs;
    });

    it('rate-limit stats error returns 500', async () => {
      errCacheStore = new InMemoryCacheStore();
      errDedupeStore = new InMemoryDedupeStore();
      errRateLimitStore = new InMemoryRateLimitStore();

      const origGetStats = errRateLimitStore.getStats.bind(errRateLimitStore);
      errRateLimitStore.getStats = () => {
        throw new Error('rl stats boom');
      };

      await setupErrServer();

      const { status, body } = await fetchJson(
        errPort,
        '/api/clients/err-client/rate-limit/stats',
      );
      expect(status).toBe(500);
      expect(body.error).toBe('rl stats boom');

      errRateLimitStore.getStats = origGetStats;
    });

    it('rate-limit resources list error returns 500', async () => {
      errCacheStore = new InMemoryCacheStore();
      errDedupeStore = new InMemoryDedupeStore();
      errRateLimitStore = new InMemoryRateLimitStore();

      const origListResources =
        errRateLimitStore.listResources.bind(errRateLimitStore);
      errRateLimitStore.listResources = () => {
        throw new Error('rl resources boom');
      };

      await setupErrServer();

      const { status, body } = await fetchJson(
        errPort,
        '/api/clients/err-client/rate-limit/resources',
      );
      expect(status).toBe(500);
      expect(body.error).toBe('rl resources boom');

      errRateLimitStore.listResources = origListResources;
    });

    it('rate-limit single resource error returns 500', async () => {
      errCacheStore = new InMemoryCacheStore();
      errDedupeStore = new InMemoryDedupeStore();
      errRateLimitStore = new InMemoryRateLimitStore();

      const origGetStatus = errRateLimitStore.getStatus.bind(errRateLimitStore);
      errRateLimitStore.getStatus = () => {
        throw new Error('rl resource boom');
      };

      await setupErrServer();

      const { status, body } = await fetchJson(
        errPort,
        '/api/clients/err-client/rate-limit/resources/some-resource',
      );
      expect(status).toBe(500);
      expect(body.error).toBe('rl resource boom');

      errRateLimitStore.getStatus = origGetStatus;
    });

    it('rate-limit update config error returns 500', async () => {
      errCacheStore = new InMemoryCacheStore();
      errDedupeStore = new InMemoryDedupeStore();
      errRateLimitStore = new InMemoryRateLimitStore();

      const origSetConfig =
        errRateLimitStore.setResourceConfig.bind(errRateLimitStore);
      errRateLimitStore.setResourceConfig = () => {
        throw new Error('rl config boom');
      };

      await setupErrServer();

      const { status, body } = await fetchJson(
        errPort,
        '/api/clients/err-client/rate-limit/resources/some-resource/config',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 100, windowMs: 60000 }),
        },
      );
      expect(status).toBe(500);
      expect(body.error).toBe('rl config boom');

      errRateLimitStore.setResourceConfig = origSetConfig;
    });

    it('rate-limit reset error returns 500', async () => {
      errCacheStore = new InMemoryCacheStore();
      errDedupeStore = new InMemoryDedupeStore();
      errRateLimitStore = new InMemoryRateLimitStore();

      const origReset = errRateLimitStore.reset.bind(errRateLimitStore);
      errRateLimitStore.reset = () => {
        throw new Error('rl reset boom');
      };

      await setupErrServer();

      const { status, body } = await fetchJson(
        errPort,
        '/api/clients/err-client/rate-limit/resources/some-resource/reset',
        { method: 'POST' },
      );
      expect(status).toBe(500);
      expect(body.error).toBe('rl reset boom');

      errRateLimitStore.reset = origReset;
    });

    it('handler error with non-Error throw returns Unknown error', async () => {
      errCacheStore = new InMemoryCacheStore();
      errDedupeStore = new InMemoryDedupeStore();
      errRateLimitStore = new InMemoryRateLimitStore();

      errCacheStore.getStats = () => {
        throw 'string error';
      };

      await setupErrServer();

      const { status, body } = await fetchJson(
        errPort,
        '/api/clients/err-client/cache/stats',
      );
      expect(status).toBe(500);
      expect(body.error).toBe('Unknown error');
    });
  });

  describe('readonly mode', () => {
    let roServer: Server;
    let roPort: number;
    let roCacheStore: InMemoryCacheStore;
    let roRateLimitStore: InMemoryRateLimitStore;

    beforeEach(async () => {
      roCacheStore = new InMemoryCacheStore();
      roRateLimitStore = new InMemoryRateLimitStore();

      const middleware = createDashboard({
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

      const result = await startServer(middleware);
      roServer = result.server;
      roPort = result.port;
    });

    afterEach(async () => {
      await closeServer(roServer);
      roCacheStore.destroy();
      roRateLimitStore.destroy();
    });

    it('should allow GET requests in readonly mode', async () => {
      const { status } = await fetchJson(roPort, '/api/health');
      expect(status).toBe(200);
    });

    it('should block DELETE requests in readonly mode', async () => {
      const { status, body } = await fetchJson(
        roPort,
        '/api/clients/test-client/cache/entries',
        { method: 'DELETE' },
      );
      expect(status).toBe(403);
      expect(body.error).toBe('Dashboard is in readonly mode');
    });

    it('should block PUT requests in readonly mode', async () => {
      const { status, body } = await fetchJson(
        roPort,
        '/api/clients/test-client/rate-limit/resources/api/config',
        {
          method: 'PUT',
          body: JSON.stringify({ limit: 100, windowMs: 60000 }),
          headers: { 'Content-Type': 'application/json' },
        },
      );
      expect(status).toBe(403);
      expect(body.error).toBe('Dashboard is in readonly mode');
    });
  });
});
