import { InMemoryCacheStore } from '@http-client-toolkit/store-memory';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMemoryCacheAdapter } from './memory.js';

describe('createMemoryCacheAdapter', () => {
  let store: InMemoryCacheStore;

  beforeEach(() => {
    store = new InMemoryCacheStore();
  });

  afterEach(() => {
    store.destroy();
  });

  it('should return memory type', () => {
    const adapter = createMemoryCacheAdapter(store);
    expect(adapter.type).toBe('memory');
  });

  it('should get stats', async () => {
    await store.set('key1', 'value1', 60);
    const adapter = createMemoryCacheAdapter(store);
    const stats = await adapter.getStats();
    expect(stats).toHaveProperty('totalItems', 1);
  });

  it('should list entries', async () => {
    await store.set('key1', 'value1', 60);
    await store.set('key2', 'value2', 60);
    const adapter = createMemoryCacheAdapter(store);
    const result = await adapter.listEntries(0, 10);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]!.hash).toBe('key1');
  });

  it('should paginate entries', async () => {
    for (let i = 0; i < 5; i++) {
      await store.set(`key${i}`, `value${i}`, 60);
    }
    const adapter = createMemoryCacheAdapter(store);
    const page1 = await adapter.listEntries(0, 2);
    expect(page1.entries).toHaveLength(2);

    const page2 = await adapter.listEntries(1, 2);
    expect(page2.entries).toHaveLength(2);
  });

  it('should get an entry by hash', async () => {
    await store.set('key1', 'value1', 60);
    const adapter = createMemoryCacheAdapter(store);
    const entry = await adapter.getEntry('key1');
    expect(entry).toBe('value1');
  });

  it('should delete an entry', async () => {
    await store.set('key1', 'value1', 60);
    const adapter = createMemoryCacheAdapter(store);
    await adapter.deleteEntry('key1');
    const entry = await adapter.getEntry('key1');
    expect(entry).toBeUndefined();
  });

  it('should clear all entries', async () => {
    await store.set('key1', 'value1', 60);
    await store.set('key2', 'value2', 60);
    const adapter = createMemoryCacheAdapter(store);
    await adapter.clearAll();
    const result = await adapter.listEntries(0, 10);
    expect(result.entries).toHaveLength(0);
  });
});
