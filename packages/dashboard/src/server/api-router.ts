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
import { type DashboardContext, handleHealth } from './handlers/health.js';
import {
  handleRateLimitStats,
  handleRateLimitResources,
  handleRateLimitResource,
  handleUpdateRateLimitConfig,
  handleResetRateLimitResource,
} from './handlers/rate-limit.js';
import { handleStores } from './handlers/stores.js';
import {
  sendNotFound,
  sendMethodNotAllowed,
  sendError,
} from './response-helpers.js';

export function createApiRouter(ctx: DashboardContext) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    query: URLSearchParams,
  ): Promise<boolean> => {
    const method = req.method?.toUpperCase() ?? 'GET';

    // Health
    if (pathname === '/api/health' && method === 'GET') {
      handleHealth(res, ctx);
      return true;
    }

    // Stores
    if (pathname === '/api/stores' && method === 'GET') {
      handleStores(res, ctx);
      return true;
    }

    // Cache routes
    if (pathname.startsWith('/api/cache')) {
      if (!ctx.cache) {
        sendError(res, 'Cache store not configured', 404);
        return true;
      }

      if (pathname === '/api/cache/stats' && method === 'GET') {
        await handleCacheStats(res, ctx.cache);
        return true;
      }

      if (pathname === '/api/cache/entries' && method === 'GET') {
        await handleCacheEntries(req, res, ctx.cache, query);
        return true;
      }

      if (pathname === '/api/cache/entries' && method === 'DELETE') {
        await handleClearCache(res, ctx.cache);
        return true;
      }

      // Single entry: GET /api/cache/entries/:hash
      const isSingleEntry =
        pathname.startsWith('/api/cache/entries/') &&
        pathname.split('/').length === 5;

      if (isSingleEntry && method === 'GET') {
        await handleCacheEntry(res, ctx.cache, pathname);
        return true;
      }

      if (isSingleEntry && method === 'DELETE') {
        await handleDeleteCacheEntry(res, ctx.cache, pathname);
        return true;
      }

      if (isSingleEntry) {
        sendMethodNotAllowed(res);
        return true;
      }
    }

    // Dedup routes
    if (pathname.startsWith('/api/dedup')) {
      if (!ctx.dedup) {
        sendError(res, 'Dedup store not configured', 404);
        return true;
      }

      if (pathname === '/api/dedup/stats' && method === 'GET') {
        await handleDedupeStats(res, ctx.dedup);
        return true;
      }

      if (pathname === '/api/dedup/jobs' && method === 'GET') {
        await handleDedupeJobs(req, res, ctx.dedup, query);
        return true;
      }

      // Single job: GET /api/dedup/jobs/:hash
      const isSingleJob =
        pathname.startsWith('/api/dedup/jobs/') &&
        pathname.split('/').length === 5;

      if (isSingleJob && method === 'GET') {
        await handleDedupeJob(res, ctx.dedup, pathname);
        return true;
      }

      if (isSingleJob) {
        sendMethodNotAllowed(res);
        return true;
      }
    }

    // Rate limit routes
    if (pathname.startsWith('/api/rate-limit')) {
      if (!ctx.rateLimit) {
        sendError(res, 'Rate limit store not configured', 404);
        return true;
      }

      if (pathname === '/api/rate-limit/stats' && method === 'GET') {
        await handleRateLimitStats(res, ctx.rateLimit);
        return true;
      }

      if (pathname === '/api/rate-limit/resources' && method === 'GET') {
        await handleRateLimitResources(res, ctx.rateLimit);
        return true;
      }

      // Config update: PUT /api/rate-limit/resources/:name/config
      if (pathname.endsWith('/config') && method === 'PUT') {
        await handleUpdateRateLimitConfig(req, res, ctx.rateLimit, pathname);
        return true;
      }

      // Reset: POST /api/rate-limit/resources/:name/reset
      if (pathname.endsWith('/reset') && method === 'POST') {
        await handleResetRateLimitResource(res, ctx.rateLimit, pathname);
        return true;
      }

      // Single resource: GET /api/rate-limit/resources/:name
      const isSingleResource =
        pathname.startsWith('/api/rate-limit/resources/') &&
        pathname.split('/').length === 5;

      if (isSingleResource && method === 'GET') {
        await handleRateLimitResource(res, ctx.rateLimit, pathname);
        return true;
      }

      if (isSingleResource) {
        sendMethodNotAllowed(res);
        return true;
      }
    }

    // No API route matched
    if (pathname.startsWith('/api/')) {
      sendNotFound(res);
      return true;
    }

    return false;
  };
}
