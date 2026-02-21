# @http-client-toolkit/dashboard

## 3.0.0

### Patch Changes

- Updated dependencies [b55885b]
  - @http-client-toolkit/store-dynamodb@3.0.0
  - @http-client-toolkit/store-sqlite@3.0.0
  - @http-client-toolkit/core@3.0.0
  - @http-client-toolkit/store-memory@3.0.0

## 2.0.1

### Patch Changes

- 4b88c5e: Fix path traversal vulnerability in dashboard static file serving, add readonly mode for mutation endpoints, add request body size limit, and clean up stale DynamoDB TAG items on delete/clear/update
- Updated dependencies [4b88c5e]
  - @http-client-toolkit/store-dynamodb@2.0.1
  - @http-client-toolkit/core@2.0.1
  - @http-client-toolkit/store-memory@2.0.1
  - @http-client-toolkit/store-sqlite@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [0fc2d9f]
  - @http-client-toolkit/core@2.0.0
  - @http-client-toolkit/store-memory@2.0.0
  - @http-client-toolkit/store-sqlite@2.0.0
  - @http-client-toolkit/store-dynamodb@2.0.0

## 1.0.1

### Patch Changes

- 9ef43f7: Version alignment across all packages
- Updated dependencies [9ef43f7]
  - @http-client-toolkit/core@1.0.1
  - @http-client-toolkit/store-memory@1.0.1
  - @http-client-toolkit/store-sqlite@1.0.1
  - @http-client-toolkit/store-dynamodb@1.0.1

## 1.0.0

### Patch Changes

- Version alignment with core packages (1.0.0 was previously burned on npm from an earlier release)

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

## 0.12.0

### Minor Changes

- 52fae0d: BREAKING: Add required `name` to `HttpClient` and accept `HttpClient` instances in dashboard config.

  **Core**: `HttpClient` now requires a `name` string in its constructor options. The `stores` property is publicly accessible as `readonly`.

  **Dashboard**: The `clients` array now accepts `{ client: HttpClient, name?: string }` instead of raw store objects. The dashboard reads stores directly from the `HttpClient` instance.

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

- Updated dependencies [52fae0d]
  - @http-client-toolkit/core@0.12.0
  - @http-client-toolkit/store-dynamodb@0.12.0
  - @http-client-toolkit/store-memory@0.12.0
  - @http-client-toolkit/store-sqlite@0.12.0

## 0.11.0

_Failed release — see 0.12.0_

### Minor Changes

- 35b888d: BREAKING: Add required `name` to `HttpClient` and accept `HttpClient` instances in dashboard config.

  **Core**: `HttpClient` now requires a `name` string in its constructor options. The `stores` property is publicly accessible as `readonly`.

  **Dashboard**: The `clients` array now accepts `{ client: HttpClient, name?: string }` instead of raw store objects. The dashboard reads stores directly from the `HttpClient` instance.

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

- Updated dependencies [35b888d]
  - @http-client-toolkit/core@0.11.0
  - @http-client-toolkit/store-dynamodb@0.11.0
  - @http-client-toolkit/store-memory@0.11.0
  - @http-client-toolkit/store-sqlite@0.11.0

## 0.1.0

### Minor Changes

- Initial dashboard release with cache, dedup, and rate limit views. Supports Memory, SQLite, and DynamoDB store backends with runtime detection.
