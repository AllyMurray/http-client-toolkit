import * as sqlite from './index.js';

describe('store-sqlite index exports', () => {
  it('re-exports sqlite store classes and schema', () => {
    expect(sqlite.SQLiteCacheStore).toBeTypeOf('function');
    expect(sqlite.SQLiteDedupeStore).toBeTypeOf('function');
    expect(sqlite.SQLiteRateLimitStore).toBeTypeOf('function');
    expect(sqlite.SqliteAdaptiveRateLimitStore).toBeTypeOf('function');
    expect(sqlite.cacheTable).toBeDefined();
    expect(sqlite.dedupeTable).toBeDefined();
    expect(sqlite.rateLimitTable).toBeDefined();
  });

  it('exports createSQLiteStores factory', () => {
    expect(sqlite.createSQLiteStores).toBeTypeOf('function');
  });
});
