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
import { DEFAULT_TABLE_NAME, ensureTable } from './table.js';

export interface DynamoDBCacheStoreOptions {
  client?: DynamoDBDocumentClient | DynamoDBClient;
  region?: string;
  tableName?: string;
  ensureTableExists?: boolean;
  maxEntrySizeBytes?: number;
}

export class DynamoDBCacheStore<T = unknown> implements CacheStore<T> {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly rawClient: DynamoDBClient | undefined;
  private readonly isClientManaged: boolean;
  private readonly tableName: string;
  private readonly maxEntrySizeBytes: number;
  private readonly readyPromise: Promise<void>;
  private isDestroyed = false;

  constructor({
    client,
    region,
    tableName = DEFAULT_TABLE_NAME,
    ensureTableExists = false,
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

    if (ensureTableExists) {
      const rawForTable =
        this.rawClient ??
        (client instanceof DynamoDBClient
          ? client
          : new DynamoDBClient(region ? { region } : {}));
      this.readyPromise = ensureTable(rawForTable, this.tableName);
    } else {
      this.readyPromise = Promise.resolve();
    }
  }

  async get(hash: string): Promise<T | undefined> {
    if (this.isDestroyed) {
      throw new Error('Cache store has been destroyed');
    }

    await this.readyPromise;

    const pk = `CACHE#${hash}`;

    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk: pk },
      }),
    );

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

    await this.readyPromise;

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
  }

  async delete(hash: string): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('Cache store has been destroyed');
    }

    await this.readyPromise;

    const pk = `CACHE#${hash}`;

    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk, sk: pk },
      }),
    );
  }

  async clear(): Promise<void> {
    if (this.isDestroyed) {
      throw new Error('Cache store has been destroyed');
    }

    await this.readyPromise;

    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const scanResult = await this.docClient.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: 'begins_with(pk, :prefix)',
          ExpressionAttributeValues: { ':prefix': 'CACHE#' },
          ProjectionExpression: 'pk, sk',
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );

      const items = scanResult.Items ?? [];
      if (items.length > 0) {
        // BatchWriteItem supports up to 25 items per request
        for (let i = 0; i < items.length; i += 25) {
          const batch = items.slice(i, i + 25);
          await this.docClient.send(
            new BatchWriteCommand({
              RequestItems: {
                [this.tableName]: batch.map((item) => ({
                  DeleteRequest: {
                    Key: { pk: item['pk'], sk: item['sk'] },
                  },
                })),
              },
            }),
          );
        }
      }

      lastEvaluatedKey = scanResult.LastEvaluatedKey as
        | Record<string, unknown>
        | undefined;
    } while (lastEvaluatedKey);
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
}
