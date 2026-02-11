import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SQLiteCacheStore } from './sqlite-cache-store.js';

describe('SQLiteCacheStore', () => {
  let store: SQLiteCacheStore;
  const testDbPath = path.join(__dirname, 'test-cache.db');

  beforeEach(() => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    store = new SQLiteCacheStore({ database: testDbPath });
  });

  afterEach(() => {
    if (store) {
      store.destroy();
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
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

    it('should handle zero TTL', async () => {
      await store.set('key1', 'value1', 0);

      // Should not expire
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

  describe('persistence', () => {
    it('should persist data across store instances', async () => {
      await store.set('persistent', 'value', 60);
      store.destroy();

      // Create new store instance with same database
      const newStore = new SQLiteCacheStore({ database: testDbPath });
      const value = await newStore.get('persistent');
      expect(value).toBe('value');

      newStore.destroy();
    });

    it('should handle database file creation', () => {
      const newDbPath = path.join(__dirname, 'new-cache.db');

      try {
        expect(fs.existsSync(newDbPath)).toBe(false);

        const newStore = new SQLiteCacheStore({ database: newDbPath });
        expect(fs.existsSync(newDbPath)).toBe(true);

        newStore.destroy();
      } finally {
        if (fs.existsSync(newDbPath)) {
          fs.unlinkSync(newDbPath);
        }
      }
    });
  });

  describe('cleanup functionality', () => {
    it('should automatically clean up expired items', async () => {
      // Create store with very short cleanup interval
      const cleanupStore = new SQLiteCacheStore({
        database: testDbPath,
        cleanupIntervalMs: 10,
      });

      await cleanupStore.set('key1', 'value1', 0.001); // 1ms TTL

      // Wait for cleanup to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      const value = await cleanupStore.get('key1');
      expect(value).toBeUndefined();

      cleanupStore.destroy();
    });

    it('should not clean up unexpired items', async () => {
      // Create store with very short cleanup interval
      const cleanupStore = new SQLiteCacheStore({
        database: testDbPath,
        cleanupIntervalMs: 10,
      });

      await cleanupStore.set('key1', 'value1', 10); // 10 seconds TTL

      // Wait for cleanup to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      const value = await cleanupStore.get('key1');
      expect(value).toBe('value1');

      cleanupStore.destroy();
    });

    it('should not clean up non-expiring items', async () => {
      const cleanupStore = new SQLiteCacheStore({
        database: testDbPath,
        cleanupIntervalMs: 10,
      });

      await cleanupStore.set('permanent', 'value', 0);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const value = await cleanupStore.get('permanent');
      expect(value).toBe('value');

      cleanupStore.destroy();
    });

    it('should handle cleanup interval of 0 (disabled)', async () => {
      const noCleanupStore = new SQLiteCacheStore({
        database: testDbPath,
        cleanupIntervalMs: 0,
      });

      expect(
        (noCleanupStore as unknown as { cleanupInterval?: NodeJS.Timeout })
          .cleanupInterval,
      ).toBeUndefined();

      // Should work without automatic cleanup
      await noCleanupStore.set('key1', 'value1', 60);
      const value = await noCleanupStore.get('key1');
      expect(value).toBe('value1');

      noCleanupStore.destroy();
    });
  });

  describe('concurrent access', () => {
    it('should handle many concurrent operations', async () => {
      const promises: Array<Promise<void>> = [];

      // Set 50 values concurrently
      for (let i = 0; i < 50; i++) {
        promises.push(store.set(`key${i}`, `value${i}`, 60));
      }

      await Promise.all(promises);

      // Get all values
      const getPromises: Array<Promise<unknown>> = [];
      for (let i = 0; i < 50; i++) {
        getPromises.push(store.get(`key${i}`));
      }

      const values = await Promise.all(getPromises);

      // Check all values are correct
      for (let i = 0; i < 50; i++) {
        expect(values[i]).toBe(`value${i}`);
      }
    });

    it('should handle concurrent access from multiple store instances', async () => {
      const store2 = new SQLiteCacheStore({ database: testDbPath });

      try {
        // Set values from both stores
        await Promise.all([
          store.set('key1', 'from-store1', 60),
          store2.set('key2', 'from-store2', 60),
        ]);

        // Read from both stores
        const value1FromStore2 = await store2.get('key1');
        const value2FromStore1 = await store.get('key2');

        expect(value1FromStore2).toBe('from-store1');
        expect(value2FromStore1).toBe('from-store2');
      } finally {
        store2.destroy();
      }
    });
  });

  describe('edge cases', () => {
    it('should handle very large values', async () => {
      const largeValue = 'x'.repeat(100000); // 100KB string
      await store.set('large', largeValue, 60);
      const value = await store.get('large');
      expect(value).toBe(largeValue);
    });

    it('should handle special characters in keys', async () => {
      const specialKey = 'key-with-特殊字符-and-émojis-🚀';
      await store.set(specialKey, 'special value', 60);
      const value = await store.get(specialKey);
      expect(value).toBe('special value');
    });

    it('should handle special characters in values', async () => {
      const specialValue =
        'value-with-特殊字符-and-émojis-🚀-and-quotes-"test"-and-apostrophes-\'test\'';
      await store.set('special', specialValue, 60);
      const value = await store.get('special');
      expect(value).toBe(specialValue);
    });

    it('should handle JSON serialization errors gracefully', async () => {
      // Create a circular reference
      const circular: { name: string; self?: unknown } = { name: 'test' };
      circular.self = circular; // This creates the actual circular reference

      // Should handle serialization error gracefully
      await expect(store.set('circular', circular, 60)).rejects.toThrow();
    });

    it('should handle database errors gracefully', async () => {
      // Close the database to simulate an error
      store.destroy();

      // Operations should fail gracefully
      await expect(store.get('key')).rejects.toThrow();
      await expect(store.set('key', 'value', 60)).rejects.toThrow();
      await expect(store.delete('key')).rejects.toThrow();
      await expect(store.clear()).rejects.toThrow();
    });
  });

  describe('destroy', () => {
    it('should close database connection when destroyed', () => {
      expect(() => store.destroy()).not.toThrow();
    });

    it('should be safe to call destroy multiple times', () => {
      expect(() => {
        store.destroy();
        store.destroy();
      }).not.toThrow();
    });

    it('should handle operations after destroy', async () => {
      store.destroy();

      // Should throw errors after destruction
      await expect(store.get('key')).rejects.toThrow();
      await expect(store.set('key', 'value', 60)).rejects.toThrow();
    });
  });

  describe('statistics and internals', () => {
    it('returns cache statistics', async () => {
      await store.set('active', 'value', 60);
      await store.set('expired', 'value', -1);

      const stats = await (store as SQLiteCacheStore).getStats();
      expect(stats.totalItems).toBeGreaterThanOrEqual(1);
      expect(stats.expiredItems).toBeGreaterThanOrEqual(0);
      expect(stats.databaseSizeKB).toBeGreaterThanOrEqual(0);
    });

    it('falls back to zero DB size when pragma values are not numeric', async () => {
      const privateStore = store as unknown as {
        sqlite: {
          pragma: (name: string, options: { simple: boolean }) => unknown;
        };
      };
      const originalPragma = privateStore.sqlite.pragma;
      privateStore.sqlite.pragma = () => 'not-a-number';

      try {
        const stats = await (store as SQLiteCacheStore).getStats();
        expect(stats.databaseSizeKB).toBe(0);
      } finally {
        privateStore.sqlite.pragma = originalPragma;
      }
    });

    it('falls back to zero counts when stats queries return empty sets', async () => {
      const privateStore = store as unknown as {
        db: {
          select: () => {
            from: () => {
              where?: () => Promise<Array<{ count?: number }>>;
              then?: unknown;
            };
          };
        };
      };

      const originalSelect = privateStore.db.select;
      privateStore.db.select = (() => ({
        from: () => ({
          where: async () => [],
          then: undefined,
        }),
      })) as typeof originalSelect;

      try {
        const stats = await (store as SQLiteCacheStore).getStats();
        expect(stats.totalItems).toBe(0);
        expect(stats.expiredItems).toBe(0);
      } finally {
        privateStore.db.select = originalSelect;
      }
    });

    it('drops corrupted cache rows when value cannot be deserialized', async () => {
      const now = Date.now();
      const privateStore = store as unknown as {
        db: {
          select: () => {
            from: () => {
              where: () => {
                limit: () => Promise<
                  Array<{
                    hash: string;
                    value: unknown;
                    expiresAt: number;
                    createdAt: number;
                  }>
                >;
              };
            };
          };
        };
      };

      const originalSelect = privateStore.db.select;
      privateStore.db.select = (() => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              {
                hash: 'corrupt',
                value: { not: 'a-json-string' },
                expiresAt: now + 60_000,
                createdAt: now,
              },
            ],
          }),
        }),
      })) as typeof originalSelect;

      try {
        await expect(store.get('corrupt')).resolves.toBeUndefined();
      } finally {
        privateStore.db.select = originalSelect;
      }
    });

    it('covers defensive branch when select result row is undefined', async () => {
      const privateStore = store as unknown as {
        db: {
          select: () => {
            from: () => {
              where: () => { limit: () => Promise<Array<unknown>> };
            };
          };
        };
      };

      const originalSelect = privateStore.db.select;
      privateStore.db.select = (() => ({
        from: () => ({
          where: () => ({
            limit: async () => [undefined],
          }),
        }),
      })) as typeof originalSelect;

      try {
        await expect(store.get('undefined-row')).resolves.toBeUndefined();
      } finally {
        privateStore.db.select = originalSelect;
      }
    });

    it('covers non-Error serialization failure formatting path', async () => {
      const stringifySpy = vi
        .spyOn(JSON, 'stringify')
        .mockImplementation(() => {
          throw 'boom';
        });

      try {
        await expect(store.set('serialize-fail', 'value', 60)).rejects.toThrow(
          /Failed to serialize value: boom/,
        );
      } finally {
        stringifySpy.mockRestore();
      }
    });

    it('allows sharing an external sqlite connection', async () => {
      const sqlite = new Database(testDbPath);
      const sharedStore = new SQLiteCacheStore({ database: sqlite });

      try {
        await sharedStore.set('shared', 'value', 60);
        await sharedStore.close();

        const row = sqlite
          .prepare('SELECT value FROM cache WHERE hash = ?')
          .get('shared') as { value: Buffer | string } | undefined;
        expect(row).toBeDefined();
        expect(row?.value).toBeDefined();
      } finally {
        sqlite.close();
      }
    });

    it('can run cleanupExpiredItems private helper', async () => {
      const now = Date.now();
      const sqlite = (store as unknown as { sqlite: Database.Database }).sqlite;
      sqlite
        .prepare(
          `INSERT INTO cache (hash, value, expires_at, created_at) VALUES (?, ?, ?, ?)`,
        )
        .run('expired-private', '"v"', now - 1_000, now - 2_000);

      await (
        store as unknown as {
          cleanupExpiredItems: () => Promise<void>;
        }
      ).cleanupExpiredItems();

      await expect(store.get('expired-private')).resolves.toBeUndefined();
    });
  });

  describe('configuration', () => {
    it('should use custom cleanup interval', () => {
      const customStore = new SQLiteCacheStore({
        database: testDbPath,
        cleanupIntervalMs: 5000,
      });

      // Should have created the store without throwing
      expect(customStore).toBeDefined();

      customStore.destroy();
    });

    it('should handle in-memory database', async () => {
      const memoryStore = new SQLiteCacheStore({ database: ':memory:' });

      try {
        await memoryStore.set('test', 'value', 60);
        const value = await memoryStore.get('test');
        expect(value).toBe('value');
      } finally {
        memoryStore.destroy();
      }
    });
  });

  describe('size guard (maxEntrySizeBytes)', () => {
    it('should skip caching values that exceed maxEntrySizeBytes', async () => {
      const smallLimitStore = new SQLiteCacheStore({
        database: testDbPath,
        maxEntrySizeBytes: 100, // 100 bytes limit
      });

      try {
        const largeValue = 'x'.repeat(200); // 200 bytes string

        await expect(
          smallLimitStore.set('too-big', largeValue, 60),
        ).resolves.not.toThrow();

        const value = await smallLimitStore.get('too-big');
        expect(value).toBeUndefined();
      } finally {
        smallLimitStore.destroy();
      }
    });

    it('should cache values that are within maxEntrySizeBytes', async () => {
      const smallLimitStore = new SQLiteCacheStore({
        database: testDbPath,
        maxEntrySizeBytes: 100, // 100 bytes limit
      });

      try {
        const smallValue = 'x'.repeat(50); // 50 bytes string

        await smallLimitStore.set('fits', smallValue, 60);
        const value = await smallLimitStore.get('fits');
        expect(value).toBe(smallValue);
      } finally {
        smallLimitStore.destroy();
      }
    });
  });
});
