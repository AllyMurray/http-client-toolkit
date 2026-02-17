import type { ServerResponse } from 'http';
import type {
  CacheStoreAdapter,
  DedupeStoreAdapter,
  RateLimitStoreAdapter,
} from '../../adapters/types.js';
import { sendJson } from '../response-helpers.js';

export interface ClientContext {
  name: string;
  cache?: CacheStoreAdapter;
  dedup?: DedupeStoreAdapter;
  rateLimit?: RateLimitStoreAdapter;
}

export interface MultiClientContext {
  clients: Map<string, ClientContext>;
  pollIntervalMs: number;
}

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

export function handleHealth(
  res: ServerResponse,
  ctx: MultiClientContext,
): void {
  const clients: Record<string, ReturnType<typeof clientStoreInfo>> = {};
  for (const [name, client] of ctx.clients) {
    clients[name] = clientStoreInfo(client);
  }

  sendJson(res, {
    status: 'ok',
    clients,
    pollIntervalMs: ctx.pollIntervalMs,
  });
}
