import { readFileSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import {
  detectCacheAdapter,
  detectDedupeAdapter,
  detectRateLimitAdapter,
} from '../adapters/detect.js';
import { validateDashboardOptions, type DashboardOptions } from '../config.js';
import type { DashboardContext } from './handlers/health.js';
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

async function routeApi(
  request: Request,
  pathname: string,
  query: URLSearchParams,
  ctx: DashboardContext,
): Promise<Response | null> {
  const method = request.method.toUpperCase();

  // Health
  if (pathname === '/api/health' && method === 'GET') {
    return jsonResponse({
      status: 'ok',
      stores: {
        cache: ctx.cache
          ? { type: ctx.cache.type, capabilities: ctx.cache.capabilities }
          : null,
        dedup: ctx.dedup
          ? { type: ctx.dedup.type, capabilities: ctx.dedup.capabilities }
          : null,
        rateLimit: ctx.rateLimit
          ? {
              type: ctx.rateLimit.type,
              capabilities: ctx.rateLimit.capabilities,
            }
          : null,
      },
      pollIntervalMs: ctx.pollIntervalMs,
    });
  }

  // Stores
  if (pathname === '/api/stores' && method === 'GET') {
    const stores: Array<{
      name: string;
      type: string;
      capabilities: Record<string, boolean>;
    }> = [];
    if (ctx.cache) {
      stores.push({
        name: 'cache',
        type: ctx.cache.type,
        capabilities: ctx.cache.capabilities,
      });
    }
    if (ctx.dedup) {
      stores.push({
        name: 'dedup',
        type: ctx.dedup.type,
        capabilities: ctx.dedup.capabilities,
      });
    }
    if (ctx.rateLimit) {
      stores.push({
        name: 'rateLimit',
        type: ctx.rateLimit.type,
        capabilities: ctx.rateLimit.capabilities,
      });
    }
    return jsonResponse({ stores });
  }

  // Cache routes
  if (pathname.startsWith('/api/cache')) {
    if (!ctx.cache) return errorResponse('Cache store not configured', 404);
    return routeCache(pathname, method, ctx.cache, query);
  }

  // Dedup routes
  if (pathname.startsWith('/api/dedup')) {
    if (!ctx.dedup) return errorResponse('Dedup store not configured', 404);
    return routeDedup(pathname, method, ctx.dedup, query);
  }

  // Rate limit routes
  if (pathname.startsWith('/api/rate-limit')) {
    if (!ctx.rateLimit)
      return errorResponse('Rate limit store not configured', 404);
    return routeRateLimit(request, pathname, method, ctx.rateLimit);
  }

  // Unknown API route
  if (pathname.startsWith('/api/')) {
    return errorResponse('Not found', 404);
  }

  return null;
}

async function routeCache(
  pathname: string,
  method: string,
  adapter: NonNullable<DashboardContext['cache']>,
  query: URLSearchParams,
): Promise<Response> {
  try {
    if (pathname === '/api/cache/stats' && method === 'GET') {
      const stats = await adapter.getStats();
      return jsonResponse({ stats, capabilities: adapter.capabilities });
    }

    if (pathname === '/api/cache/entries' && method === 'GET') {
      const page = parseInt(query.get('page') ?? '0', 10);
      const limit = parseInt(query.get('limit') ?? '50', 10);
      return jsonResponse(await adapter.listEntries(page, limit));
    }

    if (pathname === '/api/cache/entries' && method === 'DELETE') {
      await adapter.clearAll();
      return jsonResponse({ cleared: true });
    }

    const isSingleEntry =
      pathname.startsWith('/api/cache/entries/') &&
      pathname.split('/').length === 5;

    if (isSingleEntry && method === 'GET') {
      const hash = extractParam(pathname, '/api/cache/entries/:hash');
      if (!hash) return errorResponse('Not found', 404);
      const entry = await adapter.getEntry(hash);
      if (entry === undefined) return errorResponse('Not found', 404);
      return jsonResponse({ hash, value: entry });
    }

    if (isSingleEntry && method === 'DELETE') {
      const hash = extractParam(pathname, '/api/cache/entries/:hash');
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
  adapter: NonNullable<DashboardContext['dedup']>,
  query: URLSearchParams,
): Promise<Response> {
  try {
    if (pathname === '/api/dedup/stats' && method === 'GET') {
      const stats = await adapter.getStats();
      return jsonResponse({ stats, capabilities: adapter.capabilities });
    }

    if (pathname === '/api/dedup/jobs' && method === 'GET') {
      const page = parseInt(query.get('page') ?? '0', 10);
      const limit = parseInt(query.get('limit') ?? '50', 10);
      return jsonResponse(await adapter.listJobs(page, limit));
    }

    const isSingleJob =
      pathname.startsWith('/api/dedup/jobs/') &&
      pathname.split('/').length === 5;

    if (isSingleJob && method === 'GET') {
      const hash = extractParam(pathname, '/api/dedup/jobs/:hash');
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
  adapter: NonNullable<DashboardContext['rateLimit']>,
): Promise<Response> {
  try {
    if (pathname === '/api/rate-limit/stats' && method === 'GET') {
      const stats = await adapter.getStats();
      return jsonResponse({ stats, capabilities: adapter.capabilities });
    }

    if (pathname === '/api/rate-limit/resources' && method === 'GET') {
      const resources = await adapter.listResources();
      return jsonResponse({ resources });
    }

    // Config update: PUT /api/rate-limit/resources/:name/config
    if (pathname.endsWith('/config') && method === 'PUT') {
      const name = extractParam(
        pathname,
        '/api/rate-limit/resources/:name/config',
      );
      if (!name) return errorResponse('Not found', 404);
      const body = (await request.json()) as {
        limit: number;
        windowMs: number;
      };
      await adapter.updateResourceConfig(name, body);
      return jsonResponse({ updated: true });
    }

    // Reset: POST /api/rate-limit/resources/:name/reset
    if (pathname.endsWith('/reset') && method === 'POST') {
      const name = extractParam(
        pathname,
        '/api/rate-limit/resources/:name/reset',
      );
      if (!name) return errorResponse('Not found', 404);
      await adapter.resetResource(name);
      return jsonResponse({ reset: true });
    }

    // Single resource: GET /api/rate-limit/resources/:name
    const isSingleResource =
      pathname.startsWith('/api/rate-limit/resources/') &&
      pathname.split('/').length === 5;

    if (isSingleResource && method === 'GET') {
      const name = extractParam(pathname, '/api/rate-limit/resources/:name');
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

  const ctx: DashboardContext = {
    cache: opts.cacheStore ? detectCacheAdapter(opts.cacheStore) : undefined,
    dedup: opts.dedupeStore ? detectDedupeAdapter(opts.dedupeStore) : undefined,
    rateLimit: opts.rateLimitStore
      ? detectRateLimitAdapter(opts.rateLimitStore)
      : undefined,
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
