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
import {
  createDashboardHandler,
  type DashboardFetchHandler,
} from './web-handler.js';

/**
 * Adapts a Web Standards fetch handler to a Node http handler.
 * This simulates what frameworks like Hono, Elysia, or custom Bun/Deno
 * adapters do when bridging to Node's http module.
 */
function toNodeHandler(
  handler: DashboardFetchHandler,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
    const headers = new Headers();
    for (const [key, val] of Object.entries(req.headers)) {
      if (val) headers.set(key, Array.isArray(val) ? val.join(', ') : val);
    }

    // Collect body for non-GET/HEAD methods
    const chunks: Array<Buffer> = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body =
        req.method === 'GET' || req.method === 'HEAD'
          ? undefined
          : Buffer.concat(chunks);

      const request = new Request(url, {
        method: req.method,
        headers,
        body,
      });

      handler(request)
        .then(async (response) => {
          const respHeaders: Record<string, string> = {};
          response.headers.forEach((v, k) => {
            respHeaders[k] = v;
          });
          res.writeHead(response.status, respHeaders);
          const arrayBuf = await response.arrayBuffer();
          res.end(Buffer.from(arrayBuf));
        })
        .catch(() => {
          res.writeHead(500);
          res.end();
        });
    });
  };
}

function startServer(
  handler: DashboardFetchHandler,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(toNodeHandler(handler));
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

describe('createDashboardHandler integration', () => {
  let cacheStore: InMemoryCacheStore;
  let dedupeStore: InMemoryDedupeStore;
  let rateLimitStore: InMemoryRateLimitStore;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    cacheStore = new InMemoryCacheStore();
    dedupeStore = new InMemoryDedupeStore();
    rateLimitStore = new InMemoryRateLimitStore();

    const handler = createDashboardHandler({
      clients: [
        {
          name: 'test-client',
          cacheStore,
          dedupeStore,
          rateLimitStore,
        },
      ],
    });

    const result = await startServer(handler);
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

  describe('basePath support', () => {
    let basePathServer: Server;
    let basePathPort: number;

    afterEach(async () => {
      if (basePathServer) await closeServer(basePathServer);
    });

    it('should strip basePath and route correctly over HTTP', async () => {
      const handler = createDashboardHandler({
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

      const result = await startServer(handler);
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

    it('should route to independent clients over HTTP', async () => {
      cacheStoreA = new InMemoryCacheStore();
      cacheStoreB = new InMemoryCacheStore();

      await cacheStoreA.set('key-a', 'value-a', 60);
      await cacheStoreB.set('key-b', 'value-b', 60);

      const handler = createDashboardHandler({
        clients: [
          { name: 'client-a', cacheStore: cacheStoreA },
          { name: 'client-b', cacheStore: cacheStoreB },
        ],
      });

      const result = await startServer(handler);
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
    });
  });
});
