import { readFileSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import {
  detectCacheAdapter,
  detectDedupeAdapter,
  detectRateLimitAdapter,
} from '../adapters/detect.js';
import { validateDashboardOptions, type DashboardOptions } from '../config.js';
import type { ClientContext, MultiClientContext } from './handlers/health.js';
import { extractParam } from './request-helpers.js';

export type DashboardFetchHandler = (request: Request) => Promise<Response>;

// --- Response helpers ---

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
} as const;

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function errorResponse(message: string, status: number = 500): Response {
  return jsonResponse({ error: message }, status);
}

// --- Static file serving ---

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

let cachedIndexHtml: string | undefined;
let clientDir: string | undefined;

function getCurrentDir(): string {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return typeof __dirname !== 'undefined' ? __dirname : process.cwd();
  }
}

function getClientDir(): string {
  if (clientDir) return clientDir;
  const currentDir = getCurrentDir();
  clientDir = join(currentDir, '..', 'dist', 'client');
  return clientDir;
}

function getIndexHtml(): string {
  if (cachedIndexHtml) return cachedIndexHtml;
  const indexPath = join(getClientDir(), 'index.html');
  if (existsSync(indexPath)) {
    cachedIndexHtml = readFileSync(indexPath, 'utf-8');
  } else {
    cachedIndexHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Dashboard</title></head>
<body>
<div id="root">
  <p style="font-family:sans-serif;text-align:center;margin-top:4rem">
    Dashboard client not built. Run <code>vite build</code> first.
  </p>
</div>
</body>
</html>`;
  }
  return cachedIndexHtml;
}

function serveStaticWeb(pathname: string): Response {
  const dir = getClientDir();

  if (pathname !== '/' && pathname !== '/index.html') {
    const filePath = join(dir, pathname);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath);
        const ext = extname(pathname);
        const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream';
        return new Response(content, {
          status: 200,
          headers: {
            'Content-Type': mimeType,
            'Content-Length': String(content.length),
            'Cache-Control': pathname.includes('/assets/')
              ? 'public, max-age=31536000, immutable'
              : 'no-cache',
          },
        });
      } catch {
        // Fall through to SPA fallback
      }
    }
  }

  const html = getIndexHtml();
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache',
    },
  });
}

// --- API routing ---

const CLIENT_ROUTE_REGEX = /^\/api\/clients\/([a-zA-Z0-9_-]+)(\/.*)?$/;

function clientStoreInfo(client: ClientContext) {
  return {
    cache: client.cache
      ? { type: client.cache.type, capabilities: client.cache.capabilities }
      : null,
    dedup: client.dedup
      ? { type: client.dedup.type, capabilities: client.dedup.capabilities }
      : null,
    rateLimit: client.rateLimit
      ? {
          type: client.rateLimit.type,
          capabilities: client.rateLimit.capabilities,
        }
      : null,
  };
}

async function routeApi(
  request: Request,
  pathname: string,
  query: URLSearchParams,
  ctx: MultiClientContext,
): Promise<Response | null> {
  const method = request.method.toUpperCase();

  // Health (aggregate)
  if (pathname === '/api/health' && method === 'GET') {
    const clients: Record<string, ReturnType<typeof clientStoreInfo>> = {};
    for (const [name, client] of ctx.clients) {
      clients[name] = clientStoreInfo(client);
    }
    return jsonResponse({
      status: 'ok',
      clients,
      pollIntervalMs: ctx.pollIntervalMs,
    });
  }

  // List clients
  if (pathname === '/api/clients' && method === 'GET') {
    const clientList: Array<{
      name: string;
      stores: ReturnType<typeof clientStoreInfo>;
    }> = [];
    for (const [name, client] of ctx.clients) {
      clientList.push({ name, stores: clientStoreInfo(client) });
    }
    return jsonResponse({ clients: clientList });
  }

  // Per-client routes: /api/clients/:name/...
  const clientMatch = pathname.match(CLIENT_ROUTE_REGEX);
  if (clientMatch) {
    const clientName = clientMatch[1]!;
    const subPath = clientMatch[2] ?? '';
    const client = ctx.clients.get(clientName);

    if (!client) {
      return errorResponse(`Unknown client: ${clientName}`, 404);
    }

    return routeClientApi(request, subPath, method, client, query);
  }

  // Unknown API route
  if (pathname.startsWith('/api/')) {
    return errorResponse('Not found', 404);
  }

  return null;
}

async function routeClientApi(
  request: Request,
  subPath: string,
  method: string,
  client: ClientContext,
  query: URLSearchParams,
): Promise<Response> {
  // Cache routes
  if (subPath.startsWith('/cache')) {
    if (!client.cache) return errorResponse('Cache store not configured', 404);
    return routeCache(subPath, method, client.cache, query);
  }

  // Dedup routes
  if (subPath.startsWith('/dedup')) {
    if (!client.dedup) return errorResponse('Dedup store not configured', 404);
    return routeDedup(subPath, method, client.dedup, query);
  }

  // Rate limit routes
  if (subPath.startsWith('/rate-limit')) {
    if (!client.rateLimit)
      return errorResponse('Rate limit store not configured', 404);
    return routeRateLimit(request, subPath, method, client.rateLimit);
  }

  return errorResponse('Not found', 404);
}

async function routeCache(
  pathname: string,
  method: string,
  adapter: NonNullable<ClientContext['cache']>,
  query: URLSearchParams,
): Promise<Response> {
  try {
    if (pathname === '/cache/stats' && method === 'GET') {
      const stats = await adapter.getStats();
      return jsonResponse({ stats, capabilities: adapter.capabilities });
    }

    if (pathname === '/cache/entries' && method === 'GET') {
      const page = parseInt(query.get('page') ?? '0', 10);
      const limit = parseInt(query.get('limit') ?? '50', 10);
      return jsonResponse(await adapter.listEntries(page, limit));
    }

    if (pathname === '/cache/entries' && method === 'DELETE') {
      await adapter.clearAll();
      return jsonResponse({ cleared: true });
    }

    const isSingleEntry =
      pathname.startsWith('/cache/entries/') &&
      pathname.split('/').length === 4;

    if (isSingleEntry && method === 'GET') {
      const hash = extractParam(pathname, '/cache/entries/:hash');
      if (!hash) return errorResponse('Not found', 404);
      const entry = await adapter.getEntry(hash);
      if (entry === undefined) return errorResponse('Not found', 404);
      return jsonResponse({ hash, value: entry });
    }

    if (isSingleEntry && method === 'DELETE') {
      const hash = extractParam(pathname, '/cache/entries/:hash');
      if (!hash) return errorResponse('Not found', 404);
      await adapter.deleteEntry(hash);
      return jsonResponse({ deleted: true });
    }

    if (isSingleEntry) {
      return errorResponse('Method not allowed', 405);
    }
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Unknown error');
  }

  return errorResponse('Not found', 404);
}

async function routeDedup(
  pathname: string,
  method: string,
  adapter: NonNullable<ClientContext['dedup']>,
  query: URLSearchParams,
): Promise<Response> {
  try {
    if (pathname === '/dedup/stats' && method === 'GET') {
      const stats = await adapter.getStats();
      return jsonResponse({ stats, capabilities: adapter.capabilities });
    }

    if (pathname === '/dedup/jobs' && method === 'GET') {
      const page = parseInt(query.get('page') ?? '0', 10);
      const limit = parseInt(query.get('limit') ?? '50', 10);
      return jsonResponse(await adapter.listJobs(page, limit));
    }

    const isSingleJob =
      pathname.startsWith('/dedup/jobs/') && pathname.split('/').length === 4;

    if (isSingleJob && method === 'GET') {
      const hash = extractParam(pathname, '/dedup/jobs/:hash');
      if (!hash) return errorResponse('Not found', 404);
      const job = await adapter.getJob(hash);
      if (!job) return errorResponse('Not found', 404);
      return jsonResponse(job);
    }

    if (isSingleJob) {
      return errorResponse('Method not allowed', 405);
    }
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Unknown error');
  }

  return errorResponse('Not found', 404);
}

async function routeRateLimit(
  request: Request,
  pathname: string,
  method: string,
  adapter: NonNullable<ClientContext['rateLimit']>,
): Promise<Response> {
  try {
    if (pathname === '/rate-limit/stats' && method === 'GET') {
      const stats = await adapter.getStats();
      return jsonResponse({ stats, capabilities: adapter.capabilities });
    }

    if (pathname === '/rate-limit/resources' && method === 'GET') {
      const resources = await adapter.listResources();
      return jsonResponse({ resources });
    }

    // Config update: PUT /rate-limit/resources/:name/config
    if (pathname.endsWith('/config') && method === 'PUT') {
      const name = extractParam(pathname, '/rate-limit/resources/:name/config');
      if (!name) return errorResponse('Not found', 404);
      const body = (await request.json()) as {
        limit: number;
        windowMs: number;
      };
      await adapter.updateResourceConfig(name, body);
      return jsonResponse({ updated: true });
    }

    // Reset: POST /rate-limit/resources/:name/reset
    if (pathname.endsWith('/reset') && method === 'POST') {
      const name = extractParam(pathname, '/rate-limit/resources/:name/reset');
      if (!name) return errorResponse('Not found', 404);
      await adapter.resetResource(name);
      return jsonResponse({ reset: true });
    }

    // Single resource: GET /rate-limit/resources/:name
    const isSingleResource =
      pathname.startsWith('/rate-limit/resources/') &&
      pathname.split('/').length === 4;

    if (isSingleResource && method === 'GET') {
      const name = extractParam(pathname, '/rate-limit/resources/:name');
      if (!name) return errorResponse('Not found', 404);
      const status = await adapter.getResourceStatus(name);
      return jsonResponse({ resource: name, ...status });
    }

    if (isSingleResource) {
      return errorResponse('Method not allowed', 405);
    }
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Unknown error');
  }

  return errorResponse('Not found', 404);
}

// --- Main export ---

export function createDashboardHandler(
  options: DashboardOptions,
): DashboardFetchHandler {
  const opts = validateDashboardOptions(options);

  const clients = new Map<string, ClientContext>();
  for (const clientConfig of opts.clients) {
    clients.set(clientConfig.name, {
      name: clientConfig.name,
      cache: clientConfig.cacheStore
        ? detectCacheAdapter(clientConfig.cacheStore)
        : undefined,
      dedup: clientConfig.dedupeStore
        ? detectDedupeAdapter(clientConfig.dedupeStore)
        : undefined,
      rateLimit: clientConfig.rateLimitStore
        ? detectRateLimitAdapter(clientConfig.rateLimitStore)
        : undefined,
    });
  }

  const ctx: MultiClientContext = {
    clients,
    pollIntervalMs: opts.pollIntervalMs,
  };

  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      let pathname = url.pathname;
      if (opts.basePath !== '/' && pathname.startsWith(opts.basePath)) {
        pathname = pathname.slice(opts.basePath.length) || '/';
      }

      const apiResponse = await routeApi(
        request,
        pathname,
        url.searchParams,
        ctx,
      );
      if (apiResponse) return apiResponse;

      return serveStaticWeb(pathname);
    } catch {
      return errorResponse('Internal server error', 500);
    }
  };
}
