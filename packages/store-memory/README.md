# @http-client-toolkit/store-memory

In-memory store implementations for [@http-client-toolkit/core](https://www.npmjs.com/package/@http-client-toolkit/core). Fast, zero-dependency stores for development, testing, or single-process production use.

Part of the [http-client-toolkit](https://github.com/AllyMurray/http-client-toolkit) monorepo.

## Installation

```bash
npm install @http-client-toolkit/core @http-client-toolkit/store-memory
```

Requires Node.js >= 20.

## Usage

```typescript
import { HttpClient } from '@http-client-toolkit/core';
import {
  InMemoryCacheStore,
  InMemoryDedupeStore,
  InMemoryRateLimitStore,
} from '@http-client-toolkit/store-memory';

const client = new HttpClient({
  name: 'my-api',
  cache: new InMemoryCacheStore(),
  dedupe: new InMemoryDedupeStore(),
  rateLimit: new InMemoryRateLimitStore(),
});

const data = await client.get<{ name: string }>(
  'https://api.example.com/user/1',
);
```

## Stores

### InMemoryCacheStore

LRU cache with TTL support and dual eviction limits (item count + memory usage).

```typescript
const cache = new InMemoryCacheStore({
  maxItems: 1000, // Default: 1000
  maxMemoryBytes: 50_000_000, // Default: 50 MB
  cleanupIntervalMs: 60_000, // Default: 60s. Set to 0 to disable.
  evictionRatio: 0.1, // Default: 10% evicted when limits exceeded
});
```

Call `cache.destroy()` when done to clear the cleanup timer.

### InMemoryDedupeStore

Prevents duplicate concurrent requests. If a request for the same hash is already in-flight, subsequent callers wait for the original to complete.

```typescript
const dedupe = new InMemoryDedupeStore({
  jobTimeoutMs: 300_000, // Default: 5 minutes
  cleanupIntervalMs: 60_000, // Default: 60s
});
```

### InMemoryRateLimitStore

Sliding window rate limiter with optional per-resource configuration.

```typescript
const rateLimit = new InMemoryRateLimitStore({
  defaultConfig: { limit: 60, windowMs: 60_000 },
  resourceConfigs: new Map([['slow-api', { limit: 10, windowMs: 60_000 }]]),
});
```

### AdaptiveRateLimitStore

Priority-aware rate limiter that dynamically allocates capacity between user and background requests based on recent activity patterns.

```typescript
import { AdaptiveRateLimitStore } from '@http-client-toolkit/store-memory';

const rateLimit = new AdaptiveRateLimitStore({
  defaultConfig: { limit: 200, windowMs: 3_600_000 },
  resourceConfigs: new Map([['search', { limit: 50, windowMs: 60_000 }]]),
  adaptiveConfig: {
    highActivityThreshold: 10,
    moderateActivityThreshold: 3,
    monitoringWindowMs: 900_000,
    maxUserScaling: 2.0,
  },
});
```

| Activity Level           | Behavior                                                            |
| ------------------------ | ------------------------------------------------------------------- |
| **High**                 | Prioritizes user requests, pauses background if trend is increasing |
| **Moderate**             | Balanced allocation with trend-aware scaling                        |
| **Low**                  | Scales up background capacity                                       |
| **Sustained inactivity** | Gives full capacity to background                                   |

## License

ISC
