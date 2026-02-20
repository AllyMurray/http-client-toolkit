import {
  DynamoDBClient,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  ScanCommand,
  BatchWriteCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DynamoDBDedupeStore } from './dynamodb-dedupe-store.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('DynamoDBDedupeStore', () => {
  let store: DynamoDBDedupeStore;

  beforeEach(() => {
    ddbMock.reset();
    store = new DynamoDBDedupeStore({
      client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
      jobTimeoutMs: 300_000,
      pollIntervalMs: 50,
    });
  });

  afterEach(() => {
    store.destroy();
  });

  describe('register and registerOrJoin', () => {
    it('should register new jobs as owner', async () => {
      ddbMock.on(PutCommand).resolvesOnce({});
      const result = await store.registerOrJoin('test-hash');
      expect(result.isOwner).toBe(true);
      expect(result.jobId).toBeTruthy();
    });

    it('should join existing pending jobs as non-owner', async () => {
      // First call: ConditionalCheckFailedException
      const conditionError = new Error('Condition not met');
      conditionError.name = 'ConditionalCheckFailedException';
      ddbMock.on(PutCommand).rejectsOnce(conditionError);

      // GetCommand to read existing item
      ddbMock.on(GetCommand).resolvesOnce({
        Item: {
          pk: 'DEDUPE#test-hash',
          sk: 'DEDUPE#test-hash',
          jobId: 'existing-job-id',
          status: 'pending',
        },
      });

      const result = await store.registerOrJoin('test-hash');
      expect(result.isOwner).toBe(false);
      expect(result.jobId).toBe('existing-job-id');
    });

    it('should retry registerOrJoin on race condition (item deleted between put and get)', async () => {
      // First attempt: condition fails
      const conditionError = new Error('Condition not met');
      conditionError.name = 'ConditionalCheckFailedException';
      ddbMock
        .on(PutCommand)
        .rejectsOnce(conditionError)
        // Retry: put succeeds
        .resolvesOnce({});

      // Get returns empty (item deleted)
      ddbMock.on(GetCommand).resolvesOnce({});

      const result = await store.registerOrJoin('test-hash');
      expect(result.isOwner).toBe(true);
    });

    it('should rethrow non-condition errors', async () => {
      ddbMock.on(PutCommand).rejectsOnce(new Error('Access denied'));
      await expect(store.registerOrJoin('test-hash')).rejects.toThrow(
        'Access denied',
      );
    });

    it('should throw a clear error when the table is missing', async () => {
      ddbMock.on(PutCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.registerOrJoin('test-hash')).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });

    it('should throw after exhausting all retry attempts (lines 334-336)', async () => {
      const conditionError = new Error('Condition not met');
      conditionError.name = 'ConditionalCheckFailedException';

      // All 3 attempts: condition fails then get returns empty (race condition)
      ddbMock
        .on(PutCommand)
        .rejectsOnce(conditionError)
        .rejectsOnce(conditionError)
        .rejectsOnce(conditionError);

      ddbMock
        .on(GetCommand)
        .resolvesOnce({}) // attempt 1: item deleted
        .resolvesOnce({}) // attempt 2: item deleted
        .resolvesOnce({}); // attempt 3: item deleted

      await expect(store.registerOrJoin('retry-exhaust')).rejects.toThrow(
        'Failed to register or join job for hash "retry-exhaust" after 3 attempts',
      );
    });

    it('register delegates to registerOrJoin', async () => {
      ddbMock.on(PutCommand).resolvesOnce({});
      const jobId = await store.register('test-hash');
      expect(typeof jobId).toBe('string');
    });
  });

  describe('waitFor', () => {
    it('should return undefined for non-existent jobs', async () => {
      ddbMock.on(GetCommand).resolvesOnce({});
      const result = await store.waitFor('non-existent');
      expect(result).toBeUndefined();
    });

    it('should return result for completed jobs', async () => {
      ddbMock.on(GetCommand).resolvesOnce({
        Item: {
          pk: 'DEDUPE#test-hash',
          sk: 'DEDUPE#test-hash',
          jobId: 'job-1',
          status: 'completed',
          result: '"test-value"',
        },
      });

      const result = await store.waitFor('test-hash');
      expect(result).toBe('test-value');
    });

    it('should return undefined for failed jobs', async () => {
      ddbMock.on(GetCommand).resolvesOnce({
        Item: {
          pk: 'DEDUPE#test-hash',
          sk: 'DEDUPE#test-hash',
          jobId: 'job-1',
          status: 'failed',
          error: 'some error',
        },
      });

      const result = await store.waitFor('test-hash');
      expect(result).toBeUndefined();
    });

    it('should poll for pending jobs until completed', async () => {
      ddbMock
        .on(GetCommand)
        // First call: pending
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#test-hash',
            sk: 'DEDUPE#test-hash',
            jobId: 'job-1',
            status: 'pending',
            createdAt: Date.now(),
          },
        })
        // Poll: still pending
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#test-hash',
            sk: 'DEDUPE#test-hash',
            jobId: 'job-1',
            status: 'pending',
            createdAt: Date.now(),
          },
        })
        // Poll: completed
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#test-hash',
            sk: 'DEDUPE#test-hash',
            jobId: 'job-1',
            status: 'completed',
            result: '"done"',
          },
        });

      const result = await store.waitFor('test-hash');
      expect(result).toBe('done');
    });

    it('should return shared promise for repeated waitFor calls', async () => {
      ddbMock
        .on(GetCommand)
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#test-hash',
            sk: 'DEDUPE#test-hash',
            jobId: 'job-1',
            status: 'pending',
            createdAt: Date.now(),
          },
        })
        // Poll returns completed
        .resolves({
          Item: {
            pk: 'DEDUPE#test-hash',
            sk: 'DEDUPE#test-hash',
            jobId: 'job-1',
            status: 'completed',
            result: '"shared-result"',
          },
        });

      const p1 = store.waitFor('test-hash');
      await new Promise((resolve) => setTimeout(resolve, 10));
      const p2 = store.waitFor('test-hash');

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe('shared-result');
      expect(r2).toBe('shared-result');
    });

    it('should return cached promise from jobPromises map (lines 76-77)', async () => {
      const cachedPromise = Promise.resolve('cached-value' as unknown);
      const storeInternals = store as unknown as {
        jobPromises: Map<string, Promise<unknown>>;
      };
      storeInternals.jobPromises.set('cached-hash', cachedPromise);

      const result = await store.waitFor('cached-hash');
      expect(result).toBe('cached-value');
    });

    it('should propagate errors when initial get query throws', async () => {
      ddbMock.on(GetCommand).rejectsOnce(new Error('db error'));
      await expect(store.waitFor('fail-hash')).rejects.toThrow('db error');
    });

    it('should settle on poll failure', async () => {
      ddbMock
        .on(GetCommand)
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#poll-fail',
            sk: 'DEDUPE#poll-fail',
            jobId: 'job-1',
            status: 'pending',
            createdAt: Date.now(),
          },
        })
        // All subsequent polls fail
        .rejects(new Error('poll failure'));

      const result = await store.waitFor('poll-fail');
      expect(result).toBeUndefined();
    });

    it('should settle when polled item disappears', async () => {
      ddbMock
        .on(GetCommand)
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#disappear',
            sk: 'DEDUPE#disappear',
            jobId: 'job-1',
            status: 'pending',
            createdAt: Date.now(),
          },
        })
        // Poll returns no item
        .resolves({});

      const result = await store.waitFor('disappear');
      expect(result).toBeUndefined();
    });

    it('should ignore update errors when marking expired job as failed during poll (line 172)', async () => {
      const shortStore = new DynamoDBDedupeStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
        jobTimeoutMs: 10,
        pollIntervalMs: 5,
      });

      const pastTime = Date.now() - 100;

      ddbMock
        .on(GetCommand)
        // Initial get: pending, already expired
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#expire-err',
            sk: 'DEDUPE#expire-err',
            jobId: 'j1',
            status: 'pending',
            createdAt: pastTime,
          },
        })
        // Poll: still pending, expired
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#expire-err',
            sk: 'DEDUPE#expire-err',
            jobId: 'j1',
            status: 'pending',
            createdAt: pastTime,
          },
        });

      // UpdateCommand fails — the empty catch on line 172 should swallow it
      ddbMock.on(UpdateCommand).rejectsOnce(new Error('update failed'));

      const result = await shortStore.waitFor('expire-err');
      expect(result).toBeUndefined();

      shortStore.destroy();
    });

    it('should skip overlapping polls when previous poll is still in flight (lines 194-195)', async () => {
      // pollIntervalMs=10 so the setInterval fires frequently
      const slowStore = new DynamoDBDedupeStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
        jobTimeoutMs: 300_000,
        pollIntervalMs: 10,
      });

      let intervalPollCount = 0;
      let resolveSlowPoll!: (value: unknown) => void;
      const slowPollPromise = new Promise((resolve) => {
        resolveSlowPoll = resolve;
      });

      ddbMock
        .on(GetCommand)
        // Initial get (from waitFor before the poll loop starts): pending
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#overlap',
            sk: 'DEDUPE#overlap',
            jobId: 'j1',
            status: 'pending',
            createdAt: Date.now(),
          },
        })
        // Immediate poll (void poll() on line 207): pending
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#overlap',
            sk: 'DEDUPE#overlap',
            jobId: 'j1',
            status: 'pending',
            createdAt: Date.now(),
          },
        })
        // First setInterval-triggered poll: slow, blocks isPolling
        .callsFakeOnce(async () => {
          intervalPollCount++;
          await slowPollPromise;
          return {
            Item: {
              pk: 'DEDUPE#overlap',
              sk: 'DEDUPE#overlap',
              jobId: 'j1',
              status: 'completed',
              result: '"overlap-result"',
            },
          };
        })
        // Additional setInterval polls that should be blocked by isPolling guard
        .callsFake(async () => {
          intervalPollCount++;
          return {
            Item: {
              pk: 'DEDUPE#overlap',
              sk: 'DEDUPE#overlap',
              jobId: 'j1',
              status: 'completed',
              result: '"overlap-result"',
            },
          };
        });

      const waitPromise = slowStore.waitFor('overlap');

      // Wait for many poll intervals to fire while the first interval poll is in flight
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Now resolve the slow poll — the isPolling guard should have prevented extra calls
      resolveSlowPoll(undefined);

      const result = await waitPromise;
      expect(result).toBe('overlap-result');
      // Only 1 interval poll should have executed (the isPolling guard blocked the rest)
      expect(intervalPollCount).toBe(1);

      slowStore.destroy();
    });

    it('should settle when poll finds failed status', async () => {
      ddbMock
        .on(GetCommand)
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#poll-failed',
            sk: 'DEDUPE#poll-failed',
            jobId: 'job-1',
            status: 'pending',
            createdAt: Date.now(),
          },
        })
        .resolves({
          Item: {
            pk: 'DEDUPE#poll-failed',
            sk: 'DEDUPE#poll-failed',
            jobId: 'job-1',
            status: 'failed',
            error: 'some error',
          },
        });

      const result = await store.waitFor('poll-failed');
      expect(result).toBeUndefined();
    });
  });

  describe('complete', () => {
    it('should complete a job with a value', async () => {
      ddbMock.on(UpdateCommand).resolvesOnce({});
      await store.complete('test-hash', 'test-value');
      expect(ddbMock.calls()).toHaveLength(1);
    });

    it('should skip double completion', async () => {
      const error = new Error('The conditional request failed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(UpdateCommand).rejectsOnce(error);
      await store.complete('test-hash', 'new-value');
      // Only 1 call (the conditional update), no error thrown
      expect(ddbMock.calls()).toHaveLength(1);
    });

    it('should handle null and undefined values', async () => {
      ddbMock.on(UpdateCommand).resolves({});

      await store.complete('hash-undef', undefined);

      const updateInputUndef =
        ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
      expect(updateInputUndef.ExpressionAttributeValues?.[':result']).toBe(
        '__UNDEFINED__',
      );

      // null
      await store.complete('hash-null', null);

      const updateInputNull =
        ddbMock.commandCalls(UpdateCommand)[1]!.args[0].input;
      expect(updateInputNull.ExpressionAttributeValues?.[':result']).toBe(
        '__NULL__',
      );
    });

    it('should throw on circular reference serialization', async () => {
      const circular: { self?: unknown } = {};
      circular.self = circular;

      await expect(
        store.complete('circular', circular as unknown),
      ).rejects.toThrow(/Failed to serialize result/);
    });

    it('should format non-Error serialization failures', async () => {
      const stringifySpy = vi
        .spyOn(JSON, 'stringify')
        .mockImplementation(() => {
          throw 'boom';
        });

      try {
        await expect(
          store.complete('non-error-ser', { value: 'x' } as unknown),
        ).rejects.toThrow(/Failed to serialize result: boom/);
      } finally {
        stringifySpy.mockRestore();
      }
    });

    it('should rethrow non-conditional errors from UpdateCommand (lines 394-395)', async () => {
      ddbMock
        .on(UpdateCommand)
        .rejectsOnce(new Error('DynamoDB service unavailable'));

      await expect(store.complete('error-hash', 'some-value')).rejects.toThrow(
        'DynamoDB service unavailable',
      );
    });

    it('should throw table missing error from complete', async () => {
      ddbMock.on(UpdateCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.complete('missing-table', 'value')).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });

    it('should settle in-memory waiters on complete', async () => {
      let settledWith: unknown = Symbol('unset');
      (
        store as unknown as {
          jobSettlers: Map<string, (value: unknown) => void>;
        }
      ).jobSettlers.set('settler-hash', (value) => {
        settledWith = value;
      });

      ddbMock.on(UpdateCommand).resolvesOnce({});
      await store.complete('settler-hash', 'settled-value');

      expect(settledWith).toBe('settled-value');
    });
  });

  describe('fail', () => {
    it('should fail a job', async () => {
      ddbMock.on(UpdateCommand).resolvesOnce({});
      await store.fail('test-hash', new Error('test error'));

      const updateInput = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
      expect(updateInput.ExpressionAttributeValues?.[':error']).toBe(
        'Job failed',
      );
    });

    it('should rethrow errors from UpdateCommand (lines 432-434)', async () => {
      ddbMock
        .on(UpdateCommand)
        .rejectsOnce(new Error('DynamoDB service unavailable'));

      await expect(
        store.fail('fail-error-hash', new Error('test')),
      ).rejects.toThrow('DynamoDB service unavailable');
    });

    it('should throw table missing error from fail', async () => {
      ddbMock.on(UpdateCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(
        store.fail('missing-table', new Error('test')),
      ).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });

    it('should settle in-memory waiters on fail', async () => {
      let settledWith: unknown = Symbol('unset');
      (
        store as unknown as {
          jobSettlers: Map<string, (value: unknown) => void>;
        }
      ).jobSettlers.set('fail-hash', (value) => {
        settledWith = value;
      });

      ddbMock.on(UpdateCommand).resolvesOnce({});
      await store.fail('fail-hash', new Error('boom'));
      expect(settledWith).toBeUndefined();
    });
  });

  describe('isInProgress', () => {
    it('should return false for non-existent jobs', async () => {
      ddbMock.on(GetCommand).resolvesOnce({});
      expect(await store.isInProgress('non-existent')).toBe(false);
    });

    it('should return true for pending jobs', async () => {
      ddbMock.on(GetCommand).resolvesOnce({
        Item: {
          pk: 'DEDUPE#test-hash',
          sk: 'DEDUPE#test-hash',
          status: 'pending',
          createdAt: Date.now(),
        },
      });
      expect(await store.isInProgress('test-hash')).toBe(true);
    });

    it('should return false for completed jobs', async () => {
      ddbMock.on(GetCommand).resolvesOnce({
        Item: {
          pk: 'DEDUPE#test-hash',
          sk: 'DEDUPE#test-hash',
          status: 'completed',
          createdAt: Date.now(),
        },
      });
      expect(await store.isInProgress('test-hash')).toBe(false);
    });

    it('should rethrow errors from GetCommand (lines 461-463)', async () => {
      ddbMock
        .on(GetCommand)
        .rejectsOnce(new Error('DynamoDB service unavailable'));

      await expect(store.isInProgress('error-hash')).rejects.toThrow(
        'DynamoDB service unavailable',
      );
    });

    it('should throw table missing error from isInProgress', async () => {
      ddbMock.on(GetCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.isInProgress('missing-table')).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });

    it('should detect and clean up expired jobs', async () => {
      ddbMock.on(GetCommand).resolvesOnce({
        Item: {
          pk: 'DEDUPE#expired',
          sk: 'DEDUPE#expired',
          status: 'pending',
          createdAt: Date.now() - 400_000,
        },
      });
      ddbMock.on(DeleteCommand).resolvesOnce({});

      expect(await store.isInProgress('expired')).toBe(false);
      expect(ddbMock.calls()).toHaveLength(2);
    });
  });

  describe('clear', () => {
    it('should clear all dedupe items', async () => {
      ddbMock.on(ScanCommand).resolvesOnce({
        Items: [
          { pk: 'DEDUPE#h1', sk: 'DEDUPE#h1' },
          { pk: 'DEDUPE#h2', sk: 'DEDUPE#h2' },
        ],
      });
      ddbMock.on(BatchWriteCommand).resolvesOnce({});
      await store.clear();
      expect(ddbMock.calls()).toHaveLength(2);
    });

    it('should settle pending waiters on clear', async () => {
      let settledWith: unknown = Symbol('unset');
      (
        store as unknown as {
          jobSettlers: Map<string, (value: unknown) => void>;
        }
      ).jobSettlers.set('clear-hash', (value) => {
        settledWith = value;
      });

      ddbMock.on(ScanCommand).resolvesOnce({ Items: [] });
      await store.clear();
      expect(settledWith).toBeUndefined();
    });

    it('should use DEDUPE# prefix filter when clearing without scope', async () => {
      ddbMock.on(ScanCommand).resolvesOnce({ Items: [] });
      await store.clear();

      const scanInput = ddbMock.commandCalls(ScanCommand)[0]!.args[0].input;
      expect(scanInput.FilterExpression).toBe('begins_with(pk, :prefix)');
      expect(scanInput.ExpressionAttributeValues?.[':prefix']).toBe('DEDUPE#');
    });

    it('should use DEDUPE#<scope> prefix filter when clearing with scope', async () => {
      ddbMock.on(ScanCommand).resolvesOnce({
        Items: [{ pk: 'DEDUPE#my-scope-hash1', sk: 'DEDUPE#my-scope-hash1' }],
      });
      ddbMock.on(BatchWriteCommand).resolvesOnce({});

      await store.clear('my-scope');

      const scanInput = ddbMock.commandCalls(ScanCommand)[0]!.args[0].input;
      expect(scanInput.FilterExpression).toBe('begins_with(pk, :prefix)');
      expect(scanInput.ExpressionAttributeValues?.[':prefix']).toBe(
        'DEDUPE#my-scope',
      );
    });

    it('should only resolve matching in-memory settlers when clearing with scope', async () => {
      let matchedCalled = false;
      let unmatchedCalled = false;

      const storeInternals = store as unknown as {
        jobSettlers: Map<string, (value: unknown) => void>;
        jobPromises: Map<string, Promise<unknown>>;
      };

      storeInternals.jobSettlers.set('my-scope-hash1', () => {
        matchedCalled = true;
      });
      storeInternals.jobPromises.set(
        'my-scope-hash1',
        Promise.resolve(undefined),
      );

      storeInternals.jobSettlers.set('other-scope-hash2', () => {
        unmatchedCalled = true;
      });
      storeInternals.jobPromises.set(
        'other-scope-hash2',
        Promise.resolve(undefined),
      );

      ddbMock.on(ScanCommand).resolvesOnce({ Items: [] });
      await store.clear('my-scope');

      // The matching settler should have been called
      expect(matchedCalled).toBe(true);
      // The non-matching settler should NOT have been called
      expect(unmatchedCalled).toBe(false);
    });

    it('should preserve non-matching settlers and promises when clearing with scope', async () => {
      const storeInternals = store as unknown as {
        jobSettlers: Map<string, (value: unknown) => void>;
        jobPromises: Map<string, Promise<unknown>>;
      };

      storeInternals.jobSettlers.set('scope-A-hash', () => {});
      storeInternals.jobPromises.set(
        'scope-A-hash',
        Promise.resolve(undefined),
      );

      storeInternals.jobSettlers.set('scope-B-hash', () => {});
      storeInternals.jobPromises.set(
        'scope-B-hash',
        Promise.resolve(undefined),
      );

      ddbMock.on(ScanCommand).resolvesOnce({ Items: [] });
      await store.clear('scope-A');

      // scope-A settler and promise should be removed
      expect(storeInternals.jobSettlers.has('scope-A-hash')).toBe(false);
      expect(storeInternals.jobPromises.has('scope-A-hash')).toBe(false);

      // scope-B settler and promise should remain
      expect(storeInternals.jobSettlers.has('scope-B-hash')).toBe(true);
      expect(storeInternals.jobPromises.has('scope-B-hash')).toBe(true);
    });

    it('should handle scan result with undefined Items (line 511 branch)', async () => {
      ddbMock.on(ScanCommand).resolvesOnce({
        // Items is undefined (not an empty array)
      });
      await store.clear();
      // No BatchWriteCommand should be sent since items is empty
      expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(0);
    });

    it('should throw when clear is called after destroy (lines 488-489)', async () => {
      store.destroy();
      await expect(store.clear()).rejects.toThrow(
        'Dedupe store has been destroyed',
      );
    });

    it('should throw a clear error when the table is missing during scan', async () => {
      ddbMock.on(ScanCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.clear()).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });

    it('should throw a clear error when the table is missing during batch delete', async () => {
      ddbMock.on(ScanCommand).resolvesOnce({
        Items: [
          { pk: 'DEDUPE#h1', sk: 'DEDUPE#h1' },
          { pk: 'DEDUPE#h2', sk: 'DEDUPE#h2' },
        ],
      });
      ddbMock.on(BatchWriteCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.clear()).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });
  });

  describe('deserialization', () => {
    it('handles __UNDEFINED__ sentinel', async () => {
      ddbMock.on(GetCommand).resolvesOnce({
        Item: {
          pk: 'DEDUPE#undef',
          sk: 'DEDUPE#undef',
          jobId: 'j1',
          status: 'completed',
          result: '__UNDEFINED__',
        },
      });
      const result = await store.waitFor('undef');
      expect(result).toBeUndefined();
    });

    it('handles __NULL__ sentinel', async () => {
      ddbMock.on(GetCommand).resolvesOnce({
        Item: {
          pk: 'DEDUPE#null',
          sk: 'DEDUPE#null',
          jobId: 'j1',
          status: 'completed',
          result: '__NULL__',
        },
      });
      const result = await store.waitFor('null');
      expect(result).toBeNull();
    });

    it('handles empty result', async () => {
      ddbMock.on(GetCommand).resolvesOnce({
        Item: {
          pk: 'DEDUPE#empty',
          sk: 'DEDUPE#empty',
          jobId: 'j1',
          status: 'completed',
          result: '',
        },
      });
      const result = await store.waitFor('empty');
      expect(result).toBeUndefined();
    });

    it('handles invalid JSON result', async () => {
      ddbMock.on(GetCommand).resolvesOnce({
        Item: {
          pk: 'DEDUPE#bad',
          sk: 'DEDUPE#bad',
          jobId: 'j1',
          status: 'completed',
          result: '{bad-json',
        },
      });
      const result = await store.waitFor('bad');
      expect(result).toBeUndefined();
    });
  });

  describe('client management', () => {
    it('should accept raw DynamoDBClient and wrap it', () => {
      const rawClient = new DynamoDBClient({ region: 'us-east-1' });
      const s = new DynamoDBDedupeStore({ client: rawClient });
      expect(s).toBeDefined();
      s.destroy();
    });

    it('should create client internally when none provided', () => {
      const s = new DynamoDBDedupeStore({ region: 'us-west-2' });
      expect(s).toBeDefined();
      s.destroy();
    });
  });

  describe('destroy', () => {
    it('should close without throwing', () => {
      expect(() => store.destroy()).not.toThrow();
    });

    it('should be safe to call destroy multiple times', () => {
      expect(() => {
        store.destroy();
        store.destroy();
      }).not.toThrow();
    });

    it('should throw on operations after destroy', async () => {
      store.destroy();
      await expect(store.waitFor('test')).rejects.toThrow();
      await expect(store.register('test')).rejects.toThrow();
      await expect(store.isInProgress('test')).rejects.toThrow();
      await expect(store.complete('test', 'value')).rejects.toThrow();
      await expect(store.fail('test', new Error('boom'))).rejects.toThrow();
    });

    it('should settle pending waiters on destroy', async () => {
      let settledWith: unknown = Symbol('unset');
      (
        store as unknown as {
          jobSettlers: Map<string, (value: unknown) => void>;
        }
      ).jobSettlers.set('destroy-hash', (value) => {
        settledWith = value;
      });

      await store.close();
      expect(settledWith).toBeUndefined();
    });
  });

  describe('input validation', () => {
    it('should reject empty hash values', async () => {
      await expect(store.waitFor('')).rejects.toThrow('hash must not be empty');
      await expect(store.register('')).rejects.toThrow(
        'hash must not be empty',
      );
      await expect(store.complete('', 'value')).rejects.toThrow(
        'hash must not be empty',
      );
    });

    it('should reject oversized hash values', async () => {
      const oversizedHash = 'x'.repeat(513);
      await expect(store.register(oversizedHash)).rejects.toThrow(
        'hash exceeds maximum length',
      );
    });
  });

  describe('timeout handling', () => {
    it('should handle double-settle gracefully when destroy races with in-flight poll (line 113 branch)', async () => {
      const shortStore = new DynamoDBDedupeStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
        jobTimeoutMs: 300_000,
        pollIntervalMs: 10,
      });

      let resolveSlowGet!: (value: unknown) => void;
      const slowGetPromise = new Promise((resolve) => {
        resolveSlowGet = resolve;
      });

      ddbMock
        .on(GetCommand)
        // Initial get: pending
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#double-settle',
            sk: 'DEDUPE#double-settle',
            jobId: 'j1',
            status: 'pending',
            createdAt: Date.now(),
          },
        })
        // Immediate poll: slow — will be in flight when destroy is called
        .callsFakeOnce(async () => {
          await slowGetPromise;
          return {
            Item: {
              pk: 'DEDUPE#double-settle',
              sk: 'DEDUPE#double-settle',
              jobId: 'j1',
              status: 'completed',
              result: '"double-value"',
            },
          };
        });

      const waitPromise = shortStore.waitFor('double-settle');

      // Wait for the initial get to complete and the immediate poll to start
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Destroy while the immediate poll is in flight — this calls settle(undefined) via close()
      shortStore.destroy();

      // Now resolve the slow poll — it will try to call settle() again, hitting line 113
      resolveSlowGet(undefined);

      const result = await waitPromise;
      expect(result).toBeUndefined();
    });

    it('should settle via setTimeout timeout callback (lines 211-240)', async () => {
      const shortStore = new DynamoDBDedupeStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
        jobTimeoutMs: 30,
        pollIntervalMs: 200, // poll interval much longer than timeout so setTimeout fires first
      });

      const now = Date.now();

      ddbMock
        .on(GetCommand)
        // Initial get: pending, recent createdAt so poll won't detect expiry
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#set-timeout',
            sk: 'DEDUPE#set-timeout',
            jobId: 'j1',
            status: 'pending',
            createdAt: now,
          },
        })
        // Subsequent polls also return pending (if they fire)
        .resolves({
          Item: {
            pk: 'DEDUPE#set-timeout',
            sk: 'DEDUPE#set-timeout',
            jobId: 'j1',
            status: 'pending',
            createdAt: now,
          },
        });

      // The UpdateCommand in the setTimeout callback should succeed
      ddbMock.on(UpdateCommand).resolvesOnce({});

      const result = await shortStore.waitFor('set-timeout');
      expect(result).toBeUndefined();

      shortStore.destroy();
    });

    it('should settle via setTimeout even when UpdateCommand fails in timeout callback (lines 235-238)', async () => {
      const shortStore = new DynamoDBDedupeStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
        jobTimeoutMs: 30,
        pollIntervalMs: 200, // poll interval much longer than timeout
      });

      const now = Date.now();

      ddbMock
        .on(GetCommand)
        // Initial get: pending
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#timeout-err',
            sk: 'DEDUPE#timeout-err',
            jobId: 'j1',
            status: 'pending',
            createdAt: now,
          },
        })
        .resolves({
          Item: {
            pk: 'DEDUPE#timeout-err',
            sk: 'DEDUPE#timeout-err',
            jobId: 'j1',
            status: 'pending',
            createdAt: now,
          },
        });

      // The UpdateCommand in the setTimeout callback will fail
      ddbMock.on(UpdateCommand).rejectsOnce(new Error('timeout update failed'));

      const result = await shortStore.waitFor('timeout-err');
      // Should still resolve to undefined via the finally block
      expect(result).toBeUndefined();

      shortStore.destroy();
    });

    it('should settle via setTimeout when store is destroyed before timeout fires (lines 211-213)', async () => {
      const shortStore = new DynamoDBDedupeStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
        jobTimeoutMs: 50,
        pollIntervalMs: 500, // very long poll interval to prevent poll from settling first
      });

      const now = Date.now();

      ddbMock
        .on(GetCommand)
        // Initial get: pending
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#timeout-destroyed',
            sk: 'DEDUPE#timeout-destroyed',
            jobId: 'j1',
            status: 'pending',
            createdAt: now,
          },
        })
        // Immediate poll and any subsequent polls: still pending
        .resolves({
          Item: {
            pk: 'DEDUPE#timeout-destroyed',
            sk: 'DEDUPE#timeout-destroyed',
            jobId: 'j1',
            status: 'pending',
            createdAt: now,
          },
        });

      const waitPromise = shortStore.waitFor('timeout-destroyed');

      // Wait for the immediate poll to complete (runs as microtask, settles in ~0ms with mock)
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Now set isDestroyed directly WITHOUT calling close(), so the settler is NOT called
      // and the setTimeout is NOT cancelled. When setTimeout fires at ~50ms, it will see
      // isDestroyed=true and go through lines 211-213.
      (shortStore as unknown as { isDestroyed: boolean }).isDestroyed = true;

      const result = await waitPromise;
      expect(result).toBeUndefined();

      // Clean up
      shortStore.destroy();
    });

    it('should mark expired jobs as failed during poll', async () => {
      const shortStore = new DynamoDBDedupeStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
        jobTimeoutMs: 10,
        pollIntervalMs: 5,
      });

      // Initial get: pending, old createdAt
      ddbMock
        .on(GetCommand)
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#timeout',
            sk: 'DEDUPE#timeout',
            jobId: 'j1',
            status: 'pending',
            createdAt: Date.now() - 20,
          },
        })
        // Poll: still pending, expired
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#timeout',
            sk: 'DEDUPE#timeout',
            jobId: 'j1',
            status: 'pending',
            createdAt: Date.now() - 20,
          },
        });

      // Update (marking as failed)
      ddbMock.on(UpdateCommand).resolvesOnce({});

      const result = await shortStore.waitFor('timeout');
      expect(result).toBeUndefined();

      shortStore.destroy();
    });

    it('should handle timeout callback when store is destroyed', async () => {
      const shortStore = new DynamoDBDedupeStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
        jobTimeoutMs: 15,
        pollIntervalMs: 100,
      });

      ddbMock
        .on(GetCommand)
        .resolvesOnce({
          Item: {
            pk: 'DEDUPE#timeout-destroy',
            sk: 'DEDUPE#timeout-destroy',
            jobId: 'j1',
            status: 'pending',
            createdAt: Date.now(),
          },
        })
        // Ongoing polls return pending
        .resolves({
          Item: {
            pk: 'DEDUPE#timeout-destroy',
            sk: 'DEDUPE#timeout-destroy',
            jobId: 'j1',
            status: 'pending',
            createdAt: Date.now(),
          },
        });

      const waiting = shortStore.waitFor('timeout-destroy');
      shortStore.destroy();
      await expect(waiting).resolves.toBeUndefined();
    });
  });

  describe('DynamoDB key structure', () => {
    it('should use DEDUPE# prefix for pk and sk', async () => {
      ddbMock.on(PutCommand).resolvesOnce({});
      await store.register('my-hash');

      const putInput = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
      expect(putInput.Item?.pk).toBe('DEDUPE#my-hash');
      expect(putInput.Item?.sk).toBe('DEDUPE#my-hash');
    });

    it('should include TTL based on jobTimeoutMs', async () => {
      ddbMock.on(PutCommand).resolvesOnce({});
      await store.register('ttl-hash');

      const putInput = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
      expect(putInput.Item?.ttl).toBeGreaterThan(0);
    });

    it('should set ttl to 0 when jobTimeoutMs is 0 (line 276)', async () => {
      const noTimeoutStore = new DynamoDBDedupeStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
        jobTimeoutMs: 0,
      });

      ddbMock.on(PutCommand).resolvesOnce({});
      await noTimeoutStore.register('no-timeout-hash');

      const putInput = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
      expect(putInput.Item?.ttl).toBe(0);

      noTimeoutStore.destroy();
    });
  });
});
