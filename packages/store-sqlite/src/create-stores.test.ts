import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { describe, it, expect, afterEach } from 'vitest';
import { createSQLiteStores } from './create-stores.js';
import { SqliteAdaptiveRateLimitStore } from './sqlite-adaptive-rate-limit-store.js';
import { SQLiteCacheStore } from './sqlite-cache-store.js';
import { SQLiteDedupeStore } from './sqlite-dedupe-store.js';
import { SQLiteRateLimitStore } from './sqlite-rate-limit-store.js';

describe('createSQLiteStores', () => {
  const testDbPath = path.join(__dirname, 'test-create-stores.db');
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (cleanup) {
      await cleanup();
      cleanup = undefined;
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it('returns all four store instances', () => {
    const stores = createSQLiteStores();
    cleanup = () => stores.close();

    expect(stores.cache).toBeInstanceOf(SQLiteCacheStore);
    expect(stores.dedupe).toBeInstanceOf(SQLiteDedupeStore);
    expect(stores.rateLimit).toBeInstanceOf(SQLiteRateLimitStore);
    expect(stores.adaptiveRateLimit).toBeInstanceOf(
      SqliteAdaptiveRateLimitStore,
    );
  });

  it('defaults to in-memory database', async () => {
    const stores = createSQLiteStores();
    cleanup = () => stores.close();

    await stores.cache.set('key', 'value', 60);
    const value = await stores.cache.get('key');
    expect(value).toBe('value');
  });

  it('all stores share the same database file', async () => {
    const stores = createSQLiteStores({ database: testDbPath });
    cleanup = () => stores.close();

    await stores.cache.set('cache-key', 'cached', 60);
    await stores.dedupe.register('dedupe-hash');
    await stores.rateLimit.record('resource-1');

    // Verify all data lives in the same database file
    const db = new Database(testDbPath);
    try {
      const cacheRow = db
        .prepare('SELECT * FROM cache WHERE hash = ?')
        .get('cache-key');
      expect(cacheRow).toBeDefined();

      const dedupeRow = db
        .prepare('SELECT * FROM dedupe_jobs WHERE hash = ?')
        .get('dedupe-hash');
      expect(dedupeRow).toBeDefined();

      const rateLimitRow = db
        .prepare('SELECT * FROM rate_limits WHERE resource = ?')
        .get('resource-1');
      expect(rateLimitRow).toBeDefined();
    } finally {
      db.close();
    }
  });

  it('close() stops timers and closes the database', async () => {
    const stores = createSQLiteStores();
    await stores.close();

    await expect(stores.cache.get('key')).rejects.toThrow();
    await expect(stores.dedupe.isInProgress('hash')).rejects.toThrow();
  });

  it('passes store-specific options through', async () => {
    const stores = createSQLiteStores({
      cache: { cleanupIntervalMs: 0 },
      dedupe: { jobTimeoutMs: 10_000 },
      rateLimit: {
        defaultConfig: { limit: 5, windowMs: 1000 },
      },
    });
    cleanup = () => stores.close();

    // Verify rate limit config was applied: 5 records should fill capacity
    for (let i = 0; i < 5; i++) {
      await stores.rateLimit.record('limited');
    }
    const canProceed = await stores.rateLimit.canProceed('limited');
    expect(canProceed).toBe(false);
  });
});
