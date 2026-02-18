import type { IncomingMessage, ServerResponse } from 'http';
import {
  detectCacheAdapter,
  detectDedupeAdapter,
  detectRateLimitAdapter,
} from '../adapters/detect.js';
import {
  normalizeClient,
  validateDashboardOptions,
  type DashboardOptions,
} from '../config.js';
import { createApiRouter } from './api-router.js';
import type { ClientContext, MultiClientContext } from './handlers/health.js';
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

  const clients = new Map<string, ClientContext>();
  for (const clientConfig of opts.clients) {
    const normalized = normalizeClient(clientConfig);
    clients.set(normalized.name, {
      name: normalized.name,
      cache: normalized.cacheStore
        ? detectCacheAdapter(normalized.cacheStore)
        : undefined,
      dedup: normalized.dedupeStore
        ? detectDedupeAdapter(normalized.dedupeStore)
        : undefined,
      rateLimit: normalized.rateLimitStore
        ? detectRateLimitAdapter(normalized.rateLimitStore)
        : undefined,
    });
  }

  const ctx: MultiClientContext = {
    clients,
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
      /* v8 ignore start -- defensive: apiRouter catches all expected errors internally */
      .catch(() => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      });
    /* v8 ignore stop */
  };
}
