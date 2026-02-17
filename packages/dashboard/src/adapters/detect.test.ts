import {
  InMemoryCacheStore,
  InMemoryDedupeStore,
  InMemoryRateLimitStore,
} from '@http-client-toolkit/store-memory';
import {
  SQLiteCacheStore,
  SQLiteDedupeStore,
  SQLiteRateLimitStore,
} from '@http-client-toolkit/store-sqlite';
import { describe, it, expect, afterEach } from 'vitest';
import {
  detectCacheAdapter,
  detectDedupeAdapter,
  detectRateLimitAdapter,
} from './detect.js';

describe('detectCacheAdapter', () => {
  let store: { destroy(): void } | undefined;

  afterEach(() => {
    if (store) {
      store.destroy();
      store = undefined;
    }
  });

  it('should detect memory cache store', () => {
    store = new InMemoryCacheStore();
    const adapter = detectCacheAdapter(store);
    expect(adapter.type).toBe('memory');
    expect(adapter.capabilities.canList).toBe(true);
    expect(adapter.capabilities.canGetStats).toBe(true);
  });

  it('should detect sqlite cache store', () => {
    store = new SQLiteCacheStore();
    const adapter = detectCacheAdapter(store);
    expect(adapter.type).toBe('sqlite');
    expect(adapter.capabilities.canList).toBe(true);
    expect(adapter.capabilities.canGetStats).toBe(true);
  });

  it('should fallback to generic for unknown stores', () => {
    const unknownStore = {
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
      clear: async () => {},
    };
    const adapter = detectCacheAdapter(unknownStore);
    expect(adapter.type).toBe('generic');
    expect(adapter.capabilities.canList).toBe(false);
  });
});

describe('detectDedupeAdapter', () => {
  let store: { destroy(): void } | undefined;

  afterEach(() => {
    if (store) {
      store.destroy();
      store = undefined;
    }
  });

  it('should detect memory dedupe store', () => {
    store = new InMemoryDedupeStore();
    const adapter = detectDedupeAdapter(store);
    expect(adapter.type).toBe('memory');
    expect(adapter.capabilities.canList).toBe(true);
  });

  it('should detect sqlite dedupe store', () => {
    store = new SQLiteDedupeStore();
    const adapter = detectDedupeAdapter(store);
    expect(adapter.type).toBe('sqlite');
    expect(adapter.capabilities.canList).toBe(true);
  });

  it('should fallback to generic for unknown stores', () => {
    const unknownStore = {
      register: async () => 'id',
      registerOrJoin: async () => ({ jobId: 'id', isOwner: true }),
      waitFor: async () => undefined,
      complete: async () => {},
      fail: async () => {},
      isInProgress: async () => false,
    };
    const adapter = detectDedupeAdapter(unknownStore);
    expect(adapter.type).toBe('generic');
  });
});

describe('detectRateLimitAdapter', () => {
  let store: { destroy(): void } | undefined;

  afterEach(() => {
    if (store) {
      store.destroy();
      store = undefined;
    }
  });

  it('should detect memory rate limit store', () => {
    store = new InMemoryRateLimitStore();
    const adapter = detectRateLimitAdapter(store);
    expect(adapter.type).toBe('memory');
    expect(adapter.capabilities.canList).toBe(true);
    expect(adapter.capabilities.canUpdateConfig).toBe(true);
  });

  it('should detect sqlite rate limit store', () => {
    store = new SQLiteRateLimitStore();
    const adapter = detectRateLimitAdapter(store);
    expect(adapter.type).toBe('sqlite');
    expect(adapter.capabilities.canList).toBe(true);
  });

  it('should fallback to generic for unknown stores', () => {
    const unknownStore = {
      canProceed: async () => true,
      record: async () => {},
      getStatus: async () => ({
        remaining: 10,
        resetTime: new Date(),
        limit: 100,
      }),
      reset: async () => {},
      getWaitTime: async () => 0,
    };
    const adapter = detectRateLimitAdapter(unknownStore);
    expect(adapter.type).toBe('generic');
  });
});
