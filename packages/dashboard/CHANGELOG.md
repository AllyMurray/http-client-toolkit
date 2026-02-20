# @http-client-toolkit/dashboard

## 0.12.1

### Minor Changes

- 52fae0d: Accept `HttpClient` instances in dashboard config.

  The `clients` array now accepts `{ client: HttpClient, name?: string }` instead of raw store objects. The dashboard reads stores directly from the `HttpClient` instance.

  Before:

  ```ts
  createDashboard({
    clients: [{ name: 'user-api', cacheStore, dedupeStore, rateLimitStore }],
  });
  ```

  After:

  ```ts
  const client = new HttpClient({
    name: 'user-api',
    cache: cacheStore,
    dedupe: dedupeStore,
    rateLimit: rateLimitStore,
  });

  createDashboard({
    clients: [{ client }],
  });
  ```

### Patch Changes

- Updated dependencies
  - @http-client-toolkit/core@0.12.1
  - @http-client-toolkit/store-memory@0.12.1
  - @http-client-toolkit/store-sqlite@0.12.1
  - @http-client-toolkit/store-dynamodb@0.12.1

## 0.1.0

### Minor Changes

- Initial dashboard release with cache, dedup, and rate limit views. Supports Memory, SQLite, and DynamoDB store backends with runtime detection.
