import { SQLiteRateLimitStore } from '@http-client-toolkit/store-sqlite';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSqliteRateLimitAdapter } from './sqlite.js';

describe('createSqliteRateLimitAdapter', () => {
  let store: SQLiteRateLimitStore;

  beforeEach(() => {
    store = new SQLiteRateLimitStore({
      defaultConfig: { limit: 10, windowMs: 60000 },
    });
  });

  afterEach(() => {
    store.destroy();
  });

  it('should return sqlite type', () => {
    const adapter = createSqliteRateLimitAdapter(store);
    expect(adapter.type).toBe('sqlite');
  });

  it('should get stats', async () => {
    await store.record('resource-a');
    const adapter = createSqliteRateLimitAdapter(store);
    const stats = await adapter.getStats();
    expect(stats).toHaveProperty('totalRequests');
  });

  it('should list resources', async () => {
    await store.record('resource-a');
    await store.record('resource-b');
    const adapter = createSqliteRateLimitAdapter(store);
    const resources = await adapter.listResources();
    expect(resources).toHaveLength(2);
  });

  it('should get resource status', async () => {
    await store.record('resource-a');
    const adapter = createSqliteRateLimitAdapter(store);
    const status = await adapter.getResourceStatus('resource-a');
    expect(status.limit).toBe(10);
    expect(status.remaining).toBe(9);
  });

  it('should update resource config', async () => {
    const adapter = createSqliteRateLimitAdapter(store);
    await adapter.updateResourceConfig('resource-a', {
      limit: 5,
      windowMs: 30000,
    });

    const config = store.getResourceConfig('resource-a');
    expect(config.limit).toBe(5);
    expect(config.windowMs).toBe(30000);
  });

  it('should reset a resource', async () => {
    await store.record('resource-a');
    await store.record('resource-a');
    const adapter = createSqliteRateLimitAdapter(store);
    await adapter.resetResource('resource-a');

    const status = await adapter.getResourceStatus('resource-a');
    expect(status.remaining).toBe(10);
  });
});
