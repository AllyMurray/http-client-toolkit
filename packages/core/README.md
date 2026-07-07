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

const client = new HttpClient({
  name: 'example-api',
  cache: new InMemoryCacheStore(),
  dedupe: new InMemoryDedupeStore(),
  rateLimit: new InMemoryRateLimitStore(),
  cacheTTL: 300,
});

const data = await client.get<{ name: string }>(
  'https://api.example.com/user/1',
);
```

Every store is optional. Use only what you need:

```typescript
// Cache-only client
const client = new HttpClient({
  name: 'cached',
  cache: new InMemoryCacheStore(),
});

// Rate-limited client with no caching
const client = new HttpClient({
  name: 'rate-limited',
  rateLimit: new InMemoryRateLimitStore({
    defaultConfig: { limit: 100, windowMs: 60_000 },
  }),
});
```

## Recommended Usage

Create a thin wrapper module per third-party API so callers don't configure anything and per-request tuning lives in one place. See the [Recommended Usage guide](https://allymurray.github.io/http-client-toolkit/guides/recommended-usage/) for a full walkthrough.

## API

### `new HttpClient(options)`

`HttpClient` exposes a single request method: `get(url, options?)`. The `url` must be an absolute URL.

**Request options (`client.get`)**

| Property         | Type                     | Default        | Description                                                         |
| ---------------- | ------------------------ | -------------- | ------------------------------------------------------------------- |
| `signal`         | `AbortSignal`            | -              | Cancels wait + request when aborted                                 |
| `priority`       | `'user' \| 'background'` | `'background'` | Used by adaptive rate-limit stores                                  |
| `headers`        | `Record<string, string>` | -              | Custom request headers (also used for Vary-based cache matching)    |
| `retry`          | `RetryOptions \| false`  | -              | Per-request retry config; `false` disables retries for this call    |
| `cacheTTL`       | `number`                 | -              | Per-request cache TTL in seconds (overrides constructor)            |
| `cacheOverrides` | `CacheOverrideOptions`   | -              | Per-request cache overrides (shallow-merged with constructor-level) |

**Constructor options:**

| Property              | Type                                                              | Default    | Description                                        |
| --------------------- | ----------------------------------------------------------------- | ---------- | -------------------------------------------------- |
| `name`                | `string`                                                          | required   | Name for the client instance                       |
| `cache`               | `CacheStore`                                                      | -          | Response caching                                   |
| `dedupe`              | `DedupeStore`                                                     | -          | Request deduplication                              |
| `rateLimit`           | `RateLimitStore \| AdaptiveRateLimitStore`                        | -          | Rate limiting                                      |
| `cacheTTL`            | `number`                                                          | `3600`     | Cache TTL when response has no headers             |
| `throwOnRateLimit`    | `boolean`                                                         | `true`     | Throw when rate limited vs. wait                   |
| `maxWaitTime`         | `number`                                                          | `60000`    | Max wait time (ms) before throwing                 |
| `responseTransformer` | `(data: unknown) => unknown`                                      | -          | Transform raw response data                        |
| `responseHandler`     | `(data: unknown) => unknown`                                      | -          | Validate/process transformed data                  |
| `errorHandler`        | `(error: unknown) => Error`                                       | -          | Convert errors to domain-specific types            |
| `cacheOverrides`      | `CacheOverrideOptions`                                            | -          | Override cache header behaviors                    |
| `retry`               | `RetryOptions \| false`                                           | -          | Retry config; `false` disables globally            |
| `rateLimitHeaders`    | `RateLimitHeaderConfig`                                           | defaults   | Configure standard/custom header names             |
| `resourceKeyResolver` | `(url: string) => string`                                         | URL origin | Customize how rate-limit resource keys are derived |
| `observability`       | `{ onEvent?: (event: HttpClientEvent) => void \| Promise<void> }` | -          | Subscribe to structured lifecycle events           |

### Request Flow

1. **Cache** - Return cached response if available
2. **Dedupe** - If an identical request is already in-flight, wait for its result
3. **Rate Limit** - Wait or throw if the rate limit is exceeded
4. **Fetch** - Execute the HTTP request
5. **Transform & Validate** - Apply `responseTransformer` then `responseHandler`
6. **Store** - Cache the result, record the rate limit hit, and resolve any deduplicated waiters

### Observability

Use `observability.onEvent` to collect structured lifecycle events without wrapping internal stores or fetch calls:

```typescript
import { HttpClient, type HttpClientEvent } from '@http-client-toolkit/core';

const client = new HttpClient({
  name: 'catalog-api',
  observability: {
    onEvent(event: HttpClientEvent) {
      logger.info({ event }, event.type);

      if (event.type === 'request:success') {
        metrics.histogram('http_client_duration_ms', event.durationMs, {
          clientName: event.clientName,
          status: String(event.status ?? 'unknown'),
        });
      }
    },
  },
});
```

Events cover request start/success/error, cache hits/misses/stale/revalidation,
dedupe ownership and joins, rate-limit waits/throws, server cooldown updates,
and retry scheduling/exhaustion. Payloads include stable public fields such as
`clientName`, `requestId`, `url`, `method`, `resourceKey`, `timestamp`,
`attempt`, `durationMs`, `status`, `error`, `cacheKey`, and `waitMs` where they
apply.

Attempt numbers are emitted on retry events (`retry:scheduled` and
`retry:exhausted`). Final `request:success` and `request:error` events describe
the logical request outcome and do not include a fetch attempt count.

Bridge `onEvent` to your logger, metrics client, or OpenTelemetry instrumentation
by translating these events into log records, counters, histograms, span events,
or attributes. OpenTelemetry is intentionally not a dependency of core.

Observer return values are ignored, observer errors are swallowed, and returned
promises are not awaited; observers cannot change the request result or thrown
error. Keep synchronous observer work lightweight because it runs inline.

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
const client = new HttpClient({
  name: 'custom-api',
  rateLimitHeaders: {
    retryAfter: ['RetryAfterSeconds'],
    remaining: ['Remaining-Requests'],
    reset: ['Window-Reset-Seconds'],
  },
});
```

### Custom Rate-Limit Buckets

Use `resourceKeyResolver` when list and retrieve routes should share the same
rate-limit bucket:

```typescript
const client = new HttpClient({
  name: 'issues-api',
  resourceKeyResolver: (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/issues' || path.startsWith('/api/issue/')) {
      return 'issues';
    }
    return new URL(url).origin;
  },
  rateLimit: {
    store: rateLimitStore,
  },
});
```

`rateLimit.resourceExtractor` is deprecated and kept temporarily for backward
compatibility.

### Exports

- `HttpClient` - Main client class
- `HttpClientError` - Error class with `statusCode`
- `HttpClientEvent` - Stable structured lifecycle event union
- `hashRequest` - Deterministic SHA-256 request hashing
- Store interfaces: `CacheStore`, `DedupeStore`, `RateLimitStore`, `AdaptiveRateLimitStore`

## License

ISC
