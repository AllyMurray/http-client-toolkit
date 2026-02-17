import type { ServerResponse } from 'http';
import type { MultiClientContext } from './health.js';
import { sendJson } from '../response-helpers.js';

export function handleClients(
  res: ServerResponse,
  ctx: MultiClientContext,
): void {
  const clients: Array<{
    name: string;
    stores: {
      cache: { type: string; capabilities: Record<string, boolean> } | null;
      dedup: { type: string; capabilities: Record<string, boolean> } | null;
      rateLimit: { type: string; capabilities: Record<string, boolean> } | null;
    };
  }> = [];

  for (const [name, client] of ctx.clients) {
    clients.push({
      name,
      stores: {
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
      },
    });
  }

  sendJson(res, { clients });
}
