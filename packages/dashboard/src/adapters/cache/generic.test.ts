import type { CacheStore } from '@http-client-toolkit/core';
import { describe, it, expect } from 'vitest';
import { createGenericCacheAdapter } from './generic.js';

function createMockStore(): CacheStore {
  const data = new Map<string, unknown>();
  return {
    get: async (hash: string) => data.get(hash),
    set: async (hash: string, value: unknown) => {
      data.set(hash, value);
    },
    delete: async (hash: string) => {
      data.delete(hash);
    },
    clear: async () => {
      data.clear();
    },
  };
}

describe('createGenericCacheAdapter', () => {
  it('should return generic type', () => {
    const adapter = createGenericCacheAdapter(createMockStore());
    expect(adapter.type).toBe('generic');
  });

  it('should report limited capabilities', () => {
    const adapter = createGenericCacheAdapter(createMockStore());
    expect(adapter.capabilities.canList).toBe(false);
    expect(adapter.capabilities.canGetStats).toBe(false);
    expect(adapter.capabilities.canDelete).toBe(true);
    expect(adapter.capabilities.canClear).toBe(true);
  });

  it('should return empty entries list', async () => {
    const adapter = createGenericCacheAdapter(createMockStore());
    const result = await adapter.listEntries(0, 10);
    expect(result.entries).toEqual([]);
  });

  it('should get, delete, and clear via core interface', async () => {
    const store = createMockStore();
    await store.set('key1', 'value1', 60);

    const adapter = createGenericCacheAdapter(store);
    expect(await adapter.getEntry('key1')).toBe('value1');

    await adapter.deleteEntry('key1');
    expect(await adapter.getEntry('key1')).toBeUndefined();

    await store.set('key2', 'value2', 60);
    await adapter.clearAll();
    expect(await adapter.getEntry('key2')).toBeUndefined();
  });
});
