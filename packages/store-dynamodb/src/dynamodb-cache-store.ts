import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  ScanCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { CacheStore } from '@http-client-toolkit/core';
import {
  assertDynamoKeyPart,
  batchDeleteWithRetries,
  queryItemsAllPages,
} from './dynamodb-utils.js';
import { throwIfDynamoTableMissing } from './table-missing-error.js';
import { DEFAULT_TABLE_NAME } from './table.js';

export interface DynamoDBCacheStoreOptions {
  client?: DynamoDBDocumentClient | DynamoDBClient;
  region?: string;
  tableName?: string;
  maxEntrySizeBytes?: number;
}

export class DynamoDBCacheStore<T = unknown> implements CacheStore<T> {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly rawClient: DynamoDBClient | undefined;
  private readonly isClientManaged: boolean;
  private readonly tableName: string;
  private readonly maxEntrySizeBytes: number;
  private isDestroyed = false;

  constructor({
    client,
    region,
    tableName = DEFAULT_TABLE_NAME,
    maxEntrySizeBytes = 390 * 1024,
  }: DynamoDBCacheStoreOptions = {}) {
    this.tableName = tableName;
    this.maxEntrySizeBytes = maxEntrySizeBytes;

    if (client instanceof DynamoDBDocumentClient) {
      this.docClient = client;
      this.isClientManaged = false;
    } else if (client instanceof DynamoDBClient) {
      this.docClient = DynamoDBDocumentClient.from(client);
      this.isClientManaged = false;
    } else {
      const config: DynamoDBClientConfig = {};
      if (region) config.region = region;
      this.rawClient = new DynamoDBClient(config);
      this.docClient = DynamoDBDocumentClient.from(this.rawClient);
      this.isClientManaged = true;
    }
  }

  async get(hash: string): Promise<T | undefined> {
    if (this.isDestroyed) {
      throw new Error('Cache store has been destroyed');
    }

    this.assertValidHash(hash);

    const pk = `CACHE#${hash}`;

    let result;
    try {
      result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { pk, sk: pk },
        }),
      );
    } catch (error: unknown) {
      throwIfDynamoTableMissing(error, this.tableName);
      throw error;
    }

    if (!result.Item) {
      return undefined;
    }

    const now = Math.floor(Date.now() / 1000);
    if (result.Item['ttl'] > 0 && now >= result.Item['ttl']) {
      await this.delete(hash);
      return undefined;
    }

    try {
      const value = result.Item['value'] as string;
      if (value === '__UNDEFINED__') {
        return undefined;
      }
      return JSON.parse(value);
    } catch {
      await this.delete(hash);
      return undefined;
    }
  }

  async set(hash: string, value: T, ttlSeconds: number): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('Cache store has been destroyed');
    }

    this.assertValidHash(hash);

    const now = Date.now();
    const nowEpoch = Math.floor(now / 1000);

    let ttl: number;
    if (ttlSeconds < 0) {
      ttl = nowEpoch;
    } else if (ttlSeconds === 0) {
      ttl = 0;
    } else {
      ttl = nowEpoch + ttlSeconds;
    }

    let serializedValue: string;
    try {
      if (value === undefined) {
        serializedValue = '__UNDEFINED__';
      } else {
        serializedValue = JSON.stringify(value);
      }
    } catch (error) {
      throw new Error(
        `Failed to serialize value: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (Buffer.byteLength(serializedValue, 'utf8') > this.maxEntrySizeBytes) {
      return;
    }

    const pk = `CACHE#${hash}`;

    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk,
            sk: pk,
            value: serializedValue,
            ttl,
            createdAt: now,
          },
        }),
      );
    } catch (error: unknown) {
      throwIfDynamoTableMissing(error, this.tableName);
      throw error;
    }
  }

  async delete(hash: string): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('Cache store has been destroyed');
    }

    this.assertValidHash(hash);

    const pk = `CACHE#${hash}`;

    try {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { pk, sk: pk },
        }),
      );
    } catch (error: unknown) {
      throwIfDynamoTableMissing(error, this.tableName);
      throw error;
    }

    // Clean up any TAG items referencing this hash
    await this.deleteTagsForHash(hash);
  }

  async clear(scope?: string): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('Cache store has been destroyed');
    }

    const cachePrefix = scope ? `CACHE#${scope}` : 'CACHE#';

    // When clearing all (no scope), also delete TAG# items to prevent
    // stale tag mappings from invalidating future cache entries.
    const filterExpression = scope
      ? 'begins_with(pk, :cachePrefix)'
      : 'begins_with(pk, :cachePrefix) OR begins_with(pk, :tagPrefix)';
    const expressionValues: Record<string, string> = {
      ':cachePrefix': cachePrefix,
    };
    if (!scope) {
      expressionValues[':tagPrefix'] = 'TAG#';
    }

    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      let scanResult;
      try {
        scanResult = await this.docClient.send(
          new ScanCommand({
            TableName: this.tableName,
            FilterExpression: filterExpression,
            ExpressionAttributeValues: expressionValues,
            ProjectionExpression: 'pk, sk',
            ExclusiveStartKey: lastEvaluatedKey,
          }),
        );
      } catch (error: unknown) {
        throwIfDynamoTableMissing(error, this.tableName);
        throw error;
      }

      const items = scanResult.Items ?? [];
      if (items.length > 0) {
        try {
          await batchDeleteWithRetries(
            this.docClient,
            this.tableName,
            items.map((item) => ({ pk: item['pk'], sk: item['sk'] })),
          );
        } catch (error: unknown) {
          throwIfDynamoTableMissing(error, this.tableName);
          throw error;
        }
      }

      lastEvaluatedKey = scanResult.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } while (lastEvaluatedKey);
  }

  async setWithTags(
    hash: string,
    value: T,
    ttlSeconds: number,
    tags: Array<string>,
  ): Promise<void> {
    // Write the cache entry using existing set() logic
    await this.set(hash, value, ttlSeconds);

    // Remove any existing tag mappings for this hash before writing new ones
    // to prevent stale tags from persisting across updates.
    await this.deleteTagsForHash(hash);

    if (tags.length === 0) return;

    // Calculate the TTL for tag items to match the cache entry
    const nowEpoch = Math.floor(Date.now() / 1000);
    let tagTtl: number;
    if (ttlSeconds < 0) {
      tagTtl = nowEpoch;
    } else if (ttlSeconds === 0) {
      tagTtl = 0;
    } else {
      tagTtl = nowEpoch + ttlSeconds;
    }

    // Batch write tag items: TAG#{tag} -> CACHE#{hash}
    const tagItems = tags.map((tag) => ({
      PutRequest: {
        Item: {
          pk: `TAG#${tag}`,
          sk: `CACHE#${hash}`,
          ttl: tagTtl,
        },
      },
    }));

    // Write in batches of 25 (DynamoDB limit)
    for (let i = 0; i < tagItems.length; i += 25) {
      const batch = tagItems.slice(i, i + 25);
      try {
        await this.docClient.send(
          new BatchWriteCommand({
            RequestItems: {
              [this.tableName]: batch,
            },
          }),
        );
      } catch (error: unknown) {
        throwIfDynamoTableMissing(error, this.tableName);
        throw error;
      }
    }
  }

  async invalidateByTag(tag: string): Promise<number> {
    if (this.isDestroyed) {
      throw new Error('Cache store has been destroyed');
    }

    // Query all hashes associated with this tag
    let tagItems: Array<Record<string, unknown>>;
    try {
      tagItems = await queryItemsAllPages(this.docClient, {
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': `TAG#${tag}` },
        ProjectionExpression: 'pk, sk',
      });
    } catch (error: unknown) {
      throwIfDynamoTableMissing(error, this.tableName);
      throw error;
    }

    if (tagItems.length === 0) return 0;

    // Build list of keys to delete: cache entries + tag items
    const keysToDelete: Array<Record<string, unknown>> = [];

    for (const item of tagItems) {
      const sk = item['sk'] as string;
      // Delete the cache entry (sk is CACHE#hash, and the cache entry has pk=sk=CACHE#hash)
      keysToDelete.push({ pk: sk, sk });
      // Delete the tag mapping item
      keysToDelete.push({ pk: item['pk'], sk });
    }

    try {
      await batchDeleteWithRetries(
        this.docClient,
        this.tableName,
        keysToDelete,
      );
    } catch (error: unknown) {
      throwIfDynamoTableMissing(error, this.tableName);
      throw error;
    }

    return tagItems.length;
  }

  async invalidateByTags(tags: Array<string>): Promise<number> {
    if (this.isDestroyed) {
      throw new Error('Cache store has been destroyed');
    }

    if (tags.length === 0) return 0;

    // Collect all tag items across all tags
    const allTagItems: Array<Record<string, unknown>> = [];
    for (const tag of tags) {
      try {
        const items = await queryItemsAllPages(this.docClient, {
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': `TAG#${tag}` },
          ProjectionExpression: 'pk, sk',
        });
        allTagItems.push(...items);
      } catch (error: unknown) {
        throwIfDynamoTableMissing(error, this.tableName);
        throw error;
      }
    }

    if (allTagItems.length === 0) return 0;

    // Deduplicate cache hashes (a hash may appear under multiple tags)
    const uniqueCacheKeys = new Set<string>();
    const keysToDelete: Array<Record<string, unknown>> = [];

    for (const item of allTagItems) {
      const sk = item['sk'] as string;
      // Always delete the tag mapping
      keysToDelete.push({ pk: item['pk'], sk });
      // Only delete the cache entry once per unique hash
      if (!uniqueCacheKeys.has(sk)) {
        uniqueCacheKeys.add(sk);
        keysToDelete.push({ pk: sk, sk });
      }
    }

    try {
      await batchDeleteWithRetries(
        this.docClient,
        this.tableName,
        keysToDelete,
      );
    } catch (error: unknown) {
      throwIfDynamoTableMissing(error, this.tableName);
      throw error;
    }

    return uniqueCacheKeys.size;
  }

  async close(): Promise<void> {
    this.isDestroyed = true;

    if (this.isClientManaged && this.rawClient) {
      this.rawClient.destroy();
    }
  }

  destroy(): void {
    this.close();
  }

  private async deleteTagsForHash(hash: string): Promise<void> {
    const sk = `CACHE#${hash}`;
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      let scanResult;
      try {
        scanResult = await this.docClient.send(
          new ScanCommand({
            TableName: this.tableName,
            FilterExpression: 'begins_with(pk, :tagPrefix) AND sk = :sk',
            ExpressionAttributeValues: {
              ':tagPrefix': 'TAG#',
              ':sk': sk,
            },
            ProjectionExpression: 'pk, sk',
            ExclusiveStartKey: lastEvaluatedKey,
          }),
        );
      } catch (error: unknown) {
        throwIfDynamoTableMissing(error, this.tableName);
        throw error;
      }

      const items = scanResult.Items ?? [];
      if (items.length > 0) {
        await batchDeleteWithRetries(
          this.docClient,
          this.tableName,
          items.map((item) => ({ pk: item['pk'], sk: item['sk'] })),
        );
      }

      lastEvaluatedKey = scanResult.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } while (lastEvaluatedKey);
  }

  private assertValidHash(hash: string): void {
    assertDynamoKeyPart(hash, 'hash');
  }
}
