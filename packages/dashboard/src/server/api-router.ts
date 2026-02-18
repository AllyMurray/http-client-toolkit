import type { IncomingMessage, ServerResponse } from 'http';
import {
  handleCacheStats,
  handleCacheEntries,
  handleCacheEntry,
  handleDeleteCacheEntry,
  handleClearCache,
} from './handlers/cache.js';
import {
  handleDedupeStats,
  handleDedupeJobs,
  handleDedupeJob,
} from './handlers/dedup.js';
import {
  type ClientContext,
  type MultiClientContext,
  handleHealth,
} from './handlers/health.js';
import {
  handleRateLimitStats,
  handleRateLimitResources,
  handleRateLimitResource,
  handleUpdateRateLimitConfig,
  handleResetRateLimitResource,
} from './handlers/rate-limit.js';
import { handleClients } from './handlers/stores.js';
import {
  sendNotFound,
  sendMethodNotAllowed,
  sendError,
} from './response-helpers.js';

const CLIENT_ROUTE_REGEX = /^\/api\/clients\/([a-zA-Z0-9_-]+)(\/.*)?$/;

export function createApiRouter(ctx: MultiClientContext) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    query: URLSearchParams,
  ): Promise<boolean> => {
    /* v8 ignore next -- req.method is always present in Node.js HTTP */
    const method = req.method?.toUpperCase() ?? 'GET';

    // Health (aggregate)
    if (pathname === '/api/health' && method === 'GET') {
      handleHealth(res, ctx);
      return true;
    }

    // List clients
    if (pathname === '/api/clients' && method === 'GET') {
      handleClients(res, ctx);
      return true;
    }

    // Per-client routes: /api/clients/:name/...
    const clientMatch = pathname.match(CLIENT_ROUTE_REGEX);
    if (clientMatch) {
      const clientName = clientMatch[1]!;
      /* v8 ignore next -- capture group is always present for matched client routes */
      const subPath = clientMatch[2] ?? '';
      const client = ctx.clients.get(clientName);

      if (!client) {
        sendError(res, `Unknown client: ${clientName}`, 404);
        return true;
      }

      return routeClientApi(req, res, client, subPath, method, query);
    }

    // No API route matched
    if (pathname.startsWith('/api/')) {
      sendNotFound(res);
      return true;
    }

    return false;
  };
}

async function routeClientApi(
  req: IncomingMessage,
  res: ServerResponse,
  client: ClientContext,
  subPath: string,
  method: string,
  query: URLSearchParams,
): Promise<boolean> {
  // Cache routes
  if (subPath.startsWith('/cache')) {
    if (!client.cache) {
      sendError(res, 'Cache store not configured', 404);
      return true;
    }

    if (subPath === '/cache/stats' && method === 'GET') {
      await handleCacheStats(res, client.cache);
      return true;
    }

    if (subPath === '/cache/entries' && method === 'GET') {
      await handleCacheEntries(req, res, client.cache, query);
      return true;
    }

    if (subPath === '/cache/entries' && method === 'DELETE') {
      await handleClearCache(res, client.cache);
      return true;
    }

    const isSingleEntry =
      subPath.startsWith('/cache/entries/') && subPath.split('/').length === 4;

    if (isSingleEntry && method === 'GET') {
      await handleCacheEntry(res, client.cache, subPath);
      return true;
    }

    if (isSingleEntry && method === 'DELETE') {
      await handleDeleteCacheEntry(res, client.cache, subPath);
      return true;
    }

    if (isSingleEntry) {
      sendMethodNotAllowed(res);
      return true;
    }
  }

  // Dedup routes
  if (subPath.startsWith('/dedup')) {
    if (!client.dedup) {
      sendError(res, 'Dedup store not configured', 404);
      return true;
    }

    if (subPath === '/dedup/stats' && method === 'GET') {
      await handleDedupeStats(res, client.dedup);
      return true;
    }

    if (subPath === '/dedup/jobs' && method === 'GET') {
      await handleDedupeJobs(req, res, client.dedup, query);
      return true;
    }

    const isSingleJob =
      subPath.startsWith('/dedup/jobs/') && subPath.split('/').length === 4;

    if (isSingleJob && method === 'GET') {
      await handleDedupeJob(res, client.dedup, subPath);
      return true;
    }

    if (isSingleJob) {
      sendMethodNotAllowed(res);
      return true;
    }
  }

  // Rate limit routes
  if (subPath.startsWith('/rate-limit')) {
    if (!client.rateLimit) {
      sendError(res, 'Rate limit store not configured', 404);
      return true;
    }

    if (subPath === '/rate-limit/stats' && method === 'GET') {
      await handleRateLimitStats(res, client.rateLimit);
      return true;
    }

    if (subPath === '/rate-limit/resources' && method === 'GET') {
      await handleRateLimitResources(res, client.rateLimit);
      return true;
    }

    if (subPath.endsWith('/config') && method === 'PUT') {
      await handleUpdateRateLimitConfig(req, res, client.rateLimit, subPath);
      return true;
    }

    if (subPath.endsWith('/reset') && method === 'POST') {
      await handleResetRateLimitResource(res, client.rateLimit, subPath);
      return true;
    }

    const isSingleResource =
      subPath.startsWith('/rate-limit/resources/') &&
      subPath.split('/').length === 4;

    if (isSingleResource && method === 'GET') {
      await handleRateLimitResource(res, client.rateLimit, subPath);
      return true;
    }

    if (isSingleResource) {
      sendMethodNotAllowed(res);
      return true;
    }
  }

  sendNotFound(res);
  return true;
}
