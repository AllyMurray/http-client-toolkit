# @http-client-toolkit/dashboard

## 1.0.0

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
