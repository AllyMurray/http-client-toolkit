import { InMemoryRateLimitStore } from '@http-client-toolkit/store-memory';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMemoryRateLimitAdapter } from './memory.js';

describe('createMemoryRateLimitAdapter', () => {
  let store: InMemoryRateLimitStore;

  beforeEach(() => {
    store = new InMemoryRateLimitStore({
      defaultConfig: { limit: 10, windowMs: 60000 },
    });
  });

  afterEach(() => {
    store.destroy();
  });

  it('should return memory type', () => {
    const adapter = createMemoryRateLimitAdapter(store);
    expect(adapter.type).toBe('memory');
  });

  it('should get stats', async () => {
    await store.record('resource-a');
    const adapter = createMemoryRateLimitAdapter(store);
    const stats = await adapter.getStats();
    expect(stats).toHaveProperty('totalRequests');
  });

  it('should list resources', async () => {
    await store.record('resource-a');
    await store.record('resource-b');
    const adapter = createMemoryRateLimitAdapter(store);
    const resources = await adapter.listResources();
    expect(resources).toHaveLength(2);
  });

  it('should get resource status', async () => {
    await store.record('resource-a');
    const adapter = createMemoryRateLimitAdapter(store);
    const status = await adapter.getResourceStatus('resource-a');
    expect(status.limit).toBe(10);
    expect(status.remaining).toBe(9);
  });

  it('should update resource config', async () => {
    const adapter = createMemoryRateLimitAdapter(store);
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
    const adapter = createMemoryRateLimitAdapter(store);
    await adapter.resetResource('resource-a');

    const status = await adapter.getResourceStatus('resource-a');
    expect(status.remaining).toBe(10);
  });
});
