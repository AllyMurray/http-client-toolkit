# @http-client-toolkit/core

Core HTTP client with pluggable caching, deduplication, and rate limiting. Part of the [http-client-toolkit](https://github.com/AllyMurray/http-client-toolkit) monorepo.

## Installation

```bash
npm install @http-client-toolkit/core
```

Requires Node.js >= 20.

You'll also need at least one store backend:

```bash
npm install @http-client-toolkit/store-memory
# or
npm install @http-client-toolkit/store-sqlite
```

## Quick Start

```typescript
import { HttpClient } from '@http-client-toolkit/core';
import {
  InMemoryCacheStore,
  InMemoryDedupeStore,
  InMemoryRateLimitStore,
} from '@http-client-toolkit/store-memory';

const client = new HttpClient(
  {
    cache: new InMemoryCacheStore(),
    dedupe: new InMemoryDedupeStore(),
    rateLimit: new InMemoryRateLimitStore(),
  },
  { defaultCacheTTL: 300 },
);

const data = await client.get<{ name: string }>(
  'https://api.example.com/user/1',
);
```

Every store is optional. Use only what you need:

```typescript
// Cache-only client
const client = new HttpClient({ cache: new InMemoryCacheStore() });

// Rate-limited client with no caching
const client = new HttpClient({
  rateLimit: new InMemoryRateLimitStore({
    defaultConfig: { limit: 100, windowMs: 60_000 },
  }),
});
```

## API

### `new HttpClient(stores?, options?)`

`HttpClient` exposes a single request method: `get(url, options?)`. The `url` must be an absolute URL.

**Request options (`client.get`)**

| Property   | Type                     | Default        | Description                         |
| ---------- | ------------------------ | -------------- | ----------------------------------- |
| `signal`   | `AbortSignal`            | -              | Cancels wait + request when aborted |
| `priority` | `'user' \| 'background'` | `'background'` | Used by adaptive rate-limit stores  |

**Stores:**

| Property    | Type                                       | Description           |
| ----------- | ------------------------------------------ | --------------------- |
| `cache`     | `CacheStore`                               | Response caching      |
| `dedupe`    | `DedupeStore`                              | Request deduplication |
| `rateLimit` | `RateLimitStore \| AdaptiveRateLimitStore` | Rate limiting         |

**Options:**

| Property              | Type                         | Default  | Description                             |
| --------------------- | ---------------------------- | -------- | --------------------------------------- |
| `defaultCacheTTL`     | `number`                     | `3600`   | Cache TTL in seconds                    |
| `throwOnRateLimit`    | `boolean`                    | `true`   | Throw when rate limited vs. wait        |
| `maxWaitTime`         | `number`                     | `60000`  | Max wait time (ms) before throwing      |
| `responseTransformer` | `(data: unknown) => unknown` | -        | Transform raw response data             |
| `responseHandler`     | `(data: unknown) => unknown` | -        | Validate/process transformed data       |
| `errorHandler`        | `(error: unknown) => Error`  | -        | Convert errors to domain-specific types |
| `rateLimitHeaders`    | `RateLimitHeaderConfig`      | defaults | Configure standard/custom header names  |

### Request Flow

1. **Cache** - Return cached response if available
2. **Dedupe** - If an identical request is already in-flight, wait for its result
3. **Rate Limit** - Wait or throw if the rate limit is exceeded
4. **Fetch** - Execute the HTTP request
5. **Transform & Validate** - Apply `responseTransformer` then `responseHandler`
6. **Store** - Cache the result, record the rate limit hit, and resolve any deduplicated waiters

### Error Handling

All HTTP errors are wrapped in `HttpClientError`:

```typescript
import { HttpClientError } from '@http-client-toolkit/core';

try {
  await client.get(url);
} catch (error) {
  if (error instanceof HttpClientError) {
    console.log(error.message);
    console.log(error.statusCode);
  }
}
```

### Cancellation

Pass an `AbortSignal` to cancel a request, including while waiting for a rate limit window:

```typescript
const controller = new AbortController();
const data = await client.get(url, { signal: controller.signal });
controller.abort();
```

### Header-Based Rate Limiting

`HttpClient` respects server-provided rate-limit headers out of the box:

- `Retry-After`
- `RateLimit-Remaining` / `RateLimit-Reset`
- `X-RateLimit-Remaining` / `X-RateLimit-Reset`

Map non-standard header names per API:

```typescript
const client = new HttpClient(
  {},
  {
    rateLimitHeaders: {
      retryAfter: ['RetryAfterSeconds'],
      remaining: ['Remaining-Requests'],
      reset: ['Window-Reset-Seconds'],
    },
  },
);
```

### Exports

- `HttpClient` - Main client class
- `HttpClientError` - Error class with `statusCode`
- `hashRequest` - Deterministic SHA-256 request hashing
- Store interfaces: `CacheStore`, `DedupeStore`, `RateLimitStore`, `AdaptiveRateLimitStore`

## License

ISC
