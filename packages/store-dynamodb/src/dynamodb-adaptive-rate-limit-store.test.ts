import {
  DynamoDBClient,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DynamoDBAdaptiveRateLimitStore } from './dynamodb-adaptive-rate-limit-store.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('DynamoDBAdaptiveRateLimitStore', () => {
  let store: DynamoDBAdaptiveRateLimitStore;
  const defaultConfig = { limit: 200, windowMs: 3600000 };

  beforeEach(() => {
    ddbMock.reset();
    store = new DynamoDBAdaptiveRateLimitStore({
      client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
      defaultConfig,
      adaptiveConfig: {
        monitoringWindowMs: 1000,
        highActivityThreshold: 5,
        moderateActivityThreshold: 2,
        recalculationIntervalMs: 100,
        sustainedInactivityThresholdMs: 2000,
        backgroundPauseOnIncreasingTrend: true,
        maxUserScaling: 2.0,
        minUserReserved: 10,
      },
    });
  });

  afterEach(async () => {
    await store.close();
  });

  describe('basic adaptive operations', () => {
    it('should allow user requests with initial state allocation', async () => {
      // ensureActivityMetrics: user query, background query
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: [] }) // user activity
        .resolvesOnce({ Items: [] }) // background activity
        .resolvesOnce({ Count: 0 }) // getCurrentUsage for user
        .resolvesOnce({ Count: 0 }); // getCurrentUsage for background

      const canProceed = await store.canProceed('test-resource', 'user');
      expect(canProceed).toBe(true);
    });

    it('should allow background requests with initial state allocation', async () => {
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: [] })
        .resolvesOnce({ Items: [] })
        .resolvesOnce({ Count: 0 })
        .resolvesOnce({ Count: 0 });

      const canProceed = await store.canProceed('test-resource', 'background');
      expect(canProceed).toBe(true);
    });

    it('should record user requests with GSI keys', async () => {
      // PutCommand only — record() does not call ensureActivityMetrics
      ddbMock.on(PutCommand).resolvesOnce({});

      await store.record('test-resource', 'user');

      const putInput = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
      expect(putInput.Item?.pk).toBe('RATELIMIT#test-resource');
      expect(putInput.Item?.gsi1pk).toBe('RATELIMIT#test-resource#user');
      expect(putInput.Item?.priority).toBe('user');
    });

    it('should record background requests with GSI keys', async () => {
      ddbMock.on(PutCommand).resolvesOnce({});

      await store.record('test-resource', 'background');

      const putInput = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
      expect(putInput.Item?.gsi1pk).toBe('RATELIMIT#test-resource#background');
      expect(putInput.Item?.priority).toBe('background');
    });

    it('should throw a clear error when the table is missing', async () => {
      ddbMock.on(PutCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.record('missing-table', 'user')).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });

    it('should retry acquire on structured conditional transaction cancellation', async () => {
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: [] })
        .resolvesOnce({ Items: [] });

      const conditionalCancelError = new Error('Transaction cancelled');
      conditionalCancelError.name = 'TransactionCanceledException';
      (
        conditionalCancelError as unknown as { cancellationReasons: unknown }
      ).cancellationReasons = [{ Code: 'ConditionalCheckFailed' }];

      ddbMock
        .on(TransactWriteCommand)
        .rejectsOnce(conditionalCancelError)
        .resolvesOnce({});

      const acquired = await store.acquire('retry-resource', 'background');
      expect(acquired).toBe(true);
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(2);
    });
  });

  describe('adaptive capacity allocation', () => {
    it('should start with initial state allocation', async () => {
      // ensureActivityMetrics
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: [] })
        .resolvesOnce({ Items: [] })
        // getCurrentUsage (user + background)
        .resolvesOnce({ Count: 0 })
        .resolvesOnce({ Count: 0 });

      const status = await store.getStatus('test-resource');
      expect(status.adaptive?.userReserved).toBe(60); // 30% of 200
      expect(status.adaptive?.backgroundMax).toBe(140); // 200 - 60
      expect(status.adaptive?.backgroundPaused).toBe(false);
      expect(status.adaptive?.reason).toContain('Initial state');
    });

    it('should block background requests when capacity is exhausted', async () => {
      // Record a background request to populate in-memory metrics
      ddbMock.on(PutCommand).resolvesOnce({});
      await store.record('test-resource', 'background');

      // Force recalculation interval
      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.delete('test-resource');

      // canProceed calls:
      // With 0 user activity and some background activity, calculator gives
      // "No user activity yet" strategy: userReserved=minUserReserved=10, backgroundMax=190
      ddbMock.on(QueryCommand).resolvesOnce({ Count: 190 }); // background at max (190)

      const canProceed = await store.canProceed('test-resource', 'background');
      expect(canProceed).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should provide adaptive status information', async () => {
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: [] })
        .resolvesOnce({ Items: [] })
        .resolvesOnce({ Count: 0 })
        .resolvesOnce({ Count: 0 });

      const status = await store.getStatus('test-resource');
      expect(status).toHaveProperty('remaining');
      expect(status).toHaveProperty('resetTime');
      expect(status).toHaveProperty('limit');
      expect(status).toHaveProperty('adaptive');
      expect(status.adaptive).toHaveProperty('userReserved');
      expect(status.adaptive).toHaveProperty('backgroundMax');
      expect(status.adaptive).toHaveProperty('backgroundPaused');
      expect(status.adaptive).toHaveProperty('recentUserActivity');
      expect(status.adaptive).toHaveProperty('reason');
    });
  });

  describe('getWaitTime', () => {
    it('should return window time when limit is zero', async () => {
      store.setResourceConfig('zero-limit', { limit: 0, windowMs: 3210 });
      await expect(store.getWaitTime('zero-limit')).resolves.toBe(3210);
    });

    it('should return zero when request can proceed', async () => {
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: [] })
        .resolvesOnce({ Items: [] })
        .resolvesOnce({ Count: 0 })
        .resolvesOnce({ Count: 0 });

      const waitTime = await store.getWaitTime('fresh-resource', 'user');
      expect(waitTime).toBe(0);
    });

    it('should return recalculation interval when background is paused', async () => {
      // Set up high user activity to trigger pause
      const metrics = {
        recentUserRequests: Array.from({ length: 10 }, () => Date.now()),
        recentBackgroundRequests: [] as Array<number>,
        userActivityTrend: 'increasing' as const,
      };
      (
        store as unknown as {
          activityMetrics: Map<string, typeof metrics>;
        }
      ).activityMetrics.set('paused-resource', metrics);

      // Force recalculation
      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.delete('paused-resource');

      // canProceed calls
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Count: 0 }) // user
        .resolvesOnce({ Count: 999 }); // background

      const waitTime = await store.getWaitTime('paused-resource', 'background');
      expect(waitTime).toBe(100); // recalculationIntervalMs
    });

    it('should compute wait time from oldest request via GSI', async () => {
      const now = Date.now();

      // Set up metrics so canProceed fails for background
      const metrics = {
        recentUserRequests: [] as Array<number>,
        recentBackgroundRequests: [now - 500],
        userActivityTrend: 'none' as const,
      };
      (
        store as unknown as {
          activityMetrics: Map<string, typeof metrics>;
        }
      ).activityMetrics.set('gsi-resource', metrics);

      store.setResourceConfig('gsi-resource', { limit: 50, windowMs: 5000 });
      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.delete('gsi-resource');

      // canProceed: getCurrentUsage(user) + getCurrentUsage(background)
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Count: 40 }) // background at max for this config
        // GSI query for oldest
        .resolvesOnce({
          Items: [
            {
              pk: 'RATELIMIT#gsi-resource',
              sk: `TS#${now - 500}#uuid`,
              timestamp: now - 500,
            },
          ],
        });

      const waitTime = await store.getWaitTime('gsi-resource', 'background');
      expect(waitTime).toBeGreaterThan(0);
      expect(waitTime).toBeLessThanOrEqual(5000);
    });

    it('should return zero when GSI query returns no items', async () => {
      const metrics = {
        recentUserRequests: [] as Array<number>,
        recentBackgroundRequests: [Date.now()],
        userActivityTrend: 'none' as const,
      };
      (
        store as unknown as {
          activityMetrics: Map<string, typeof metrics>;
        }
      ).activityMetrics.set('empty-gsi', metrics);

      store.setResourceConfig('empty-gsi', { limit: 2, windowMs: 5000 });
      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.delete('empty-gsi');

      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Count: 0 })
        .resolvesOnce({ Count: 140 })
        .resolvesOnce({ Items: [] }); // No oldest

      const waitTime = await store.getWaitTime('empty-gsi', 'background');
      expect(waitTime).toBe(0);
    });

    it('should return zero when oldest timestamp is undefined', async () => {
      // With limit=2 and "No user activity yet" strategy, backgroundMax = 2-10 = -8 <= 0,
      // so canProceed returns false without querying. Then backgroundPaused is false,
      // so the code goes directly to the GSI query for oldest request.
      const metrics = {
        recentUserRequests: [] as Array<number>,
        recentBackgroundRequests: [Date.now()],
        userActivityTrend: 'none' as const,
      };
      (
        store as unknown as {
          activityMetrics: Map<string, typeof metrics>;
        }
      ).activityMetrics.set('no-ts', metrics);

      store.setResourceConfig('no-ts', { limit: 2, windowMs: 5000 });
      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.delete('no-ts');

      // Only the GSI query for oldest is needed — item exists but has no timestamp field
      ddbMock.on(QueryCommand).resolvesOnce({
        Items: [{ pk: 'RATELIMIT#no-ts', sk: 'TS#1#uuid' }],
      });

      const waitTime = await store.getWaitTime('no-ts', 'background');
      expect(waitTime).toBe(0);
    });
  });

  describe('reset', () => {
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

    it('should handle query returning undefined Items during reset', async () => {
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({})
        .resolvesOnce({})
        .resolvesOnce({});

      await store.reset('test');
      expect(ddbMock).not.toHaveReceivedCommand(BatchWriteCommand);
    });

    it('should successfully delete items found during reset', async () => {
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({
          Items: [{ pk: 'RATELIMIT#test', sk: 'TS#123#uuid1' }],
        })
        .resolvesOnce({ Items: [] })
        .resolvesOnce({ Items: [] });
      ddbMock.on(BatchWriteCommand).resolvesOnce({});

      await store.reset('test');
      expect(ddbMock).toHaveReceivedCommand(BatchWriteCommand);
    });

    it('should clear database and in-memory state', async () => {
      // Set up some in-memory state
      (
        store as unknown as {
          activityMetrics: Map<string, unknown>;
          cachedCapacity: Map<string, unknown>;
          lastCapacityUpdate: Map<string, number>;
        }
      ).activityMetrics.set('reset-resource', {});
      (
        store as unknown as { cachedCapacity: Map<string, unknown> }
      ).cachedCapacity.set('reset-resource', {});
      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.set('reset-resource', Date.now());

      // Query for each partition key (RATELIMIT#, RATELIMIT_SLOT#user, RATELIMIT_SLOT#background)
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: [] })
        .resolvesOnce({ Items: [] })
        .resolvesOnce({ Items: [] });

      await store.reset('reset-resource');

      expect(
        (
          store as unknown as { activityMetrics: Map<string, unknown> }
        ).activityMetrics.has('reset-resource'),
      ).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all items and in-memory state', async () => {
      ddbMock.on(ScanCommand).resolvesOnce({ Items: [] });
      await store.clear();

      expect(
        (store as unknown as { activityMetrics: Map<string, unknown> })
          .activityMetrics.size,
      ).toBe(0);
    });

    it('should handle scan returning undefined Items', async () => {
      ddbMock.on(ScanCommand).resolvesOnce({});
      await store.clear();
      expect(ddbMock).not.toHaveReceivedCommand(BatchWriteCommand);
    });
  });

  describe('resource configuration', () => {
    it('should support per-resource rate limits', async () => {
      store.setResourceConfig('custom', { limit: 100, windowMs: 1800000 });

      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: [] })
        .resolvesOnce({ Items: [] })
        .resolvesOnce({ Count: 0 })
        .resolvesOnce({ Count: 0 });

      const status = await store.getStatus('custom');
      expect(status.limit).toBe(100);
    });

    it('should return configured resource config', () => {
      store.setResourceConfig('cfg', { limit: 77, windowMs: 1234 });
      expect(store.getResourceConfig('cfg')).toEqual({
        limit: 77,
        windowMs: 1234,
      });
    });

    it('should return default config for unknown resource', () => {
      expect(store.getResourceConfig('unknown')).toEqual(defaultConfig);
    });
  });

  describe('cached capacity', () => {
    it('should use cached capacity within recalculation interval', async () => {
      // First call populates cache
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: [] })
        .resolvesOnce({ Items: [] })
        .resolvesOnce({ Count: 0 })
        .resolvesOnce({ Count: 0 })
        // Second call should use cached value
        .resolvesOnce({ Count: 0 })
        .resolvesOnce({ Count: 0 });

      await store.getStatus('cached-resource');
      const status = await store.getStatus('cached-resource');
      expect(status.adaptive?.reason).toContain('Initial state');
    });

    it('should fall back to default capacity when no cache exists', () => {
      const privateStore = store as unknown as {
        lastCapacityUpdate: Map<string, number>;
        calculateCurrentCapacity: (
          resource: string,
          metrics: {
            recentUserRequests: Array<number>;
            recentBackgroundRequests: Array<number>;
            userActivityTrend: 'none';
          },
        ) => { reason: string };
      };

      privateStore.lastCapacityUpdate.set('default-cap', Date.now());
      const result = privateStore.calculateCurrentCapacity('default-cap', {
        recentUserRequests: [],
        recentBackgroundRequests: [],
        userActivityTrend: 'none',
      });

      expect(result.reason).toContain('Default capacity allocation');
    });

    it('should preserve full capacity for tiny limits in default fallback', () => {
      store.setResourceConfig('tiny-limit', { limit: 1, windowMs: 1000 });

      const privateStore = store as unknown as {
        getDefaultCapacity: (resource: string) => {
          userReserved: number;
          backgroundMax: number;
        };
      };

      const result = privateStore.getDefaultCapacity('tiny-limit');
      expect(result.userReserved + result.backgroundMax).toBe(1);
      expect(result.backgroundMax).toBe(1);
    });
  });

  describe('client management', () => {
    it('should accept raw DynamoDBClient', () => {
      const rawClient = new DynamoDBClient({ region: 'us-east-1' });
      const s = new DynamoDBAdaptiveRateLimitStore({ client: rawClient });
      expect(s).toBeDefined();
      s.destroy();
    });

    it('should create client internally when none provided', () => {
      const s = new DynamoDBAdaptiveRateLimitStore({ region: 'us-west-2' });
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
      await store.close();
      await expect(store.canProceed('test')).rejects.toThrow();
      await expect(store.record('test')).rejects.toThrow();
      await expect(store.getStatus('test')).rejects.toThrow();
      await expect(store.reset('test')).rejects.toThrow();
      await expect(store.getWaitTime('test')).rejects.toThrow();
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
          { pk: 'RATELIMIT_SLOT#r1#user', sk: 'SLOT#0' },
        ],
      });
      ddbMock.on(BatchWriteCommand).resolvesOnce({});

      await store.clear();
      expect(ddbMock).toHaveReceivedCommandTimes(BatchWriteCommand, 1);
    });
  });

  describe('input validation', () => {
    it('should reject empty resource values', async () => {
      await expect(store.canProceed('')).rejects.toThrow(
        'resource must not be empty',
      );
      await expect(store.record('', 'user')).rejects.toThrow(
        'resource must not be empty',
      );
      expect(() => store.getResourceConfig('')).toThrow(
        'resource must not be empty',
      );
    });

    it('should reject oversized resource values', async () => {
      const oversizedResource = 'x'.repeat(513);
      await expect(store.acquire(oversizedResource)).rejects.toThrow(
        'resource exceeds maximum length',
      );
    });
  });

  describe('ensureActivityMetrics', () => {
    it('should load metrics from GSI on first access', async () => {
      const now = Date.now();
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({
          Items: [{ timestamp: now - 100 }, { timestamp: now - 200 }],
        }) // user activity
        .resolvesOnce({
          Items: [{ timestamp: now - 300 }],
        }) // background activity
        // Trigger ensureActivityMetrics
        .resolvesOnce({ Count: 0 })
        .resolvesOnce({ Count: 0 });

      const status = await store.getStatus('loaded-resource');
      expect(status.adaptive?.recentUserActivity).toBe(2);
    });

    it('should skip loading if metrics already exist', async () => {
      // Pre-populate metrics
      (
        store as unknown as {
          activityMetrics: Map<
            string,
            {
              recentUserRequests: Array<number>;
              recentBackgroundRequests: Array<number>;
              userActivityTrend: string;
            }
          >;
        }
      ).activityMetrics.set('preloaded', {
        recentUserRequests: [Date.now()],
        recentBackgroundRequests: [],
        userActivityTrend: 'none',
      });

      // Only getCurrentUsage calls, no ensureActivityMetrics queries
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Count: 0 })
        .resolvesOnce({ Count: 0 });

      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.delete('preloaded');

      const status = await store.getStatus('preloaded');
      expect(status.adaptive?.recentUserActivity).toBe(1);
      // Should only have 2 calls (getCurrentUsage x2), not 4
      expect(ddbMock.calls()).toHaveLength(2);
    });

    it('should handle empty Items arrays from GSI', async () => {
      ddbMock
        .on(QueryCommand)
        .resolvesOnce({}) // user: no Items field
        .resolvesOnce({}) // background: no Items field
        .resolvesOnce({ Count: 0 })
        .resolvesOnce({ Count: 0 });

      const status = await store.getStatus('empty-metrics');
      expect(status.adaptive?.recentUserActivity).toBe(0);
    });

    it('should cap loaded metrics history to bounded size', async () => {
      const now = Date.now();
      const userItems = Array.from({ length: 120 }, (_, i) => ({
        timestamp: now - i,
      }));

      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: userItems })
        .resolvesOnce({ Items: [] })
        .resolvesOnce({ Count: 0 })
        .resolvesOnce({ Count: 0 });

      await store.getStatus('capped-metrics');

      const metrics = (
        store as unknown as {
          activityMetrics: Map<
            string,
            {
              recentUserRequests: Array<number>;
              recentBackgroundRequests: Array<number>;
            }
          >;
        }
      ).activityMetrics.get('capped-metrics');

      expect(metrics?.recentUserRequests.length).toBe(100);
      expect(metrics?.recentBackgroundRequests.length).toBe(0);
    });

    it('should splice old requests from the front when some are expired (cleanupOldRequests idx > 0)', async () => {
      const now = Date.now();
      // monitoringWindowMs = 1000, so cutoff = now - 1000
      // Include some timestamps older than cutoff and some newer
      const loadedItems = [
        { timestamp: now - 5000 }, // old (before cutoff)
        { timestamp: now - 3000 }, // old (before cutoff)
        { timestamp: now - 100 }, // recent (after cutoff)
        { timestamp: now - 50 }, // recent (after cutoff)
      ];

      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: loadedItems }) // user activity
        .resolvesOnce({ Items: [] }) // background activity
        .resolvesOnce({ Count: 0 })
        .resolvesOnce({ Count: 0 });

      const status = await store.getStatus('splice-resource');
      expect(status.adaptive?.recentUserActivity).toBe(2);

      const metrics = (
        store as unknown as {
          activityMetrics: Map<string, { recentUserRequests: Array<number> }>;
        }
      ).activityMetrics.get('splice-resource');

      // The two old requests should be spliced off, leaving only the 2 recent ones
      expect(metrics?.recentUserRequests.length).toBe(2);
      expect(metrics?.recentUserRequests[0]).toBe(now - 100);
      expect(metrics?.recentUserRequests[1]).toBe(now - 50);
    });

    it('should throw a clear error when ensureActivityMetrics query fails with ResourceNotFoundException', async () => {
      ddbMock.on(QueryCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.getStatus('missing-table-res')).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });
  });

  describe('error handling in catch blocks', () => {
    it('should throw table-missing error from setCooldown', async () => {
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

    it('should throw table-missing error from getCooldown', async () => {
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

    it('should throw table-missing error from clearCooldown', async () => {
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

    it('should throw table-missing error from canProceed (hasPriorityCapacityInWindow)', async () => {
      // Set up in-memory metrics so ensureActivityMetrics is skipped
      (
        store as unknown as {
          activityMetrics: Map<
            string,
            {
              recentUserRequests: Array<number>;
              recentBackgroundRequests: Array<number>;
              userActivityTrend: string;
            }
          >;
        }
      ).activityMetrics.set('err-resource', {
        recentUserRequests: [],
        recentBackgroundRequests: [],
        userActivityTrend: 'none',
      });

      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.delete('err-resource');

      ddbMock.on(QueryCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(
        store.canProceed('err-resource', 'background'),
      ).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });

    it('should throw table-missing error from getStatus (getCurrentUsage)', async () => {
      // Pre-populate metrics to skip ensureActivityMetrics
      (
        store as unknown as {
          activityMetrics: Map<
            string,
            {
              recentUserRequests: Array<number>;
              recentBackgroundRequests: Array<number>;
              userActivityTrend: string;
            }
          >;
        }
      ).activityMetrics.set('err-status', {
        recentUserRequests: [],
        recentBackgroundRequests: [],
        userActivityTrend: 'none',
      });

      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.delete('err-status');

      // getCurrentUsage user query fails
      ddbMock.on(QueryCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.getStatus('err-status')).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });

    it('should throw table-missing error from getWaitTime GSI query', async () => {
      // Set up metrics so canProceed returns false for background.
      // With limit=2, "No user activity yet" strategy gives backgroundMax = 2-10 = -8 <= 0,
      // so canProceed returns false without querying. Then getWaitTime checks backgroundPaused
      // (false) and proceeds to the GSI query for the oldest request.
      const metrics = {
        recentUserRequests: [] as Array<number>,
        recentBackgroundRequests: [Date.now()],
        userActivityTrend: 'none' as const,
      };
      (
        store as unknown as {
          activityMetrics: Map<string, typeof metrics>;
        }
      ).activityMetrics.set('err-wait', metrics);

      store.setResourceConfig('err-wait', { limit: 2, windowMs: 5000 });
      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.delete('err-wait');

      // canProceed returns false without querying (backgroundMax <= 0).
      // The GSI query for oldest request throws ResourceNotFoundException.
      ddbMock.on(QueryCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.getWaitTime('err-wait', 'background')).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });

    it('should throw table-missing error from clear (scan)', async () => {
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

    it('should throw table-missing error from clear (batchDelete)', async () => {
      ddbMock.on(ScanCommand).resolvesOnce({
        Items: [{ pk: 'RATELIMIT#res', sk: 'TS#1#u1' }],
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

    it('should re-throw non-table-missing errors from acquire', async () => {
      // Set up in-memory metrics to skip ensureActivityMetrics
      (
        store as unknown as {
          activityMetrics: Map<
            string,
            {
              recentUserRequests: Array<number>;
              recentBackgroundRequests: Array<number>;
              userActivityTrend: string;
            }
          >;
        }
      ).activityMetrics.set('err-acquire', {
        recentUserRequests: [],
        recentBackgroundRequests: [],
        userActivityTrend: 'none',
      });

      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.delete('err-acquire');

      // TransactWriteCommand throws a generic error (not conditional, not table-missing)
      const genericError = new Error('Some DynamoDB error');
      ddbMock.on(TransactWriteCommand).rejectsOnce(genericError);

      await expect(store.acquire('err-acquire', 'background')).rejects.toThrow(
        'Some DynamoDB error',
      );
    });

    it('should throw table-missing error from record', async () => {
      ddbMock.on(PutCommand).rejectsOnce(
        new ResourceNotFoundException({
          message: 'Requested resource not found',
          $metadata: {},
        }),
      );

      await expect(store.record('res', 'user')).rejects.toThrow(
        'was not found. Create the table using your infrastructure',
      );
    });
  });

  describe('canProceed and acquire edge cases', () => {
    it('should return false for user priority when userReserved is 0 (sustained inactivity)', async () => {
      // Simulate sustained inactivity: user requests exist but are old
      const now = Date.now();
      const oldTimestamp = now - 10_000; // 10 seconds ago, beyond sustainedInactivityThresholdMs of 2000ms

      const metrics = {
        recentUserRequests: [oldTimestamp],
        recentBackgroundRequests: [] as Array<number>,
        userActivityTrend: 'none' as const,
      };
      (
        store as unknown as {
          activityMetrics: Map<string, typeof metrics>;
        }
      ).activityMetrics.set('inactive-resource', metrics);

      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.delete('inactive-resource');

      // userReserved should be 0 due to sustained zero activity
      const canProceed = await store.canProceed('inactive-resource', 'user');
      expect(canProceed).toBe(false);
    });

    it('should return false from acquire when background is paused', async () => {
      // Set up high user activity with increasing trend to trigger backgroundPaused
      const now = Date.now();
      const metrics = {
        recentUserRequests: Array.from({ length: 10 }, (_, i) => now - i),
        recentBackgroundRequests: [] as Array<number>,
        userActivityTrend: 'increasing' as const,
      };
      (
        store as unknown as {
          activityMetrics: Map<string, typeof metrics>;
        }
      ).activityMetrics.set('paused-acquire', metrics);

      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.delete('paused-acquire');

      const acquired = await store.acquire('paused-acquire', 'background');
      expect(acquired).toBe(false);
    });

    it('should return false from acquire when limitForPriority is 0', async () => {
      // Simulate sustained inactivity -> userReserved = 0
      const now = Date.now();
      const oldTimestamp = now - 10_000;

      const metrics = {
        recentUserRequests: [oldTimestamp],
        recentBackgroundRequests: [] as Array<number>,
        userActivityTrend: 'none' as const,
      };
      (
        store as unknown as {
          activityMetrics: Map<string, typeof metrics>;
        }
      ).activityMetrics.set('zero-limit-acquire', metrics);

      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.delete('zero-limit-acquire');

      const acquired = await store.acquire('zero-limit-acquire', 'user');
      expect(acquired).toBe(false);
    });

    it('should throw on acquire after destroy', async () => {
      await store.close();
      await expect(store.acquire('test')).rejects.toThrow(
        'Rate limit store has been destroyed',
      );
    });
  });

  describe('acquire slot exhaustion and user priority path', () => {
    it('should push to recentUserRequests when acquire succeeds with user priority', async () => {
      // Set up in-memory metrics
      (
        store as unknown as {
          activityMetrics: Map<
            string,
            {
              recentUserRequests: Array<number>;
              recentBackgroundRequests: Array<number>;
              userActivityTrend: string;
            }
          >;
        }
      ).activityMetrics.set('user-acquire', {
        recentUserRequests: [],
        recentBackgroundRequests: [],
        userActivityTrend: 'none',
      });

      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.delete('user-acquire');

      ddbMock.on(TransactWriteCommand).resolvesOnce({});

      const acquired = await store.acquire('user-acquire', 'user');
      expect(acquired).toBe(true);

      // Verify recentUserRequests was populated
      const metrics = (
        store as unknown as {
          activityMetrics: Map<string, { recentUserRequests: Array<number> }>;
        }
      ).activityMetrics.get('user-acquire');
      expect(metrics?.recentUserRequests.length).toBe(1);
    });

    it('should return false when all acquire slots are exhausted', async () => {
      // Use a small limit resource so there are fewer slots to exhaust
      store.setResourceConfig('exhausted', { limit: 2, windowMs: 5000 });

      // Pre-populate metrics to skip ensureActivityMetrics
      (
        store as unknown as {
          activityMetrics: Map<
            string,
            {
              recentUserRequests: Array<number>;
              recentBackgroundRequests: Array<number>;
              userActivityTrend: string;
            }
          >;
        }
      ).activityMetrics.set('exhausted', {
        recentUserRequests: [],
        recentBackgroundRequests: [Date.now()],
        userActivityTrend: 'none',
      });

      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.delete('exhausted');

      // "No user activity yet" strategy: userReserved=10 (minUserReserved), backgroundMax=limit-10
      // But limit is 2, so backgroundMax = max(0, 2-10) => This won't work.
      // Actually with limit=2: userReserved=min(10,limit)? Let's check the calculator...
      // userReserved=10, backgroundMax=2-10=-8. But getDefaultCapacity does max(0,...).
      // Actually calculateDynamicCapacity does NOT clamp. So backgroundMax could be negative.
      // But in acquire: limitForPriority = capacity.backgroundMax which could be -8, so <= 0 -> returns false.
      // That's line 161, not 239. We need all slots to fail conditionally.

      // Let's use a store with limit that gives a small positive backgroundMax
      // With defaultConfig limit=200, "no user activity yet" gives userReserved=10, backgroundMax=190
      // We need all 190 conditional checks to fail. That's too many.
      // Instead, let's use a custom resource with very small limit and ensure the strategy
      // gives a small positive limit.
      // With limit=2, initial state: userReserved=max(floor(2*0.3)=0, 10)=10, backgroundMax=2-10=-8 -> 0 check, won't loop.

      // Let's go with limit=3 and moderate activity to get a small backgroundMax.
      // Actually, the simplest approach: use user priority and construct a scenario where
      // userReserved is small (like 1 or 2) and all conditional writes fail.

      // New approach: small limit, moderate activity
      store.setResourceConfig('exhausted', { limit: 12, windowMs: 5000 });

      const now = Date.now();
      (
        store as unknown as {
          activityMetrics: Map<
            string,
            {
              recentUserRequests: Array<number>;
              recentBackgroundRequests: Array<number>;
              userActivityTrend: string;
            }
          >;
        }
      ).activityMetrics.set('exhausted', {
        recentUserRequests: [now - 100, now - 200, now - 300], // 3 = moderate activity
        recentBackgroundRequests: [],
        userActivityTrend: 'stable',
      });

      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.delete('exhausted');

      // Moderate activity with 3 requests, limit=12:
      // baseUserCapacity = floor(12*0.4) = 4
      // userMultiplier = min(2.0, 1 + 3/5) = 1.6
      // dynamicUserCapacity = min(12*0.7=8.4, 4*1.6=6.4) = 6 (floored from 6.4)
      // backgroundMax = 12 - 6 = 6 (for user, we look at userReserved = 6)

      // For user priority, all 6 slots fail with conditional check
      const conditionalCancelError = new Error('Transaction cancelled');
      conditionalCancelError.name = 'TransactionCanceledException';
      (
        conditionalCancelError as unknown as { cancellationReasons: unknown }
      ).cancellationReasons = [{ Code: 'ConditionalCheckFailed' }];

      // Make all slot attempts fail with conditional check
      ddbMock.on(TransactWriteCommand).rejects(conditionalCancelError);

      const acquired = await store.acquire('exhausted', 'user');
      expect(acquired).toBe(false);
    });
  });

  describe('cleanupOldRequests - all requests expired', () => {
    it('should clear all requests when every timestamp is older than the monitoring window', async () => {
      const now = Date.now();
      // monitoringWindowMs is 1000ms, so cutoff = now - 1000
      // All timestamps are older than cutoff
      const oldTimestamps = [now - 5000, now - 4000, now - 3000];

      const metrics = {
        recentUserRequests: [...oldTimestamps],
        recentBackgroundRequests: [...oldTimestamps],
        userActivityTrend: 'none' as const,
      };

      // Access private method through the store
      const privateStore = store as unknown as {
        cleanupOldRequests: (requests: Array<number>) => void;
      };

      privateStore.cleanupOldRequests(metrics.recentUserRequests);
      expect(metrics.recentUserRequests.length).toBe(0);

      privateStore.cleanupOldRequests(metrics.recentBackgroundRequests);
      expect(metrics.recentBackgroundRequests.length).toBe(0);
    });

    it('should clear all requests during ensureActivityMetrics when loaded items are all old', async () => {
      const now = Date.now();
      // All loaded timestamps are older than monitoringWindowMs (1000ms)
      const oldItems = [
        { timestamp: now - 5000 },
        { timestamp: now - 4000 },
        { timestamp: now - 3000 },
      ];

      ddbMock
        .on(QueryCommand)
        .resolvesOnce({ Items: oldItems }) // user activity - all old
        .resolvesOnce({ Items: oldItems }) // background activity - all old
        .resolvesOnce({ Count: 0 })
        .resolvesOnce({ Count: 0 });

      const status = await store.getStatus('old-metrics-resource');
      expect(status.adaptive?.recentUserActivity).toBe(0);

      const metrics = (
        store as unknown as {
          activityMetrics: Map<
            string,
            {
              recentUserRequests: Array<number>;
              recentBackgroundRequests: Array<number>;
            }
          >;
        }
      ).activityMetrics.get('old-metrics-resource');

      expect(metrics?.recentUserRequests.length).toBe(0);
      expect(metrics?.recentBackgroundRequests.length).toBe(0);
    });
  });

  describe('pushRecentRequest overflow trimming', () => {
    it('should trim requests when they exceed maxMetricSamples', async () => {
      // Create a store with a small maxMetricSamples
      // maxMetricSamples = max(100, highActivityThreshold * 20)
      // With highActivityThreshold=5 -> maxMetricSamples = max(100, 100) = 100
      // We need to fill up to 100 and then push more.
      // The pushRecentRequest method pushes, cleans up old, then trims overflow.

      const now = Date.now();
      // Pre-fill recentBackgroundRequests with maxMetricSamples (100) recent timestamps
      const recentTimestamps = Array.from({ length: 100 }, (_, i) => now - i);

      const metrics = {
        recentUserRequests: [] as Array<number>,
        recentBackgroundRequests: recentTimestamps,
        userActivityTrend: 'none' as const,
      };
      (
        store as unknown as {
          activityMetrics: Map<string, typeof metrics>;
        }
      ).activityMetrics.set('overflow-resource', metrics);

      // record() calls pushRecentRequest, which pushes a new timestamp and then trims
      ddbMock.on(PutCommand).resolvesOnce({});
      await store.record('overflow-resource', 'background');

      // After push: 101 items, cleanup removes none (all recent), overflow trims 1
      const updatedMetrics = (
        store as unknown as {
          activityMetrics: Map<
            string,
            { recentBackgroundRequests: Array<number> }
          >;
        }
      ).activityMetrics.get('overflow-resource');

      expect(updatedMetrics?.recentBackgroundRequests.length).toBe(100);
    });

    it('should trim user requests overflow on acquire with user priority', async () => {
      const now = Date.now();
      // Pre-fill recentUserRequests with exactly maxMetricSamples (100) recent timestamps
      const recentTimestamps = Array.from({ length: 100 }, (_, i) => now - i);

      const metrics = {
        recentUserRequests: recentTimestamps,
        recentBackgroundRequests: [] as Array<number>,
        userActivityTrend: 'stable' as const,
      };
      (
        store as unknown as {
          activityMetrics: Map<string, typeof metrics>;
        }
      ).activityMetrics.set('overflow-acquire', metrics);

      (
        store as unknown as { lastCapacityUpdate: Map<string, number> }
      ).lastCapacityUpdate.delete('overflow-acquire');

      ddbMock.on(TransactWriteCommand).resolvesOnce({});

      const acquired = await store.acquire('overflow-acquire', 'user');
      expect(acquired).toBe(true);

      const updatedMetrics = (
        store as unknown as {
          activityMetrics: Map<string, { recentUserRequests: Array<number> }>;
        }
      ).activityMetrics.get('overflow-acquire');

      expect(updatedMetrics?.recentUserRequests.length).toBe(100);
    });
  });
});
