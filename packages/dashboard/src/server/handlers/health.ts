import type { ServerResponse } from 'http';
import type {
  CacheStoreAdapter,
  DedupeStoreAdapter,
  RateLimitStoreAdapter,
} from '../../adapters/types.js';
import { sendJson } from '../response-helpers.js';

export interface DashboardContext {
  cache?: CacheStoreAdapter;
  dedup?: DedupeStoreAdapter;
  rateLimit?: RateLimitStoreAdapter;
  pollIntervalMs: number;
}

export function handleHealth(res: ServerResponse, ctx: DashboardContext): void {
  sendJson(res, {
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
