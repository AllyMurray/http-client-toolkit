import type { IncomingMessage, ServerResponse } from 'http';
import {
  detectCacheAdapter,
  detectDedupeAdapter,
  detectRateLimitAdapter,
} from '../adapters/detect.js';
import { validateDashboardOptions, type DashboardOptions } from '../config.js';
import { createApiRouter } from './api-router.js';
import type { DashboardContext } from './handlers/health.js';
import { parseUrl } from './request-helpers.js';
import { serveStatic } from './static-server.js';

export type DashboardMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next?: () => void,
) => void;

export function createDashboard(
  options: DashboardOptions,
): DashboardMiddleware {
  const opts = validateDashboardOptions(options);

  const ctx: DashboardContext = {
    cache: opts.cacheStore ? detectCacheAdapter(opts.cacheStore) : undefined,
    dedup: opts.dedupeStore ? detectDedupeAdapter(opts.dedupeStore) : undefined,
    rateLimit: opts.rateLimitStore
      ? detectRateLimitAdapter(opts.rateLimitStore)
      : undefined,
    pollIntervalMs: opts.pollIntervalMs,
  };

  const apiRouter = createApiRouter(ctx);

  return (req: IncomingMessage, res: ServerResponse, _next?: () => void) => {
    const { pathname, query } = parseUrl(req, opts.basePath);

    // Handle API routes
    apiRouter(req, res, pathname, query)
      .then((handled) => {
        if (!handled) {
          // Serve static files / SPA
          serveStatic(res, pathname);
        }
      })
      .catch(() => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      });
  };
}
