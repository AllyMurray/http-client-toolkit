import type { IncomingMessage, ServerResponse } from 'http';
import type { CacheStoreAdapter } from '../../adapters/types.js';
import { extractParam } from '../request-helpers.js';
import { sendJson, sendError, sendNotFound } from '../response-helpers.js';

export async function handleCacheStats(
  res: ServerResponse,
  adapter: CacheStoreAdapter,
): Promise<void> {
  try {
    const stats = await adapter.getStats();
    sendJson(res, { stats, capabilities: adapter.capabilities });
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Unknown error');
  }
}

export async function handleCacheEntries(
  _req: IncomingMessage,
  res: ServerResponse,
  adapter: CacheStoreAdapter,
  query: URLSearchParams,
): Promise<void> {
  try {
    const page = parseInt(query.get('page') ?? '0', 10);
    const limit = parseInt(query.get('limit') ?? '50', 10);
    const result = await adapter.listEntries(page, limit);
    sendJson(res, result);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Unknown error');
  }
}

export async function handleCacheEntry(
  res: ServerResponse,
  adapter: CacheStoreAdapter,
  pathname: string,
): Promise<void> {
  try {
    const hash = extractParam(pathname, '/cache/entries/:hash');
    if (!hash) {
      sendNotFound(res);
      return;
    }
    const entry = await adapter.getEntry(hash);
    if (entry === undefined) {
      sendNotFound(res);
      return;
    }
    sendJson(res, { hash, value: entry });
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Unknown error');
  }
}

export async function handleDeleteCacheEntry(
  res: ServerResponse,
  adapter: CacheStoreAdapter,
  pathname: string,
): Promise<void> {
  try {
    const hash = extractParam(pathname, '/cache/entries/:hash');
    if (!hash) {
      sendNotFound(res);
      return;
    }
    await adapter.deleteEntry(hash);
    sendJson(res, { deleted: true });
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Unknown error');
  }
}

export async function handleClearCache(
  res: ServerResponse,
  adapter: CacheStoreAdapter,
): Promise<void> {
  try {
    await adapter.clearAll();
    sendJson(res, { cleared: true });
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Unknown error');
  }
}
