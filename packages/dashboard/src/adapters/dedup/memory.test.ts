import { InMemoryDedupeStore } from '@http-client-toolkit/store-memory';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMemoryDedupeAdapter } from './memory.js';

describe('createMemoryDedupeAdapter', () => {
  let store: InMemoryDedupeStore;
  let unhandledRejectionHandler: ((error: Error) => void) | undefined;

  beforeEach(() => {
    store = new InMemoryDedupeStore();
    unhandledRejectionHandler = () => {};
    process.on('unhandledRejection', unhandledRejectionHandler);
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    store.destroy();
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (unhandledRejectionHandler) {
      process.off('unhandledRejection', unhandledRejectionHandler);
      unhandledRejectionHandler = undefined;
    }
  });

  it('should return memory type', () => {
    const adapter = createMemoryDedupeAdapter(store);
    expect(adapter.type).toBe('memory');
  });

  it('should get stats', async () => {
    await store.register('hash1');
    await store.complete('hash1', 'value');
    const adapter = createMemoryDedupeAdapter(store);
    const stats = await adapter.getStats();
    expect(stats).toHaveProperty('totalJobsProcessed', 1);
  });

  it('should list jobs', async () => {
    await store.register('hash1');
    await store.register('hash2');
    await store.complete('hash1', 'value1');

    const adapter = createMemoryDedupeAdapter(store);
    const result = await adapter.listJobs(0, 10);
    expect(result.jobs).toHaveLength(2);
  });

  it('should get a specific job', async () => {
    await store.register('hash1');
    const adapter = createMemoryDedupeAdapter(store);
    const job = await adapter.getJob('hash1');
    expect(job).toBeDefined();
    expect(job!.hash).toBe('hash1');
    expect(job!.status).toBe('pending');
  });

  it('should return undefined for non-existent job', async () => {
    const adapter = createMemoryDedupeAdapter(store);
    const job = await adapter.getJob('nonexistent');
    expect(job).toBeUndefined();
  });
});
