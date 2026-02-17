import { startDashboard } from '../lib/index.js';
import {
  InMemoryCacheStore,
  InMemoryDedupeStore,
  InMemoryRateLimitStore,
} from '@http-client-toolkit/store-memory';

const cacheStore = new InMemoryCacheStore();
const dedupeStore = new InMemoryDedupeStore();
const rateLimitStore = new InMemoryRateLimitStore();

// Seed some test data
await cacheStore.set('user-123', { name: 'Alice' }, 300);
await cacheStore.set('user-456', { name: 'Bob' }, 600);
await cacheStore.set('products-list', [{ id: 1, name: 'Widget' }], 120);
await rateLimitStore.record('api.example.com');
await rateLimitStore.record('api.example.com');
await rateLimitStore.record('api.github.com');

const { server } = await startDashboard({
  cacheStore,
  dedupeStore,
  rateLimitStore,
  port: 4000,
});

console.log('Dashboard running at http://localhost:4000');
