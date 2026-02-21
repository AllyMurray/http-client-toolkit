import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  DynamoDBAdaptiveRateLimitStore,
  type DynamoDBAdaptiveRateLimitStoreOptions,
} from './dynamodb-adaptive-rate-limit-store.js';
import {
  DynamoDBCacheStore,
  type DynamoDBCacheStoreOptions,
} from './dynamodb-cache-store.js';
import {
  DynamoDBDedupeStore,
  type DynamoDBDedupeStoreOptions,
} from './dynamodb-dedupe-store.js';
import {
  DynamoDBRateLimitStore,
  type DynamoDBRateLimitStoreOptions,
} from './dynamodb-rate-limit-store.js';
import { DEFAULT_TABLE_NAME } from './table.js';

export interface CreateDynamoDBStoresOptions {
  /** Existing DynamoDB client to share. If omitted, one is created. */
  client?: DynamoDBDocumentClient | DynamoDBClient;
  /** AWS region (used only when creating a new client). */
  region?: string;
  /** DynamoDB table name. Defaults to `'http-client-toolkit'`. */
  tableName?: string;
  /** Options for the cache store (excluding `client`, `region`, `tableName`). */
  cache?: Omit<DynamoDBCacheStoreOptions, 'client' | 'region' | 'tableName'>;
  /** Options for the dedupe store (excluding `client`, `region`, `tableName`). */
  dedupe?: Omit<DynamoDBDedupeStoreOptions, 'client' | 'region' | 'tableName'>;
  /** Options for the rate limit store (excluding `client`, `region`, `tableName`). */
  rateLimit?: Omit<
    DynamoDBRateLimitStoreOptions,
    'client' | 'region' | 'tableName'
  >;
  /** Options for the adaptive rate limit store (excluding `client`, `region`, `tableName`). */
  adaptiveRateLimit?: Omit<
    DynamoDBAdaptiveRateLimitStoreOptions,
    'client' | 'region' | 'tableName'
  >;
}

export interface DynamoDBStores {
  cache: DynamoDBCacheStore;
  dedupe: DynamoDBDedupeStore;
  rateLimit: DynamoDBRateLimitStore;
  adaptiveRateLimit: DynamoDBAdaptiveRateLimitStore;
  /** Close all stores and destroy the shared client (if factory-created). */
  close(): Promise<void>;
}

/**
 * Creates all DynamoDB-backed stores sharing a single client and table.
 *
 * When no `client` is provided the factory creates a `DynamoDBClient` and
 * will destroy it when `close()` is called. When an existing client is
 * passed in, it is **not** destroyed — the caller retains ownership.
 */
export function createDynamoDBStores(
  options: CreateDynamoDBStoresOptions = {},
): DynamoDBStores {
  const tableName = options.tableName ?? DEFAULT_TABLE_NAME;

  let docClient: DynamoDBDocumentClient;
  let rawClient: DynamoDBClient | undefined;
  let isClientManaged = false;

  if (options.client instanceof DynamoDBDocumentClient) {
    docClient = options.client;
  } else if (options.client instanceof DynamoDBClient) {
    docClient = DynamoDBDocumentClient.from(options.client);
  } else {
    const config: DynamoDBClientConfig = {};
    if (options.region) config.region = options.region;
    rawClient = new DynamoDBClient(config);
    docClient = DynamoDBDocumentClient.from(rawClient);
    isClientManaged = true;
  }

  const cache = new DynamoDBCacheStore({
    client: docClient,
    tableName,
    ...options.cache,
  });
  const dedupe = new DynamoDBDedupeStore({
    client: docClient,
    tableName,
    ...options.dedupe,
  });
  const rateLimit = new DynamoDBRateLimitStore({
    client: docClient,
    tableName,
    ...options.rateLimit,
  });
  const adaptiveRateLimit = new DynamoDBAdaptiveRateLimitStore({
    client: docClient,
    tableName,
    ...options.adaptiveRateLimit,
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
      if (isClientManaged && rawClient) {
        rawClient.destroy();
      }
    },
  };
}
