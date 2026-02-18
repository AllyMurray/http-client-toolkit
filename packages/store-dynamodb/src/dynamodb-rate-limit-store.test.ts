import {
  DynamoDBClient,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DynamoDBRateLimitStore } from './dynamodb-rate-limit-store.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('DynamoDBRateLimitStore', () => {
  let store: DynamoDBRateLimitStore;
  const defaultConfig = { limit: 5, windowMs: 1000 };

  beforeEach(() => {
    ddbMock.reset();
    store = new DynamoDBRateLimitStore({
      client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
      defaultConfig,
    });
  });

  afterEach(() => {
    store.destroy();
  });

  describe('basic operations', () => {
    it('should allow requests within limit', async () => {
      ddbMock.on(QueryCommand).resolvesOnce({ Count: 2 });
      const canProceed = await store.canProceed('test-resource');
      expect(canProceed).toBe(true);
    });

    it('should block requests over limit', async () => {
      ddbMock.on(QueryCommand).resolvesOnce({ Count: 5 });
      const canProceed = await store.canProceed('test-resource');
      expect(canProceed).toBe(false);
    });

    it('should record requests', async () => {
      ddbMock.on(PutCommand).resolvesOnce({});
      await store.record('test-resource');

      const putInput = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
      expect(putInput.Item?.pk).toBe('RATELIMIT#test-resource');
      expect(putInput.Item?.sk).toMatch(/^TS#\d+#/);
      expect(putInput.Item?.ttl).toBeGreaterThan(0);
    });

    it('should throw a clear error when the table is missing', async () => {
      ddbMock.on(PutCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.record('missing-table')).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });

    it('should provide status information', async () => {
      ddbMock.on(QueryCommand).resolvesOnce({ Count: 2 });
      const status = await store.getStatus('test-resource');
      expect(status.remaining).toBe(3);
      expect(status.limit).toBe(5);
      expect(status.resetTime).toBeInstanceOf(Date);
    });

    it('should reset rate limits', async () => {
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({
          Items: [
            { pk: 'RATELIMIT#test', sk: 'TS#123#uuid1' },
            { pk: 'RATELIMIT#test', sk: 'TS#124#uuid2' },
          ],
        })
        // Slot partition key query returns empty
        .resolvesOnce({ Items: [] });
      ddbMock.on(BatchWriteCommand).resolvesOnce({});

      await store.reset('test');
      expect(ddbMock.calls()).toHaveLength(3);
    });

    it('should retry acquire on conditional transaction cancellation reasons', async () => {
      const conditionalCancelError = new Error('Transaction cancelled');
      conditionalCancelError.name = 'TransactionCanceledException';
      (
        conditionalCancelError as unknown as { CancellationReasons: unknown }
      ).CancellationReasons = [
        { Code: 'ConditionalCheckFailed' },
        { Code: 'None' },
      ];

      ddbMock
        .on(TransactWriteCommand)
        .rejectsOnce(conditionalCancelError)
        .resolvesOnce({});

      const acquired = await store.acquire('retry-resource');
      expect(acquired).toBe(true);
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(2);
    });

    it('should return false from acquire when limit is zero', async () => {
      const zeroLimitStore = new DynamoDBRateLimitStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
        defaultConfig: { limit: 0, windowMs: 1000 },
      });

      const acquired = await zeroLimitStore.acquire('test');
      expect(acquired).toBe(false);
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
      zeroLimitStore.destroy();
    });

    it('should re-throw non-conditional, non-table-missing errors from acquire', async () => {
      const genericError = new Error('Internal DynamoDB failure');
      ddbMock.on(TransactWriteCommand).rejectsOnce(genericError);

      await expect(store.acquire('test-resource')).rejects.toThrow(
        'Internal DynamoDB failure',
      );
    });

    it('should return false from acquire when all slots are exhausted', async () => {
      const conditionalCancelError = new Error('Transaction cancelled');
      conditionalCancelError.name = 'TransactionCanceledException';
      (
        conditionalCancelError as unknown as { CancellationReasons: unknown }
      ).CancellationReasons = [
        { Code: 'ConditionalCheckFailed' },
        { Code: 'None' },
      ];

      // Reject for every slot (limit is 5)
      ddbMock
        .on(TransactWriteCommand)
        .rejectsOnce(conditionalCancelError)
        .rejectsOnce(conditionalCancelError)
        .rejectsOnce(conditionalCancelError)
        .rejectsOnce(conditionalCancelError)
        .rejectsOnce(conditionalCancelError);

      const acquired = await store.acquire('test-resource');
      expect(acquired).toBe(false);
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(5);
    });

    it('should throw a clear error when acquire fails with ResourceNotFoundException', async () => {
      ddbMock.on(TransactWriteCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.acquire('test-resource')).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });

    it('should handle reset when query returns undefined Items', async () => {
      // Both partition key queries (RATELIMIT# and RATELIMIT_SLOT#) return no Items field
      ddbMock.on(QueryCommand).resolves({});
      await store.reset('test');
      // Two queries: one for RATELIMIT#test, one for RATELIMIT_SLOT#test
      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(2);
      expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(0);
    });

    it('should throw a clear error when reset query fails with ResourceNotFoundException', async () => {
      ddbMock.on(QueryCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.reset('test')).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });

    it('should throw a clear error when reset batch delete fails with ResourceNotFoundException', async () => {
      ddbMock.on(QueryCommand).resolvesOnce({
        Items: [
          { pk: 'RATELIMIT#test', sk: 'TS#123#uuid1' },
          { pk: 'RATELIMIT#test', sk: 'TS#124#uuid2' },
        ],
      });
      ddbMock.on(BatchWriteCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.reset('test')).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });

    it('should handle reset with pagination', async () => {
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({
          Items: [{ pk: 'RATELIMIT#test', sk: 'TS#1#u1' }],
          LastEvaluatedKey: { pk: 'RATELIMIT#test', sk: 'TS#1#u1' },
        })
        .resolvesOnce({
          Items: [{ pk: 'RATELIMIT#test', sk: 'TS#2#u2' }],
        })
        // Slot partition key query returns empty
        .resolvesOnce({ Items: [] });
      ddbMock.on(BatchWriteCommand).resolves({});

      await store.reset('test');
      expect(ddbMock.calls()).toHaveLength(5);
    });
  });

  describe('wait time calculation', () => {
    it('should return zero when under limit', async () => {
      ddbMock.on(QueryCommand).resolvesOnce({ Count: 2 });
      const waitTime = await store.getWaitTime('test-resource');
      expect(waitTime).toBe(0);
    });

    it('should return window time when limit is zero', async () => {
      const zeroLimitStore = new DynamoDBRateLimitStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
        defaultConfig: { limit: 0, windowMs: 1000 },
      });
      const waitTime = await zeroLimitStore.getWaitTime('test');
      expect(waitTime).toBe(1000);
      zeroLimitStore.destroy();
    });

    it('should calculate wait time from oldest request', async () => {
      const now = Date.now();
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Count: 5 })
        .resolvesOnce({
          Items: [
            {
              pk: 'RATELIMIT#test',
              sk: `TS#${now - 500}#uuid`,
              timestamp: now - 500,
            },
          ],
        });

      const waitTime = await store.getWaitTime('test');
      expect(waitTime).toBeGreaterThan(0);
      expect(waitTime).toBeLessThanOrEqual(1000);
    });

    it('should return zero when oldest result is missing', async () => {
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Count: 5 })
        .resolvesOnce({ Items: [] });
      const waitTime = await store.getWaitTime('test');
      expect(waitTime).toBe(0);
    });

    it('should return zero when oldest timestamp is undefined', async () => {
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Count: 5 })
        .resolvesOnce({
          Items: [{ pk: 'RATELIMIT#test', sk: 'TS#1#uuid' }],
        });
      const waitTime = await store.getWaitTime('test');
      expect(waitTime).toBe(0);
    });

    it('should throw a clear error when getWaitTime oldest-request query fails with ResourceNotFoundException', async () => {
      // First query (hasCapacityInWindow) succeeds and reports at capacity
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Count: 5 })
        // Second query (find oldest request) fails with table missing
        .rejectsOnce(
          new ResourceNotFoundException({
            message: 'Requested resource not found',
            $metadata: {},
          }),
        );

      await expect(store.getWaitTime('test')).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });
  });

  describe('resource-specific configurations', () => {
    it('should use default config for unspecified resources', async () => {
      ddbMock.on(QueryCommand).resolvesOnce({ Count: 0 });
      const status = await store.getStatus('unknown-resource');
      expect(status.limit).toBe(defaultConfig.limit);
    });

    it('should use resource-specific configs', async () => {
      ddbMock.on(QueryCommand).resolvesOnce({ Count: 0 });

      const configStore = new DynamoDBRateLimitStore({
        client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
        defaultConfig,
        resourceConfigs: new Map([['special', { limit: 10, windowMs: 2000 }]]),
      });

      const status = await configStore.getStatus('special');
      expect(status.limit).toBe(10);
      configStore.destroy();
    });

    it('should update resource configs dynamically', () => {
      store.setResourceConfig('dynamic', { limit: 20, windowMs: 5000 });
      expect(store.getResourceConfig('dynamic')).toEqual({
        limit: 20,
        windowMs: 5000,
      });
    });

    it('should return default config for unknown resource', () => {
      expect(store.getResourceConfig('unknown')).toEqual(defaultConfig);
    });
  });

  describe('clear', () => {
    it('should clear all rate limit items', async () => {
      ddbMock.on(ScanCommand).resolvesOnce({
        Items: [
          { pk: 'RATELIMIT#r1', sk: 'TS#1#u1' },
          { pk: 'RATELIMIT#r2', sk: 'TS#2#u2' },
        ],
      });
      ddbMock.on(BatchWriteCommand).resolvesOnce({});
      await store.clear();
      expect(ddbMock.calls()).toHaveLength(2);
    });

    it('should handle clear with empty table', async () => {
      ddbMock.on(ScanCommand).resolvesOnce({ Items: [] });
      await store.clear();
      expect(ddbMock.calls()).toHaveLength(1);
    });

    it('should handle clear with pagination', async () => {
      ddbMock
        .on(ScanCommand)
        .resolvesOnce({
          Items: [{ pk: 'RATELIMIT#r1', sk: 'TS#1#u1' }],
          LastEvaluatedKey: { pk: 'RATELIMIT#r1', sk: 'TS#1#u1' },
        })
        .resolvesOnce({ Items: [] });
      ddbMock.on(BatchWriteCommand).resolvesOnce({});
      await store.clear();
      expect(ddbMock.calls()).toHaveLength(3);
    });

    it('should handle clear when scan returns undefined Items', async () => {
      ddbMock.on(ScanCommand).resolvesOnce({});
      await store.clear();
      expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(1);
      expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(0);
    });

    it('should throw a clear error when clear scan fails with ResourceNotFoundException', async () => {
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

    it('should throw a clear error when clear batch delete fails with ResourceNotFoundException', async () => {
      ddbMock.on(ScanCommand).resolvesOnce({
        Items: [{ pk: 'RATELIMIT#r1', sk: 'TS#1#u1' }],
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

  describe('DynamoDB key structure', () => {
    it('should use RATELIMIT# prefix and TS# sort key', async () => {
      ddbMock.on(PutCommand).resolvesOnce({});
      await store.record('my-resource');

      const putInput = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
      expect(putInput.Item?.pk).toBe('RATELIMIT#my-resource');
      expect(putInput.Item?.sk).toMatch(/^TS#\d+#[a-f0-9-]+$/);
    });

    it('should use COUNT query for canProceed', async () => {
      ddbMock.on(QueryCommand).resolvesOnce({ Count: 0 });
      await store.canProceed('test');

      const queryInput = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
      expect(queryInput.Select).toBe('COUNT');
      expect(queryInput.KeyConditionExpression).toContain('pk = :pk');
    });

    it('should handle undefined Count in query result', async () => {
      ddbMock.on(QueryCommand).resolvesOnce({});
      const canProceed = await store.canProceed('test');
      expect(canProceed).toBe(true);
    });
  });

  describe('client management', () => {
    it('should accept raw DynamoDBClient', () => {
      const rawClient = new DynamoDBClient({ region: 'us-east-1' });
      const s = new DynamoDBRateLimitStore({ client: rawClient });
      expect(s).toBeDefined();
      s.destroy();
    });

    it('should create client internally when none provided', () => {
      const s = new DynamoDBRateLimitStore({ region: 'us-west-2' });
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
      await expect(store.canProceed('test')).rejects.toThrow();
      await expect(store.acquire('test')).rejects.toThrow(
        'Rate limit store has been destroyed',
      );
      await expect(store.record('test')).rejects.toThrow();
      await expect(store.getStatus('test')).rejects.toThrow();
      await expect(store.getWaitTime('test')).rejects.toThrow();
      await expect(store.reset('test')).rejects.toThrow();
      await expect(store.clear()).rejects.toThrow();
    });
  });

  describe('cooldown methods', () => {
    it('should set a cooldown with COOLDOWN# prefix, cooldownUntil, and ttl', async () => {
      ddbMock.on(PutCommand).resolvesOnce({});

      const cooldownUntilMs = Date.now() + 30_000;
      await store.setCooldown('api.example.com', cooldownUntilMs);

      const putInput = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
      expect(putInput.Item?.pk).toBe('COOLDOWN#api.example.com');
      expect(putInput.Item?.sk).toBe('COOLDOWN#api.example.com');
      expect(putInput.Item?.cooldownUntil).toBe(cooldownUntilMs);
      expect(putInput.Item?.ttl).toBe(Math.floor(cooldownUntilMs / 1000));
    });

    it('should return cooldownUntil when cooldown is active', async () => {
      const cooldownUntilMs = Date.now() + 30_000;
      ddbMock.on(GetCommand).resolvesOnce({
        Item: {
          pk: 'COOLDOWN#api.example.com',
          sk: 'COOLDOWN#api.example.com',
          cooldownUntil: cooldownUntilMs,
          ttl: Math.floor(cooldownUntilMs / 1000),
        },
      });

      const result = await store.getCooldown('api.example.com');
      expect(result).toBe(cooldownUntilMs);
    });

    it('should return undefined and delete when cooldown is expired', async () => {
      const expiredCooldownUntilMs = Date.now() - 1000;
      ddbMock.on(GetCommand).resolvesOnce({
        Item: {
          pk: 'COOLDOWN#api.example.com',
          sk: 'COOLDOWN#api.example.com',
          cooldownUntil: expiredCooldownUntilMs,
          ttl: Math.floor(expiredCooldownUntilMs / 1000),
        },
      });
      ddbMock.on(DeleteCommand).resolvesOnce({});

      const result = await store.getCooldown('api.example.com');
      expect(result).toBeUndefined();

      // Verify that clearCooldown was called (DeleteCommand sent)
      const deleteInput = ddbMock.commandCalls(DeleteCommand)[0]!.args[0].input;
      expect(deleteInput.Key?.pk).toBe('COOLDOWN#api.example.com');
      expect(deleteInput.Key?.sk).toBe('COOLDOWN#api.example.com');
    });

    it('should return undefined when no cooldown item exists', async () => {
      ddbMock.on(GetCommand).resolvesOnce({});

      const result = await store.getCooldown('api.example.com');
      expect(result).toBeUndefined();
    });

    it('should delete cooldown item with COOLDOWN# key on clearCooldown', async () => {
      ddbMock.on(DeleteCommand).resolvesOnce({});

      await store.clearCooldown('api.example.com');

      const deleteInput = ddbMock.commandCalls(DeleteCommand)[0]!.args[0].input;
      expect(deleteInput.Key?.pk).toBe('COOLDOWN#api.example.com');
      expect(deleteInput.Key?.sk).toBe('COOLDOWN#api.example.com');
    });

    it('should throw a clear error when setCooldown fails with ResourceNotFoundException', async () => {
      ddbMock.on(PutCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(
        store.setCooldown('api.example.com', Date.now() + 30_000),
      ).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });

    it('should throw a clear error when getCooldown fails with ResourceNotFoundException', async () => {
      ddbMock.on(GetCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.getCooldown('api.example.com')).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });

    it('should throw a clear error when clearCooldown fails with ResourceNotFoundException', async () => {
      ddbMock.on(DeleteCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.clearCooldown('api.example.com')).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });
  });

  describe('clear includes COOLDOWN# prefix', () => {
    it('should include COOLDOWN# prefix in scan filter on clear', async () => {
      ddbMock.on(ScanCommand).resolvesOnce({ Items: [] });
      await store.clear();

      const scanInput = ddbMock.commandCalls(ScanCommand)[0]!.args[0].input;
      expect(scanInput.FilterExpression).toContain(
        'begins_with(pk, :cooldownPrefix)',
      );
      expect(scanInput.ExpressionAttributeValues?.[':cooldownPrefix']).toBe(
        'COOLDOWN#',
      );
    });

    it('should delete cooldown items along with rate limit items on clear', async () => {
      ddbMock.on(ScanCommand).resolvesOnce({
        Items: [
          { pk: 'RATELIMIT#r1', sk: 'TS#1#u1' },
          { pk: 'COOLDOWN#api.example.com', sk: 'COOLDOWN#api.example.com' },
          { pk: 'RATELIMIT_SLOT#r1', sk: 'SLOT#0' },
        ],
      });
      ddbMock.on(BatchWriteCommand).resolvesOnce({});

      await store.clear();
      expect(ddbMock).toHaveReceivedCommandTimes(BatchWriteCommand, 1);
    });
  });

  describe('error handling for private helpers', () => {
    it('should throw a clear error when countRequestsInWindow (getStatus) fails with ResourceNotFoundException', async () => {
      ddbMock.on(QueryCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.getStatus('test-resource')).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });

    it('should throw a clear error when hasCapacityInWindow (canProceed) fails with ResourceNotFoundException', async () => {
      ddbMock.on(QueryCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.canProceed('test-resource')).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });
  });

  describe('input validation', () => {
    it('should reject empty resource values', async () => {
      await expect(store.canProceed('')).rejects.toThrow(
        'resource must not be empty',
      );
      await expect(store.record('')).rejects.toThrow(
        'resource must not be empty',
      );
      expect(() =>
        store.setResourceConfig('', { limit: 1, windowMs: 1000 }),
      ).toThrow('resource must not be empty');
    });

    it('should reject oversized resource values', async () => {
      const oversizedResource = 'x'.repeat(513);
      await expect(store.acquire(oversizedResource)).rejects.toThrow(
        'resource exceeds maximum length',
      );
    });
  });
});
