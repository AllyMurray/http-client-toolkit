import { startDashboard } from '../lib/index.js';
import {
  InMemoryCacheStore,
  InMemoryDedupeStore,
  InMemoryRateLimitStore,
} from '@http-client-toolkit/store-memory';

// User API client stores
const userCacheStore = new InMemoryCacheStore();
const userDedupeStore = new InMemoryDedupeStore();
const userRateLimitStore = new InMemoryRateLimitStore();

// Product API client stores
const productCacheStore = new InMemoryCacheStore();
const productRateLimitStore = new InMemoryRateLimitStore();

// Seed some test data
await userCacheStore.set('user-123', { name: 'Alice' }, 300);
await userCacheStore.set('user-456', { name: 'Bob' }, 600);
await userRateLimitStore.record('api.users.example.com');
await userRateLimitStore.record('api.users.example.com');

await productCacheStore.set('products-list', [{ id: 1, name: 'Widget' }], 120);
await productRateLimitStore.record('api.products.example.com');

const { server } = await startDashboard({
  clients: [
    {
      name: 'user-api',
      cacheStore: userCacheStore,
      dedupeStore: userDedupeStore,
      rateLimitStore: userRateLimitStore,
    },
    {
      name: 'product-api',
      cacheStore: productCacheStore,
      rateLimitStore: productRateLimitStore,
    },
  ],
  port: 4000,
});

console.log('Dashboard running at http://localhost:4000');
