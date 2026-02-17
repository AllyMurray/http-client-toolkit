import type { ServerResponse } from 'http';
import type { DashboardContext } from './health.js';
import { sendJson } from '../response-helpers.js';

export function handleStores(res: ServerResponse, ctx: DashboardContext): void {
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

  sendJson(res, { stores });
}
