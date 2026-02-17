import { SQLiteDedupeStore } from '@http-client-toolkit/store-sqlite';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSqliteDedupeAdapter } from './sqlite.js';

describe('createSqliteDedupeAdapter', () => {
  let store: SQLiteDedupeStore;

  beforeEach(() => {
    store = new SQLiteDedupeStore();
  });

  afterEach(() => {
    store.destroy();
  });

  it('should return sqlite type', () => {
    const adapter = createSqliteDedupeAdapter(store);
    expect(adapter.type).toBe('sqlite');
  });

  it('should get stats', async () => {
    await store.register('hash1');
    await store.complete('hash1', 'value');
    const adapter = createSqliteDedupeAdapter(store);
    const stats = await adapter.getStats();
    expect(stats).toHaveProperty('totalJobs');
  });

  it('should list jobs', async () => {
    await store.register('hash1');
    await store.register('hash2');
    await store.complete('hash1', 'value1');

    const adapter = createSqliteDedupeAdapter(store);
    const result = await adapter.listJobs(0, 10);
    expect(result.jobs).toHaveLength(2);
  });

  it('should get a specific job', async () => {
    await store.register('hash1');
    const adapter = createSqliteDedupeAdapter(store);
    const job = await adapter.getJob('hash1');
    expect(job).toBeDefined();
    expect(job!.hash).toBe('hash1');
    expect(job!.status).toBe('pending');
  });

  it('should return undefined for non-existent job', async () => {
    const adapter = createSqliteDedupeAdapter(store);
    const job = await adapter.getJob('nonexistent');
    expect(job).toBeUndefined();
  });
});
