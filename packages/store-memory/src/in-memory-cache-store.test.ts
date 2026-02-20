import { describe, it, expect, beforeEach, afterEach, vi as _vi } from 'vitest';
import { InMemoryCacheStore } from './in-memory-cache-store.js';

describe('InMemoryCacheStore', () => {
  let store: InMemoryCacheStore;

  beforeEach(() => {
    store = new InMemoryCacheStore();
  });

  afterEach(() => {
    if (store) {
      store.destroy();
    }
  });

  describe('basic operations', () => {
    it('should set and get values', async () => {
      await store.set('key1', 'value1', 60);
      const value = await store.get('key1');
      expect(value).toBe('value1');
    });

    it('should return undefined for non-existent keys', async () => {
      const value = await store.get('non-existent');
      expect(value).toBeUndefined();
    });

    it('should overwrite existing values', async () => {
      await store.set('key1', 'value1', 60);
      await store.set('key1', 'value2', 60);
      const value = await store.get('key1');
      expect(value).toBe('value2');
    });

    it('should delete values', async () => {
      await store.set('key1', 'value1', 60);
      await store.delete('key1');
      const value = await store.get('key1');
      expect(value).toBeUndefined();
    });

    it('should handle deletion of non-existent keys', async () => {
      await expect(store.delete('non-existent')).resolves.not.toThrow();
    });

    it('should clear all values', async () => {
      await store.set('key1', 'value1', 60);
      await store.set('key2', 'value2', 60);
      await store.clear();

      const value1 = await store.get('key1');
      const value2 = await store.get('key2');

      expect(value1).toBeUndefined();
      expect(value2).toBeUndefined();
    });
  });

  describe('TTL functionality', () => {
    it('should expire values after TTL', async () => {
      await store.set('key1', 'value1', 0.05); // 50ms TTL

      // Should be available immediately
      let value = await store.get('key1');
      expect(value).toBe('value1');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 100));

      value = await store.get('key1');
      expect(value).toBeUndefined();
    });

    it('should not expire values before TTL', async () => {
      await store.set('key1', 'value1', 10); // 10 seconds TTL

      // Should be available after a short delay
      await new Promise((resolve) => setTimeout(resolve, 10));

      const value = await store.get('key1');
      expect(value).toBe('value1');
    });

    it('should handle zero TTL (permanent)', async () => {
      await store.set('key1', 'value1', 0);

      // Should be available (permanent storage)
      const value = await store.get('key1');
      expect(value).toBe('value1');
    });

    it('should handle negative TTL', async () => {
      await store.set('key1', 'value1', -1);

      // Should be expired immediately
      const value = await store.get('key1');
      expect(value).toBeUndefined();
    });
  });

  describe('data types', () => {
    it('should handle string values', async () => {
      await store.set('key1', 'string value', 60);
      const value = await store.get('key1');
      expect(value).toBe('string value');
    });

    it('should handle number values', async () => {
      await store.set('key1', 42, 60);
      const value = await store.get('key1');
      expect(value).toBe(42);
    });

    it('should handle boolean values', async () => {
      await store.set('key1', true, 60);
      const value = await store.get('key1');
      expect(value).toBe(true);
    });

    it('should handle object values', async () => {
      const obj = { id: 1, name: 'test', nested: { value: 'nested' } };
      await store.set('key1', obj, 60);
      const value = await store.get('key1');
      expect(value).toEqual(obj);
    });

    it('should handle array values', async () => {
      const arr = [1, 2, 3, { id: 4 }];
      await store.set('key1', arr, 60);
      const value = await store.get('key1');
      expect(value).toEqual(arr);
    });

    it('should handle null values', async () => {
      await store.set('key1', null, 60);
      const value = await store.get('key1');
      expect(value).toBeNull();
    });

    it('should handle undefined values', async () => {
      await store.set('key1', undefined, 60);
      const value = await store.get('key1');
      expect(value).toBeUndefined();
    });
  });

  describe('statistics', () => {
    it('should provide accurate statistics', async () => {
      await store.set('key1', 'value1', 60);
      await store.set('key2', 'value2', 60);

      const stats = store.getStats();
      expect(stats.totalItems).toBe(2);
      expect(stats.memoryUsageBytes).toBeGreaterThan(0);
      expect(stats.maxItems).toBe(1000); // default
      expect(stats.maxMemoryBytes).toBe(50 * 1024 * 1024); // 50MB default
      expect(stats.memoryUtilization).toBeGreaterThan(0);
      expect(stats.itemUtilization).toBeGreaterThan(0);
    });

    it('should update statistics after operations', async () => {
      let stats = store.getStats();
      expect(stats.totalItems).toBe(0);

      await store.set('key1', 'value1', 60);
      stats = store.getStats();
      expect(stats.totalItems).toBe(1);

      await store.delete('key1');
      stats = store.getStats();
      expect(stats.totalItems).toBe(0);
    });

    it('should update memory usage when an expired item is lazily removed by get', async () => {
      const lazyExpiryStore = new InMemoryCacheStore({ cleanupIntervalMs: 0 });

      try {
        await lazyExpiryStore.set('expiring', 'x'.repeat(256), 0.001);
        expect(lazyExpiryStore.getStats().memoryUsageBytes).toBeGreaterThan(0);

        await new Promise((resolve) => setTimeout(resolve, 20));

        const value = await lazyExpiryStore.get('expiring');
        expect(value).toBeUndefined();

        const stats = lazyExpiryStore.getStats();
        expect(stats.totalItems).toBe(0);
        expect(stats.memoryUsageBytes).toBe(0);
      } finally {
        lazyExpiryStore.destroy();
      }
    });

    it('counts expired entries in stats before cleanup runs', async () => {
      const statsStore = new InMemoryCacheStore({ cleanupIntervalMs: 0 });

      try {
        await statsStore.set('expiring', 'value', 0.001);
        await new Promise((resolve) => setTimeout(resolve, 20));

        const stats = statsStore.getStats();
        expect(stats.expired).toBeGreaterThan(0);
      } finally {
        statsStore.destroy();
      }
    });
  });

  describe('cleanup', () => {
    it('should automatically clean up expired items', async () => {
      // Create store with very short cleanup interval
      const cleanupStore = new InMemoryCacheStore({ cleanupIntervalMs: 10 });

      await cleanupStore.set('key1', 'value1', 0.001); // 1ms TTL

      // Wait for cleanup to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stats = cleanupStore.getStats();
      expect(stats.totalItems).toBe(0);

      cleanupStore.destroy();
    });

    it('should not clean up unexpired items', async () => {
      // Create store with very short cleanup interval
      const cleanupStore = new InMemoryCacheStore({ cleanupIntervalMs: 10 });

      await cleanupStore.set('key1', 'value1', 10); // 10 seconds TTL

      // Wait for cleanup to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stats = cleanupStore.getStats();
      expect(stats.totalItems).toBe(1);

      cleanupStore.destroy();
    });
  });

  describe('memory management', () => {
    describe('maximum item count', () => {
      it('should evict oldest items when max items exceeded', async () => {
        const memoryStore = new InMemoryCacheStore({ maxItems: 3 });

        // Add items up to the limit
        await memoryStore.set('key1', 'value1', 60);
        await memoryStore.set('key2', 'value2', 60);
        await memoryStore.set('key3', 'value3', 60);

        expect(memoryStore.getStats().totalItems).toBe(3);

        // Add one more item, should evict the oldest
        await memoryStore.set('key4', 'value4', 60);

        expect(memoryStore.getStats().totalItems).toBe(3);
        expect(await memoryStore.get('key1')).toBeUndefined(); // oldest should be evicted
        expect(await memoryStore.get('key2')).toBe('value2');
        expect(await memoryStore.get('key3')).toBe('value3');
        expect(await memoryStore.get('key4')).toBe('value4');

        memoryStore.destroy();
      });

      it('should respect LRU order for eviction', async () => {
        const memoryStore = new InMemoryCacheStore({ maxItems: 3 });

        // Add items with small delays to ensure different lastAccessed times
        await memoryStore.set('key1', 'value1', 60);
        await new Promise((resolve) => setTimeout(resolve, 10));
        await memoryStore.set('key2', 'value2', 60);
        await new Promise((resolve) => setTimeout(resolve, 10));
        await memoryStore.set('key3', 'value3', 60);

        // Access key1 to make it more recently used
        await new Promise((resolve) => setTimeout(resolve, 10));
        await memoryStore.get('key1');

        // Add another item, key2 should be evicted (oldest after key1 access)
        await new Promise((resolve) => setTimeout(resolve, 10));
        await memoryStore.set('key4', 'value4', 60);

        expect(await memoryStore.get('key1')).toBe('value1'); // recently accessed
        expect(await memoryStore.get('key2')).toBeUndefined(); // should be evicted
        expect(await memoryStore.get('key3')).toBe('value3');
        expect(await memoryStore.get('key4')).toBe('value4');

        memoryStore.destroy();
      });
    });

    describe('memory limit', () => {
      it('should evict items when memory limit exceeded', async () => {
        const memoryStore = new InMemoryCacheStore({
          maxMemoryBytes: 1024, // 1KB limit
          evictionRatio: 0.5, // Remove 50% when limit exceeded
        });

        // Add large items that will exceed the limit
        const largeValue = 'x'.repeat(500); // 500 bytes each
        await memoryStore.set('key1', largeValue, 60);
        await memoryStore.set('key2', largeValue, 60);
        await memoryStore.set('key3', largeValue, 60); // This should trigger eviction

        const stats = memoryStore.getStats();
        expect(stats.totalItems).toBeLessThan(3); // Some items should be evicted

        memoryStore.destroy();
      });

      it('should calculate memory utilization correctly', async () => {
        const memoryStore = new InMemoryCacheStore({ maxMemoryBytes: 1024 });

        await memoryStore.set('key1', 'small', 60);

        const stats = memoryStore.getStats();
        expect(stats.memoryUtilization).toBeGreaterThan(0);
        expect(stats.memoryUtilization).toBeLessThan(1);

        memoryStore.destroy();
      });
    });

    describe('LRU tracking', () => {
      it('should track last accessed time correctly', async () => {
        const memoryStore = new InMemoryCacheStore();

        await memoryStore.set('key1', 'value1', 60);
        await new Promise((resolve) => setTimeout(resolve, 10));
        await memoryStore.set('key2', 'value2', 60);

        // Access key1 to update its lastAccessed time
        await new Promise((resolve) => setTimeout(resolve, 10));
        await memoryStore.get('key1');

        const lruItems = memoryStore.getLRUItems();
        expect(lruItems).toHaveLength(2);
        expect(lruItems[0].hash).toBe('key2'); // Should be oldest now
        expect(lruItems[1].hash).toBe('key1'); // Should be newest

        memoryStore.destroy();
      });

      it('should provide LRU items with correct metadata', async () => {
        const memoryStore = new InMemoryCacheStore();

        await memoryStore.set('key1', 'value1', 60);

        const lruItems = memoryStore.getLRUItems(5);
        expect(lruItems).toHaveLength(1);
        expect(lruItems[0].hash).toBe('key1');
        expect(lruItems[0].lastAccessed).toBeInstanceOf(Date);
        expect(lruItems[0].size).toBeGreaterThan(0);

        memoryStore.destroy();
      });
    });
  });

  describe('configuration', () => {
    it('should use custom cleanup interval', async () => {
      const cleanupStore = new InMemoryCacheStore({ cleanupIntervalMs: 5000 });

      // Should have created the store without throwing
      expect(cleanupStore).toBeDefined();

      cleanupStore.destroy();
    });

    it('should handle cleanup interval of 0 (disabled)', async () => {
      const cleanupStore = new InMemoryCacheStore({ cleanupIntervalMs: 0 });

      // Should work without automatic cleanup
      await cleanupStore.set('key1', 'value1', 60);
      const value = await cleanupStore.get('key1');
      expect(value).toBe('value1');

      cleanupStore.destroy();
    });

    it('should use custom memory limits', async () => {
      const memoryStore = new InMemoryCacheStore({
        maxItems: 5,
        maxMemoryBytes: 2048,
        evictionRatio: 0.2,
      });

      const stats = memoryStore.getStats();
      expect(stats.maxItems).toBe(5);
      expect(stats.maxMemoryBytes).toBe(2048);

      memoryStore.destroy();
    });

    it('should handle all configuration options', async () => {
      const memoryStore = new InMemoryCacheStore({
        cleanupIntervalMs: 30000,
        maxItems: 100,
        maxMemoryBytes: 1024 * 1024, // 1MB
        evictionRatio: 0.25,
      });

      expect(memoryStore).toBeDefined();

      const stats = memoryStore.getStats();
      expect(stats.maxItems).toBe(100);
      expect(stats.maxMemoryBytes).toBe(1024 * 1024);

      memoryStore.destroy();
    });
  });

  describe('edge cases', () => {
    it('should handle very large values', async () => {
      const largeValue = 'x'.repeat(1000000); // 1MB string
      await store.set('large', largeValue, 60);
      const value = await store.get('large');
      expect(value).toBe(largeValue);
    });

    it('should handle many concurrent operations', async () => {
      const promises: Array<Promise<void>> = [];

      // Set 100 values concurrently
      for (let i = 0; i < 100; i++) {
        promises.push(store.set(`key${i}`, `value${i}`, 60));
      }

      await Promise.all(promises);

      // Get all values
      const getPromises: Array<Promise<unknown>> = [];
      for (let i = 0; i < 100; i++) {
        getPromises.push(store.get(`key${i}`));
      }

      const values = await Promise.all(getPromises);

      // Check all values are correct
      for (let i = 0; i < 100; i++) {
        expect(values[i]).toBe(`value${i}`);
      }
    });

    it('should handle special characters in keys', async () => {
      const specialKey = 'key-with-特殊字符-and-émojis-🚀';
      await store.set(specialKey, 'special value', 60);
      const value = await store.get(specialKey);
      expect(value).toBe('special value');
    });

    it('should handle memory calculation errors gracefully', async () => {
      // Create an object that can't be JSON serialized
      const circularObj: { name: string; self?: unknown } = { name: 'test' };
      circularObj.self = circularObj;

      await store.set('circular', circularObj, 60);

      // Should not throw error and should use default estimate
      const stats = store.getStats();
      expect(stats.memoryUsageBytes).toBeGreaterThan(0);
    });

    it('uses fallback size estimate when stringify throws', async () => {
      const stringifySpy = _vi
        .spyOn(JSON, 'stringify')
        .mockImplementation(() => {
          throw new Error('boom');
        });

      try {
        await store.set('throwing', { value: 'x' }, 60);
        const stats = store.getStats();

        expect(stats.memoryUsageBytes).toBeGreaterThanOrEqual(1024);
      } finally {
        stringifySpy.mockRestore();
      }
    });

    it('should handle eviction when cache is empty', async () => {
      const memoryStore = new InMemoryCacheStore({ maxItems: 1 });

      // This should not throw even though cache is empty
      await memoryStore.set('key1', 'value1', 60);

      expect(await memoryStore.get('key1')).toBe('value1');

      memoryStore.destroy();
    });
  });

  describe('listEntries', () => {
    it('should return an empty array when cache is empty', () => {
      const entries = store.listEntries();
      expect(entries).toEqual([]);
    });

    it('should list all non-expired entries', async () => {
      await store.set('key1', 'value1', 60);
      await store.set('key2', 'value2', 60);

      const entries = store.listEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0]!.hash).toBe('key1');
      expect(entries[1]!.hash).toBe('key2');
      expect(entries[0]!.expiresAt).toBeGreaterThan(0);
      expect(entries[0]!.lastAccessed).toBeGreaterThan(0);
      expect(entries[0]!.size).toBeGreaterThan(0);
    });

    it('should exclude expired entries', async () => {
      const noCleanupStore = new InMemoryCacheStore({ cleanupIntervalMs: 0 });
      try {
        await noCleanupStore.set('expired', 'value', 0.001);
        await noCleanupStore.set('valid', 'value', 60);

        await new Promise((resolve) => setTimeout(resolve, 20));

        const entries = noCleanupStore.listEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0]!.hash).toBe('valid');
      } finally {
        noCleanupStore.destroy();
      }
    });

    it('should support pagination with offset and limit', async () => {
      for (let i = 0; i < 5; i++) {
        await store.set(`key${i}`, `value${i}`, 60);
      }

      const page1 = store.listEntries(0, 2);
      expect(page1).toHaveLength(2);
      expect(page1[0]!.hash).toBe('key0');
      expect(page1[1]!.hash).toBe('key1');

      const page2 = store.listEntries(2, 2);
      expect(page2).toHaveLength(2);
      expect(page2[0]!.hash).toBe('key2');
      expect(page2[1]!.hash).toBe('key3');

      const page3 = store.listEntries(4, 2);
      expect(page3).toHaveLength(1);
      expect(page3[0]!.hash).toBe('key4');
    });

    it('should include permanent entries (ttl=0)', async () => {
      await store.set('permanent', 'value', 0);

      const entries = store.listEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.hash).toBe('permanent');
      expect(entries[0]!.expiresAt).toBe(0);
    });
  });

  describe('scoped clear', () => {
    it('should remove only entries with matching key prefix', async () => {
      await store.set('user:1:profile', 'alice', 60);
      await store.set('user:1:settings', 'dark-mode', 60);
      await store.set('user:2:profile', 'bob', 60);
      await store.set('org:1:name', 'acme', 60);

      await store.clear('user:1:');

      expect(await store.get('user:1:profile')).toBeUndefined();
      expect(await store.get('user:1:settings')).toBeUndefined();
      expect(await store.get('user:2:profile')).toBe('bob');
      expect(await store.get('org:1:name')).toBe('acme');

      // Memory accounting should reflect the removal
      const stats = store.getStats();
      expect(stats.totalItems).toBe(2);
    });

    it('should be a no-op when no entries match the scope', async () => {
      await store.set('key1', 'value1', 60);
      await store.set('key2', 'value2', 60);

      const statsBefore = store.getStats();
      await store.clear('nonexistent:');
      const statsAfter = store.getStats();

      expect(statsAfter.totalItems).toBe(statsBefore.totalItems);
      expect(statsAfter.memoryUsageBytes).toBe(statsBefore.memoryUsageBytes);
      expect(await store.get('key1')).toBe('value1');
      expect(await store.get('key2')).toBe('value2');
    });

    it('should clear everything when called without scope (backward compat)', async () => {
      await store.set('a:1', 'v1', 60);
      await store.set('b:2', 'v2', 60);
      await store.set('c:3', 'v3', 60);

      await store.clear();

      expect(await store.get('a:1')).toBeUndefined();
      expect(await store.get('b:2')).toBeUndefined();
      expect(await store.get('c:3')).toBeUndefined();

      const stats = store.getStats();
      expect(stats.totalItems).toBe(0);
      expect(stats.memoryUsageBytes).toBe(0);
    });
  });

  describe('destroy', () => {
    it('should clear all data when destroyed', async () => {
      await store.set('key1', 'value1', 60);
      await store.set('key2', 'value2', 60);

      store.destroy();

      const value1 = await store.get('key1');
      const value2 = await store.get('key2');

      expect(value1).toBeUndefined();
      expect(value2).toBeUndefined();
    });

    it('should be safe to call destroy multiple times', () => {
      expect(() => {
        store.destroy();
        store.destroy();
      }).not.toThrow();
    });
  });

  describe('tag-based invalidation', () => {
    it('setWithTags stores a value that can be retrieved with get', async () => {
      await store.setWithTags('key1', 'value1', 60, ['tag-a']);
      const value = await store.get('key1');
      expect(value).toBe('value1');
    });

    it('invalidateByTag deletes all entries with that tag', async () => {
      await store.setWithTags('user1', 'alice', 60, ['users']);
      await store.setWithTags('user2', 'bob', 60, ['users']);
      await store.setWithTags('other1', 'misc', 60, ['other']);

      const count = await store.invalidateByTag('users');
      expect(count).toBe(2);

      expect(await store.get('user1')).toBeUndefined();
      expect(await store.get('user2')).toBeUndefined();
      expect(await store.get('other1')).toBe('misc');
    });

    it('invalidateByTags deletes entries across multiple tags', async () => {
      await store.setWithTags('entry-a', 'a', 60, ['tag-x']);
      await store.setWithTags('entry-b', 'b', 60, ['tag-y']);
      await store.setWithTags('entry-c', 'c', 60, ['tag-z']);

      const count = await store.invalidateByTags(['tag-x', 'tag-y']);
      expect(count).toBe(2);

      expect(await store.get('entry-a')).toBeUndefined();
      expect(await store.get('entry-b')).toBeUndefined();
      expect(await store.get('entry-c')).toBe('c');
    });

    it('invalidateByTag returns 0 for unknown tag', async () => {
      const count = await store.invalidateByTag('nonexistent');
      expect(count).toBe(0);
    });

    it('invalidateByTags returns 0 for empty array', async () => {
      const count = await store.invalidateByTags([]);
      expect(count).toBe(0);
    });

    it('re-tagging replaces old associations', async () => {
      await store.setWithTags('key1', 'value1', 60, ['a']);
      await store.setWithTags('key1', 'value1-updated', 60, ['b']);

      const countA = await store.invalidateByTag('a');
      expect(countA).toBe(0);

      const countB = await store.invalidateByTag('b');
      expect(countB).toBe(1);
      expect(await store.get('key1')).toBeUndefined();
    });

    it('delete removes tag associations', async () => {
      await store.setWithTags('key1', 'value1', 60, ['tag-a']);
      await store.delete('key1');

      const count = await store.invalidateByTag('tag-a');
      expect(count).toBe(0);
    });

    it('clear removes all tag associations', async () => {
      await store.setWithTags('key1', 'value1', 60, ['tag-a']);
      await store.setWithTags('key2', 'value2', 60, ['tag-b']);
      await store.clear();

      const countA = await store.invalidateByTag('tag-a');
      const countB = await store.invalidateByTag('tag-b');
      expect(countA).toBe(0);
      expect(countB).toBe(0);
    });

    it('scoped clear removes tag associations for matching entries', async () => {
      await store.setWithTags('user:1:profile', 'alice', 60, ['users']);
      await store.setWithTags('org:1:name', 'acme', 60, ['orgs']);

      await store.clear('user:1:');

      const countUsers = await store.invalidateByTag('users');
      expect(countUsers).toBe(0);

      const countOrgs = await store.invalidateByTag('orgs');
      expect(countOrgs).toBe(1);
      expect(await store.get('org:1:name')).toBeUndefined();
    });

    it('LRU eviction cleans up tag associations', async () => {
      const lruStore = new InMemoryCacheStore({ maxItems: 2 });

      try {
        await lruStore.setWithTags('key1', 'value1', 60, ['tag-a']);
        await new Promise((resolve) => setTimeout(resolve, 10));
        await lruStore.setWithTags('key2', 'value2', 60, ['tag-b']);
        await new Promise((resolve) => setTimeout(resolve, 10));
        // Adding a third item should evict the oldest (key1)
        await lruStore.setWithTags('key3', 'value3', 60, ['tag-c']);

        expect(await lruStore.get('key1')).toBeUndefined();

        const count = await lruStore.invalidateByTag('tag-a');
        expect(count).toBe(0);
      } finally {
        lruStore.destroy();
      }
    });

    it('cleanup of expired items cleans up tag associations', async () => {
      const cleanupStore = new InMemoryCacheStore({ cleanupIntervalMs: 10 });

      try {
        await cleanupStore.setWithTags('expiring', 'value', 0.001, ['tag-a']);

        // Wait for cleanup to run
        await new Promise((resolve) => setTimeout(resolve, 50));

        const count = await cleanupStore.invalidateByTag('tag-a');
        expect(count).toBe(0);
      } finally {
        cleanupStore.destroy();
      }
    });

    it('entry with multiple tags is deleted by any of them', async () => {
      await store.setWithTags('key1', 'value1', 60, ['a', 'b']);

      const countA = await store.invalidateByTag('a');
      expect(countA).toBe(1);
      expect(await store.get('key1')).toBeUndefined();

      // Tag 'b' should no longer reference the deleted entry
      const countB = await store.invalidateByTag('b');
      expect(countB).toBe(0);
    });

    it('invalidateByTags deduplicates hashes across tags', async () => {
      await store.setWithTags('key1', 'value1', 60, ['a', 'b']);

      const count = await store.invalidateByTags(['a', 'b']);
      expect(count).toBe(1);
      expect(await store.get('key1')).toBeUndefined();
    });

    it('destroy clears tag maps', async () => {
      await store.setWithTags('key1', 'value1', 60, ['tag-a']);

      store.destroy();

      const value = await store.get('key1');
      expect(value).toBeUndefined();
    });

    it('memory accounting is correct after tag invalidation', async () => {
      await store.setWithTags('key1', 'x'.repeat(256), 60, ['tag-a']);
      await store.setWithTags('key2', 'y'.repeat(256), 60, ['tag-a']);
      await store.setWithTags('key3', 'z'.repeat(256), 60, ['tag-b']);

      const statsBefore = store.getStats();
      expect(statsBefore.totalItems).toBe(3);
      expect(statsBefore.memoryUsageBytes).toBeGreaterThan(0);

      await store.invalidateByTag('tag-a');

      const statsAfter = store.getStats();
      expect(statsAfter.totalItems).toBe(1);
      expect(statsAfter.memoryUsageBytes).toBeGreaterThan(0);
      expect(statsAfter.memoryUsageBytes).toBeLessThan(
        statsBefore.memoryUsageBytes,
      );
    });
  });
});
