import type { IncomingMessage, ServerResponse } from 'http';
import type { RateLimitStoreAdapter } from '../../adapters/types.js';
import { extractParam, readJsonBody } from '../request-helpers.js';
import { sendJson, sendError, sendNotFound } from '../response-helpers.js';

export async function handleRateLimitStats(
  res: ServerResponse,
  adapter: RateLimitStoreAdapter,
): Promise<void> {
  try {
    const stats = await adapter.getStats();
    sendJson(res, { stats, capabilities: adapter.capabilities });
  } catch (err) {
    /* v8 ignore next -- non-Error throws are defensive */
    sendError(res, err instanceof Error ? err.message : 'Unknown error');
  }
}

export async function handleRateLimitResources(
  res: ServerResponse,
  adapter: RateLimitStoreAdapter,
): Promise<void> {
  try {
    const resources = await adapter.listResources();
    sendJson(res, { resources });
  } catch (err) {
    /* v8 ignore next -- non-Error throws are defensive */
    sendError(res, err instanceof Error ? err.message : 'Unknown error');
  }
}

export async function handleRateLimitResource(
  res: ServerResponse,
  adapter: RateLimitStoreAdapter,
  pathname: string,
): Promise<void> {
  try {
    const name = extractParam(pathname, '/rate-limit/resources/:name');
    /* v8 ignore next 4 -- unreachable: router validates path structure before calling handler */
    if (!name) {
      sendNotFound(res);
      return;
    }
    const status = await adapter.getResourceStatus(name);
    sendJson(res, { resource: name, ...status });
  } catch (err) {
    /* v8 ignore next -- non-Error throws are defensive */
    sendError(res, err instanceof Error ? err.message : 'Unknown error');
  }
}

export async function handleUpdateRateLimitConfig(
  req: IncomingMessage,
  res: ServerResponse,
  adapter: RateLimitStoreAdapter,
  pathname: string,
): Promise<void> {
  try {
    const name = extractParam(pathname, '/rate-limit/resources/:name/config');
    /* v8 ignore next 4 -- unreachable: router validates path structure before calling handler */
    if (!name) {
      sendNotFound(res);
      return;
    }
    const body = await readJsonBody<{ limit: number; windowMs: number }>(req);
    await adapter.updateResourceConfig(name, body);
    sendJson(res, { updated: true });
  } catch (err) {
    /* v8 ignore next -- non-Error throws are defensive */
    sendError(res, err instanceof Error ? err.message : 'Unknown error');
  }
}

export async function handleResetRateLimitResource(
  res: ServerResponse,
  adapter: RateLimitStoreAdapter,
  pathname: string,
): Promise<void> {
  try {
    const name = extractParam(pathname, '/rate-limit/resources/:name/reset');
    /* v8 ignore next 4 -- unreachable: router validates path structure before calling handler */
    if (!name) {
      sendNotFound(res);
      return;
    }
    await adapter.resetResource(name);
    sendJson(res, { reset: true });
  } catch (err) {
    /* v8 ignore next -- non-Error throws are defensive */
    sendError(res, err instanceof Error ? err.message : 'Unknown error');
  }
}
