import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SQLiteDedupeStore } from './sqlite-dedupe-store.js';

describe('SQLiteDedupeStore', () => {
  let store: SQLiteDedupeStore;
  const testDbPath = path.join(__dirname, 'test-dedupe.db');

  beforeEach(() => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    store = new SQLiteDedupeStore({ database: testDbPath });
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
    it('should register new jobs', async () => {
      const jobId = await store.register('test-hash');
      expect(jobId).toBeTruthy();
      expect(typeof jobId).toBe('string');
    });

    it('should return ownership information from registerOrJoin', async () => {
      const first = await store.registerOrJoin('owner-hash');
      const second = await store.registerOrJoin('owner-hash');

      expect(first.isOwner).toBe(true);
      expect(second.isOwner).toBe(false);
      expect(first.jobId).toBe(second.jobId);
    });

    it('should return undefined for non-existent jobs', async () => {
      const result = await store.waitFor('non-existent-hash');
      expect(result).toBeUndefined();
    });

    it('should complete jobs with values', async () => {
      const hash = 'test-hash';
      await store.register(hash);
      await store.complete(hash, 'test-value');

      const result = await store.waitFor(hash);
      expect(result).toBe('test-value');
    });

    it('should handle job completion with complex objects', async () => {
      const hash = 'test-hash';
      const value = { id: 1, name: 'test', nested: { data: 'value' } };

      await store.register(hash);
      await store.complete(hash, value);

      const result = await store.waitFor(hash);
      expect(result).toEqual(value);
    });

    it('should handle job failure', async () => {
      const hash = 'test-hash';
      const error = new Error('Test error');

      await store.register(hash);
      await store.fail(hash, error);

      // Failed jobs should not be available
      const result = await store.waitFor(hash);
      expect(result).toBeUndefined();
    });

    it('should settle pending waiters when a job fails', async () => {
      const hash = 'failed-pending-hash';
      await store.register(hash);

      const waiting = store.waitFor(hash);
      await store.fail(hash, new Error('failed while waiting'));

      await expect(waiting).resolves.toBeUndefined();
    });

    it('should check if jobs are in progress', async () => {
      const hash = 'test-hash';

      let isInProgress = await store.isInProgress(hash);
      expect(isInProgress).toBe(false);

      await store.register(hash);
      isInProgress = await store.isInProgress(hash);
      expect(isInProgress).toBe(true);

      await store.complete(hash, 'value');
      isInProgress = await store.isInProgress(hash);
      expect(isInProgress).toBe(false);
    });
  });

  describe('deduplication behavior', () => {
    it('should handle multiple jobs with different hashes', async () => {
      const hash1 = 'hash1';
      const hash2 = 'hash2';
      const value1 = 'value1';
      const value2 = 'value2';

      await store.register(hash1);
      await store.register(hash2);

      await store.complete(hash1, value1);
      await store.complete(hash2, value2);

      const result1 = await store.waitFor(hash1);
      const result2 = await store.waitFor(hash2);

      expect(result1).toBe(value1);
      expect(result2).toBe(value2);
    });
  });

  describe('persistence', () => {
    it('should persist jobs across store instances', async () => {
      const hash = 'persistent-hash';
      await store.register(hash);
      await store.complete(hash, 'persistent-value');

      store.destroy();

      // Create new store instance with same database
      const newStore = new SQLiteDedupeStore({ database: testDbPath });
      const result = await newStore.waitFor(hash);
      expect(result).toBe('persistent-value');

      newStore.destroy();
    });

    it('should handle cross-process deduplication', async () => {
      const hash = 'cross-process-hash';

      // Store 1 registers the job
      await store.register(hash);

      // Store 2 can see the job is in progress
      const store2 = new SQLiteDedupeStore({ database: testDbPath });
      const isInProgress = await store2.isInProgress(hash);
      expect(isInProgress).toBe(true);

      // Store 1 completes the job
      await store.complete(hash, 'cross-process-value');

      // Store 2 can get the result
      const result = await store2.waitFor(hash);
      expect(result).toBe('cross-process-value');

      store2.destroy();
    });

    it('should resolve waiters in another store instance when job completes', async () => {
      const hash = 'cross-process-pending-hash';

      await store.register(hash);

      const store2 = new SQLiteDedupeStore({
        database: testDbPath,
        pollIntervalMs: 5,
      });

      try {
        const waitingResult = store2.waitFor(hash);

        await new Promise((resolve) => setTimeout(resolve, 20));
        await store.complete(hash, 'resolved-from-store-1');

        await expect(waitingResult).resolves.toBe('resolved-from-store-1');
      } finally {
        store2.destroy();
      }
    });
  });

  describe('timeout handling', () => {
    it('should handle job timeouts', async () => {
      const timeoutStore = new SQLiteDedupeStore({
        database: testDbPath,
        timeoutMs: 10,
      });
      const hash = 'test-hash';

      await timeoutStore.register(hash);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 50));

      const isInProgress = await timeoutStore.isInProgress(hash);
      expect(isInProgress).toBe(false);

      timeoutStore.destroy();
    });

    it('should not timeout jobs that complete in time', async () => {
      const timeoutStore = new SQLiteDedupeStore({
        database: testDbPath,
        timeoutMs: 100,
      });
      const hash = 'test-hash';

      await timeoutStore.register(hash);
      await timeoutStore.complete(hash, 'value');

      // Wait less than timeout
      await new Promise((resolve) => setTimeout(resolve, 50));

      const result = await timeoutStore.waitFor(hash);
      expect(result).toBe('value');

      timeoutStore.destroy();
    });

    it('waitFor returns shared pending promise for repeated callers', async () => {
      const hash = 'shared-promise';
      await store.register(hash);

      const p1 = store.waitFor(hash);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const p2 = store.waitFor(hash);

      await store.complete(hash, 'done');

      await expect(p1).resolves.toBe('done');
      await expect(p2).resolves.toBe('done');
    });

    it('waitFor settles pending jobs on timeout callback', async () => {
      const timeoutStore = new SQLiteDedupeStore({
        database: testDbPath,
        timeoutMs: 20,
        pollIntervalMs: 50,
      });

      try {
        await timeoutStore.register('timeout-waiter');
        await expect(
          timeoutStore.waitFor('timeout-waiter'),
        ).resolves.toBeUndefined();
      } finally {
        timeoutStore.destroy();
      }
    });

    it('waitFor timeout callback exits early when store is destroyed', async () => {
      const timeoutStore = new SQLiteDedupeStore({
        database: testDbPath,
        timeoutMs: 20,
        pollIntervalMs: 50,
      });

      try {
        await timeoutStore.register('timeout-destroyed');
        const waiting = timeoutStore.waitFor('timeout-destroyed');
        timeoutStore.destroy();
        await expect(waiting).resolves.toBeUndefined();
      } finally {
        timeoutStore.destroy();
      }
    });
  });

  describe('cleanup functionality', () => {
    it('should automatically clean up expired jobs', async () => {
      const cleanupStore = new SQLiteDedupeStore({
        database: testDbPath,
        timeoutMs: 50,
        cleanupIntervalMs: 10,
      });

      const hash = 'cleanup-test';
      await cleanupStore.register(hash);

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      const isInProgress = await cleanupStore.isInProgress(hash);
      expect(isInProgress).toBe(false);

      cleanupStore.destroy();
    });
  });

  describe('listJobs', () => {
    it('should return an empty array when no jobs exist', async () => {
      const jobs = await store.listJobs();
      expect(jobs).toEqual([]);
    });

    it('should list pending jobs', async () => {
      await store.register('hash1');
      await store.register('hash2');

      const jobs = await store.listJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs[0]!.hash).toBe('hash1');
      expect(jobs[0]!.status).toBe('pending');
      expect(jobs[0]!.jobId).toBeTruthy();
      expect(jobs[0]!.createdAt).toBeGreaterThan(0);
    });

    it('should show completed status', async () => {
      await store.register('hash1');
      await store.complete('hash1', 'value');

      const jobs = await store.listJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.status).toBe('completed');
    });

    it('should show failed status', async () => {
      await store.register('hash1');
      await store.fail('hash1', new Error('Test error'));

      const jobs = await store.listJobs();
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.status).toBe('failed');
    });

    it('should support pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await store.register(`hash${i}`);
        await store.complete(`hash${i}`, `value${i}`);
      }

      const page1 = await store.listJobs(0, 2);
      expect(page1).toHaveLength(2);

      const page2 = await store.listJobs(2, 2);
      expect(page2).toHaveLength(2);

      const page3 = await store.listJobs(4, 2);
      expect(page3).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('should handle completing non-existent jobs', async () => {
      await expect(
        store.complete('non-existent', 'value'),
      ).resolves.not.toThrow();
    });

    it('should handle failing non-existent jobs', async () => {
      await expect(
        store.fail('non-existent', new Error('test')),
      ).resolves.not.toThrow();
    });

    it('should handle double completion', async () => {
      const hash = 'double-completion';
      await store.register(hash);
      await store.complete(hash, 'value1');

      // Second completion should not throw
      await expect(store.complete(hash, 'value2')).resolves.not.toThrow();

      const result = await store.waitFor(hash);
      expect(result).toBe('value1'); // First value should be preserved
    });

    it('should handle special characters in hash keys', async () => {
      const specialHash = 'hash-with-特殊字符-and-émojis-🚀';
      await store.register(specialHash);
      await store.complete(specialHash, 'special value');

      const result = await store.waitFor(specialHash);
      expect(result).toBe('special value');
    });

    it('should handle null and undefined values', async () => {
      const hash1 = 'null-test';
      const hash2 = 'undefined-test';

      await store.register(hash1);
      await store.complete(hash1, null);

      await store.register(hash2);
      await store.complete(hash2, undefined);

      const result1 = await store.waitFor(hash1);
      const result2 = await store.waitFor(hash2);

      expect(result1).toBeNull();
      expect(result2).toBeUndefined();
    });

    it('returns undefined when completed payload cannot be deserialized', async () => {
      const hash = 'invalid-json';

      // Use raw SQL to force invalid JSON payload in a completed row.
      (
        store as unknown as {
          sqlite: {
            prepare: (sqlText: string) => {
              run: (...args: Array<unknown>) => void;
            };
          };
        }
      ).sqlite
        .prepare(
          `INSERT INTO dedupe_jobs (hash, job_id, status, result, error, created_at, updated_at)
           VALUES (?, 'job', 'completed', ?, NULL, ?, ?)`,
        )
        .run(hash, 'not-json', Date.now(), Date.now());

      await expect(store.waitFor(hash)).resolves.toBeUndefined();
    });

    it('throws when trying to complete a non-serializable circular payload', async () => {
      const hash = 'circular-payload';
      const circular: { self?: unknown } = {};
      circular.self = circular;

      await store.register(hash);
      await expect(store.complete(hash, circular as unknown)).rejects.toThrow(
        /Failed to serialize result/,
      );
    });

    it('formats non-Error serialization failures in complete()', async () => {
      await store.register('non-error-serialize');

      const stringifySpy = vi
        .spyOn(JSON, 'stringify')
        .mockImplementation(() => {
          throw 'boom';
        });

      try {
        await expect(
          store.complete('non-error-serialize', { value: 'x' } as unknown),
        ).rejects.toThrow(/Failed to serialize result: boom/);
      } finally {
        stringifySpy.mockRestore();
      }
    });
  });

  describe('internal guards', () => {
    it('returns undefined when waitFor query fails', async () => {
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
      privateStore.db.select = (() => {
        throw new Error('db error');
      }) as typeof originalSelect;

      try {
        await expect(store.waitFor('select-failure')).resolves.toBeUndefined();
      } finally {
        privateStore.db.select = originalSelect;
      }
    });

    it('returns undefined when waitFor select yields undefined row', async () => {
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
        await expect(
          store.waitFor('undefined-wait-row'),
        ).resolves.toBeUndefined();
      } finally {
        privateStore.db.select = originalSelect;
      }
    });

    it('settles waitFor when poll query throws', async () => {
      await store.register('poll-throws');

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
      let calls = 0;
      privateStore.db.select = (() => {
        calls += 1;
        if (calls === 1) {
          return {
            from: () => ({
              where: () => ({
                limit: async () => [
                  {
                    hash: 'poll-throws',
                    jobId: 'job-1',
                    status: 'pending',
                    result: null,
                    error: null,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                  },
                ],
              }),
            }),
          };
        }
        throw new Error('poll failure');
      }) as typeof originalSelect;

      try {
        await expect(store.waitFor('poll-throws')).resolves.toBeUndefined();
      } finally {
        privateStore.db.select = originalSelect;
      }
    });

    it('timeout callback settles when store is flagged destroyed', async () => {
      const timeoutStore = new SQLiteDedupeStore({
        database: testDbPath,
        timeoutMs: 15,
        pollIntervalMs: 100,
      });

      try {
        await timeoutStore.register('timeout-destroy-branch');
        const waiting = timeoutStore.waitFor('timeout-destroy-branch');

        (timeoutStore as unknown as { isDestroyed: boolean }).isDestroyed =
          true;
        await expect(waiting).resolves.toBeUndefined();
      } finally {
        timeoutStore.destroy();
      }
    });

    it('poll marks stale pending jobs as failed before settling', async () => {
      const timeoutStore = new SQLiteDedupeStore({
        database: testDbPath,
        timeoutMs: 50,
        pollIntervalMs: 5,
      });

      try {
        const hash = 'stale-pending-job';
        await timeoutStore.register(hash);

        const sqlite = (
          timeoutStore as unknown as { sqlite: Database.Database }
        ).sqlite;
        sqlite
          .prepare('UPDATE dedupe_jobs SET created_at = ? WHERE hash = ?')
          .run(Date.now() - 5_000, hash);

        await expect(timeoutStore.waitFor(hash)).resolves.toBeUndefined();

        const row = sqlite
          .prepare('SELECT status, error FROM dedupe_jobs WHERE hash = ?')
          .get(hash) as { status: string; error: string } | undefined;
        expect(row?.status).toBe('failed');
        expect(row?.error).toBe('Job timed out');
      } finally {
        timeoutStore.destroy();
      }
    });

    it('timeout update errors are swallowed before settling waiters', async () => {
      const timeoutStore = new SQLiteDedupeStore({
        database: testDbPath,
        timeoutMs: 15,
        pollIntervalMs: 50,
      });

      const privateStore = timeoutStore as unknown as {
        db: {
          update: (...args: Array<unknown>) => {
            set: (...setArgs: Array<unknown>) => {
              where: (...whereArgs: Array<unknown>) => Promise<void>;
            };
          };
        };
      };

      const originalUpdate = privateStore.db.update;
      privateStore.db.update = (() => {
        throw new Error('update failed');
      }) as typeof originalUpdate;

      try {
        await timeoutStore.register('timeout-update-failure');
        await expect(
          timeoutStore.waitFor('timeout-update-failure'),
        ).resolves.toBeUndefined();
      } finally {
        privateStore.db.update = originalUpdate;
        timeoutStore.destroy();
      }
    });

    it('handles deserializeResult helper branches', () => {
      const privateStore = store as unknown as {
        deserializeResult: (value: unknown) => unknown;
      };

      expect(privateStore.deserializeResult('__UNDEFINED__')).toBeUndefined();
      expect(privateStore.deserializeResult('__NULL__')).toBeNull();
      expect(privateStore.deserializeResult('{"ok":true}')).toEqual({
        ok: true,
      });
      expect(privateStore.deserializeResult('')).toBeUndefined();
      expect(privateStore.deserializeResult('{not-json')).toBeUndefined();
    });

    it('close settles in-memory waiters map entries', async () => {
      const privateStore = store as unknown as {
        jobSettlers: Map<string, (value: unknown) => void>;
      };

      let settledWith: unknown = Symbol('unset');
      privateStore.jobSettlers.set('manual-waiter', (value) => {
        settledWith = value;
      });

      await store.close();
      expect(settledWith).toBeUndefined();
    });

    it('skips cleanup when timeout is disabled', async () => {
      const timeoutDisabledStore = new SQLiteDedupeStore({
        database: ':memory:',
        timeoutMs: 0,
        cleanupIntervalMs: 0,
      });

      const privateStore = timeoutDisabledStore as unknown as {
        cleanupExpiredJobs: () => Promise<void>;
      };

      await expect(privateStore.cleanupExpiredJobs()).resolves.toBeUndefined();
      timeoutDisabledStore.destroy();
    });

    it('exercises getResult and stats helper paths', async () => {
      await store.register('pending');
      await store.register('completed');
      await store.complete('completed', { ok: true });
      await store.register('failed');
      await store.fail('failed', new Error('boom'));

      const pending = await store.getResult('pending');
      const completed = await store.getResult('completed');
      const failed = await store.getResult('failed');
      const missing = await store.getResult('missing');

      expect(pending).toBeUndefined();
      expect(completed).toEqual({ ok: true });
      expect(failed).toBeUndefined();
      expect(missing).toBeUndefined();

      const stats = await store.getStats();
      expect(stats.totalJobs).toBeGreaterThanOrEqual(3);
      expect(stats.pendingJobs).toBeGreaterThanOrEqual(1);
      expect(stats.completedJobs).toBeGreaterThanOrEqual(1);
      expect(stats.failedJobs).toBeGreaterThanOrEqual(1);
    });

    it('getStats returns zeroes for an empty store', async () => {
      await store.clear();

      await expect(store.getStats()).resolves.toEqual({
        totalJobs: 0,
        pendingJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        expiredJobs: 0,
      });
    });

    it('getResult preserves explicit undefined/null sentinels', async () => {
      await store.register('sentinel-undefined');
      await store.complete('sentinel-undefined', undefined);
      await store.register('sentinel-null');
      await store.complete('sentinel-null', null);

      await expect(
        store.getResult('sentinel-undefined'),
      ).resolves.toBeUndefined();
      await expect(store.getResult('sentinel-null')).resolves.toBeNull();
    });

    it('getResult returns undefined for empty completed payloads', async () => {
      const sqlite = (store as unknown as { sqlite: Database.Database }).sqlite;
      const now = Date.now();
      sqlite
        .prepare(
          `INSERT INTO dedupe_jobs (hash, job_id, status, result, error, created_at, updated_at)
           VALUES (?, ?, 'completed', ?, NULL, ?, ?)`,
        )
        .run('empty-completed', 'j1', null, now, now);

      await expect(store.getResult('empty-completed')).resolves.toBeUndefined();
    });

    it('getResult swallows JSON parse failures in completed payloads', async () => {
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
            limit: async () => [
              {
                hash: 'bad-json',
                status: 'completed',
                result: '{bad-json',
                createdAt: Date.now(),
              },
            ],
          }),
        }),
      })) as typeof originalSelect;

      try {
        await expect(store.getResult('bad-json')).resolves.toBeUndefined();
      } finally {
        privateStore.db.select = originalSelect;
      }
    });

    it('getResult returns undefined when selected job row is missing', async () => {
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
        await expect(store.getResult('missing-row')).resolves.toBeUndefined();
      } finally {
        privateStore.db.select = originalSelect;
      }
    });

    it('isInProgress returns false when selected row is undefined', async () => {
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
        await expect(store.isInProgress('missing-job')).resolves.toBe(false);
      } finally {
        privateStore.db.select = originalSelect;
      }
    });

    it('getResult deletes and returns undefined for expired rows', async () => {
      const shortTimeoutStore = new SQLiteDedupeStore({
        database: testDbPath,
        timeoutMs: 10,
        cleanupIntervalMs: 0,
      });

      try {
        await shortTimeoutStore.register('expired-result-row');
        await new Promise((resolve) => setTimeout(resolve, 30));

        await expect(
          shortTimeoutStore.getResult('expired-result-row'),
        ).resolves.toBeUndefined();
        await expect(
          shortTimeoutStore.isInProgress('expired-result-row'),
        ).resolves.toBe(false);
      } finally {
        shortTimeoutStore.destroy();
      }
    });

    it('cleanup removes expired jobs', async () => {
      const timeoutStore = new SQLiteDedupeStore({
        database: testDbPath,
        timeoutMs: 10,
        cleanupIntervalMs: 0,
      });

      try {
        await timeoutStore.register('expire-cleanup');
        await new Promise((resolve) => setTimeout(resolve, 30));

        await timeoutStore.cleanup();
        await expect(timeoutStore.isInProgress('expire-cleanup')).resolves.toBe(
          false,
        );
      } finally {
        timeoutStore.destroy();
      }
    });

    it('clear settles pending waiters with undefined', async () => {
      await store.register('pending-clear');
      const waiting = store.waitFor('pending-clear');

      await store.clear();
      await expect(waiting).resolves.toBeUndefined();
    });

    it('supports sharing an external sqlite connection', async () => {
      const sqlite = new Database(testDbPath);
      const sharedStore = new SQLiteDedupeStore({ database: sqlite });

      try {
        await sharedStore.register('shared-db');
        await sharedStore.complete('shared-db', 'value');
        await sharedStore.close();

        const row = sqlite
          .prepare('SELECT status FROM dedupe_jobs WHERE hash = ?')
          .get('shared-db') as { status: string } | undefined;
        expect(row?.status).toBe('completed');
      } finally {
        sqlite.close();
      }
    });
  });

  describe('concurrent access', () => {
    it('should handle many concurrent jobs', async () => {
      const promises: Array<Promise<string>> = [];
      const hashes: Array<string> = [];

      // Register many jobs concurrently
      for (let i = 0; i < 20; i++) {
        const hash = `concurrent-${i}`;
        hashes.push(hash);
        promises.push(store.register(hash));
      }

      await Promise.all(promises);

      // Complete all jobs
      const completionPromises = hashes.map((hash, i) =>
        store.complete(hash, `value-${i}`),
      );

      await Promise.all(completionPromises);

      // Check all results
      const results = await Promise.all(
        hashes.map((hash) => store.waitFor(hash)),
      );

      for (let i = 0; i < 20; i++) {
        expect(results[i]).toBe(`value-${i}`);
      }
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
      await expect(store.waitFor('test')).rejects.toThrow();
      await expect(store.register('test')).rejects.toThrow();
      await expect(store.isInProgress('test')).rejects.toThrow();
      await expect(store.complete('test', 'value')).rejects.toThrow();
      await expect(store.fail('test', new Error('boom'))).rejects.toThrow();
    });

    it('should settle pending waiters when destroyed', async () => {
      const timeoutStore = new SQLiteDedupeStore({
        database: testDbPath,
        timeoutMs: 5_000,
        pollIntervalMs: 5,
      });

      try {
        await timeoutStore.register('pending-on-destroy');
        const waitingResult = timeoutStore.waitFor('pending-on-destroy');

        timeoutStore.destroy();

        await expect(waitingResult).resolves.toBeUndefined();
      } finally {
        timeoutStore.destroy();
      }
    });
  });

  describe('configuration', () => {
    it('uses jobTimeoutMs option alias', async () => {
      const timeoutStore = new SQLiteDedupeStore({
        database: testDbPath,
        jobTimeoutMs: 10,
        cleanupIntervalMs: 0,
      });

      try {
        await timeoutStore.register('job-timeout-alias');
        await new Promise((resolve) => setTimeout(resolve, 25));

        await expect(
          timeoutStore.isInProgress('job-timeout-alias'),
        ).resolves.toBe(false);
      } finally {
        timeoutStore.destroy();
      }
    });

    it('should handle timeout of 0 (disabled)', async () => {
      const noTimeoutStore = new SQLiteDedupeStore({
        database: testDbPath,
        timeoutMs: 0,
      });

      const hash = 'no-timeout-test';
      await noTimeoutStore.register(hash);

      // Wait longer than normal timeout would be
      await new Promise((resolve) => setTimeout(resolve, 50));

      const isInProgress = await noTimeoutStore.isInProgress(hash);
      expect(isInProgress).toBe(true); // Should still be in progress

      noTimeoutStore.destroy();
    });

    it('should handle in-memory database', async () => {
      const memoryStore = new SQLiteDedupeStore({ database: ':memory:' });

      try {
        const hash = 'memory-test';
        await memoryStore.register(hash);
        await memoryStore.complete(hash, 'memory-value');

        const result = await memoryStore.waitFor(hash);
        expect(result).toBe('memory-value');
      } finally {
        memoryStore.destroy();
      }
    });
  });
});
