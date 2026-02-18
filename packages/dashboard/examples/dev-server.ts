import { HttpClient } from '@http-client-toolkit/core';
import { startDashboard } from '../lib/index.js';
import {
  InMemoryCacheStore,
  InMemoryDedupeStore,
  InMemoryRateLimitStore,
} from '@http-client-toolkit/store-memory';

// Create named HttpClient instances with their stores
const userApiClient = new HttpClient({
  name: 'user-api',
  cache: { store: new InMemoryCacheStore() },
  dedupe: new InMemoryDedupeStore(),
  rateLimit: { store: new InMemoryRateLimitStore() },
});

const productApiClient = new HttpClient({
  name: 'product-api',
  cache: { store: new InMemoryCacheStore() },
  rateLimit: { store: new InMemoryRateLimitStore() },
});

// Seed some test data
const userCache = userApiClient.stores.cache!;
const userRateLimit = userApiClient.stores.rateLimit!;
await userCache.set('user-123', { name: 'Alice' }, 300);
await userCache.set('user-456', { name: 'Bob' }, 600);
await userRateLimit.record('api.users.example.com');
await userRateLimit.record('api.users.example.com');

const productCache = productApiClient.stores.cache!;
const productRateLimit = productApiClient.stores.rateLimit!;
await productCache.set('products-list', [{ id: 1, name: 'Widget' }], 120);
await productRateLimit.record('api.products.example.com');

const { server } = await startDashboard({
  clients: [{ client: userApiClient }, { client: productApiClient }],
  port: 4000,
});

console.log('Dashboard running at http://localhost:4000');
