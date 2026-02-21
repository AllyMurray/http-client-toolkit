import Database from 'better-sqlite3';
import {
  SqliteAdaptiveRateLimitStore,
  type SqliteAdaptiveRateLimitStoreOptions,
} from './sqlite-adaptive-rate-limit-store.js';
import {
  SQLiteCacheStore,
  type SQLiteCacheStoreOptions,
} from './sqlite-cache-store.js';
import {
  SQLiteDedupeStore,
  type SQLiteDedupeStoreOptions,
} from './sqlite-dedupe-store.js';
import {
  SQLiteRateLimitStore,
  type SQLiteRateLimitStoreOptions,
} from './sqlite-rate-limit-store.js';

export interface CreateSQLiteStoresOptions {
  /** File path for the shared database. Defaults to `':memory:'`. */
  database?: string;
  /** Options for the cache store (excluding `database`). */
  cache?: Omit<SQLiteCacheStoreOptions, 'database'>;
  /** Options for the dedupe store (excluding `database`). */
  dedupe?: Omit<SQLiteDedupeStoreOptions, 'database'>;
  /** Options for the rate limit store (excluding `database`). */
  rateLimit?: Omit<SQLiteRateLimitStoreOptions, 'database'>;
  /** Options for the adaptive rate limit store (excluding `database`). */
  adaptiveRateLimit?: Omit<SqliteAdaptiveRateLimitStoreOptions, 'database'>;
}

export interface SQLiteStores {
  cache: SQLiteCacheStore;
  dedupe: SQLiteDedupeStore;
  rateLimit: SQLiteRateLimitStore;
  adaptiveRateLimit: SqliteAdaptiveRateLimitStore;
  /** Close all stores and the shared database connection. */
  close(): Promise<void>;
}

/**
 * Creates all SQLite-backed stores sharing a single database connection.
 *
 * The factory owns the `better-sqlite3` connection and will close it when
 * `close()` is called. Individual stores receive the shared instance so
 * they will **not** close the underlying connection themselves.
 */
export function createSQLiteStores(
  options: CreateSQLiteStoresOptions = {},
): SQLiteStores {
  const db = new Database(options.database ?? ':memory:');

  const cache = new SQLiteCacheStore({ ...options.cache, database: db });
  const dedupe = new SQLiteDedupeStore({ ...options.dedupe, database: db });
  const rateLimit = new SQLiteRateLimitStore({
    ...options.rateLimit,
    database: db,
  });
  const adaptiveRateLimit = new SqliteAdaptiveRateLimitStore({
    ...options.adaptiveRateLimit,
    database: db,
  });

  return {
    cache,
    dedupe,
    rateLimit,
    adaptiveRateLimit,
    async close() {
      await cache.close();
      await dedupe.close();
      await rateLimit.close();
      await adaptiveRateLimit.close();
      db.close();
    },
  };
}
