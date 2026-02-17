import type { IncomingMessage, ServerResponse } from 'http';
import type { DedupeStoreAdapter } from '../../adapters/types.js';
import { extractParam } from '../request-helpers.js';
import { sendJson, sendError, sendNotFound } from '../response-helpers.js';

export async function handleDedupeStats(
  res: ServerResponse,
  adapter: DedupeStoreAdapter,
): Promise<void> {
  try {
    const stats = await adapter.getStats();
    sendJson(res, { stats, capabilities: adapter.capabilities });
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Unknown error');
  }
}

export async function handleDedupeJobs(
  _req: IncomingMessage,
  res: ServerResponse,
  adapter: DedupeStoreAdapter,
  query: URLSearchParams,
): Promise<void> {
  try {
    const page = parseInt(query.get('page') ?? '0', 10);
    const limit = parseInt(query.get('limit') ?? '50', 10);
    const result = await adapter.listJobs(page, limit);
    sendJson(res, result);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Unknown error');
  }
}

export async function handleDedupeJob(
  res: ServerResponse,
  adapter: DedupeStoreAdapter,
  pathname: string,
): Promise<void> {
  try {
    const hash = extractParam(pathname, '/api/dedup/jobs/:hash');
    if (!hash) {
      sendNotFound(res);
      return;
    }
    const job = await adapter.getJob(hash);
    if (!job) {
      sendNotFound(res);
      return;
    }
    sendJson(res, job);
  } catch (err) {
    sendError(res, err instanceof Error ? err.message : 'Unknown error');
  }
}
