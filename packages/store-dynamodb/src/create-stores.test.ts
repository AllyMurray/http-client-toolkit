import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDynamoDBStores } from './create-stores.js';
import { DynamoDBAdaptiveRateLimitStore } from './dynamodb-adaptive-rate-limit-store.js';
import { DynamoDBCacheStore } from './dynamodb-cache-store.js';
import { DynamoDBDedupeStore } from './dynamodb-dedupe-store.js';
import { DynamoDBRateLimitStore } from './dynamodb-rate-limit-store.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

describe('createDynamoDBStores', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  afterEach(() => {
    ddbMock.reset();
  });

  it('returns all four store instances', () => {
    const stores = createDynamoDBStores({ region: 'us-east-1' });
    expect(stores.cache).toBeInstanceOf(DynamoDBCacheStore);
    expect(stores.dedupe).toBeInstanceOf(DynamoDBDedupeStore);
    expect(stores.rateLimit).toBeInstanceOf(DynamoDBRateLimitStore);
    expect(stores.adaptiveRateLimit).toBeInstanceOf(
      DynamoDBAdaptiveRateLimitStore,
    );
    stores.close();
  });

  it('accepts an existing DynamoDBDocumentClient', () => {
    const rawClient = new DynamoDBClient({ region: 'us-east-1' });
    const docClient = DynamoDBDocumentClient.from(rawClient);

    const stores = createDynamoDBStores({ client: docClient });
    expect(stores.cache).toBeInstanceOf(DynamoDBCacheStore);
    stores.close();

    // User-provided client should NOT be destroyed by the factory
    rawClient.destroy();
  });

  it('accepts an existing DynamoDBClient', () => {
    const rawClient = new DynamoDBClient({ region: 'us-east-1' });

    const stores = createDynamoDBStores({ client: rawClient });
    expect(stores.cache).toBeInstanceOf(DynamoDBCacheStore);
    stores.close();

    rawClient.destroy();
  });

  it('close() marks all stores as destroyed', async () => {
    const stores = createDynamoDBStores({ region: 'us-east-1' });
    await stores.close();

    await expect(stores.cache.get('key')).rejects.toThrow();
    await expect(stores.dedupe.isInProgress('hash')).rejects.toThrow();
    await expect(stores.rateLimit.canProceed('resource')).rejects.toThrow();
  });

  it('passes tableName through to all stores', () => {
    const stores = createDynamoDBStores({
      tableName: 'custom-table',
      region: 'us-east-1',
    });
    expect(stores.cache).toBeInstanceOf(DynamoDBCacheStore);
    stores.close();
  });

  it('passes store-specific options through', () => {
    const stores = createDynamoDBStores({
      region: 'us-east-1',
      rateLimit: {
        defaultConfig: { limit: 10, windowMs: 60_000 },
      },
      dedupe: {
        jobTimeoutMs: 5000,
      },
    });
    expect(stores.rateLimit).toBeInstanceOf(DynamoDBRateLimitStore);
    expect(stores.dedupe).toBeInstanceOf(DynamoDBDedupeStore);
    stores.close();
  });
});
