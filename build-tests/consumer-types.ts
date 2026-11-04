import {
  HttpClient,
  AdaptiveConfigSchema,
  type CacheStore,
} from '@http-client-toolkit/core';
import { InMemoryCacheStore } from '@http-client-toolkit/store-memory';
import { createSQLiteStores } from '@http-client-toolkit/store-sqlite';
import { DynamoDBCacheStore } from '@http-client-toolkit/store-dynamodb';
import {
  createDashboardHandler,
  type DashboardOptions,
} from '@http-client-toolkit/dashboard';

const cache: CacheStore<{ id: number }> = new InMemoryCacheStore<{
  id: number;
}>();
const client = new HttpClient({ name: 'consumer', cache: { store: cache } });
const result: Promise<{ id: number }> = client.get<{ id: number }>(
  'https://example.com',
);
void result;
const threshold: number = AdaptiveConfigSchema.parse({}).highActivityThreshold;
void threshold;
const stores = createSQLiteStores();
const sqlite: CacheStore = stores.cache;
const dynamodb: CacheStore = new DynamoDBCacheStore({ region: 'eu-west-1' });
void sqlite;
void dynamodb;
const options: DashboardOptions = { clients: [{ client }] };
const response: Promise<Response> = createDashboardHandler(options)(
  new Request('https://example.com'),
);
void response;

// These must remain errors in the published declarations, in both module modes.
// @ts-expect-error A cache item must match its declared value type.
cache.set('key', { id: 'wrong' }, 60);
// @ts-expect-error Dashboard clients require an HttpClient instance.
createDashboardHandler({ clients: [{ client: {} }] });
