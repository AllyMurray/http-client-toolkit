# @http-client-toolkit/core

## 0.12.1

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

## 0.11.0

_Failed release — see 0.12.0_

## 0.10.0

### Minor Changes

- b15eafc: Merge `HttpClient` constructor into a single options object — stores (`cache`, `dedupe`, `rateLimit`) and behavioral options are now passed together instead of as two separate arguments. Also rename `defaultCacheTTL` to `cacheTTL` for clarity.

## 0.9.0

### Minor Changes

- 97853f2: Add per-request `cacheTTL` and `cacheOverrides` options to `get()` for overriding constructor-level cache configuration on individual requests

## 0.8.0

### Minor Changes

- 558361f: Add automatic retry with exponential backoff for transient failures (network errors, 429, 5xx)

## 0.7.0

### Minor Changes

- bbf2912: Improve public error handling API:
  - **`HttpErrorContext.url`**: Error handlers now receive the requested URL, enabling logging and error reporting without extra bookkeeping.
  - **`HttpClientError.data` / `HttpClientError.headers`**: The default error path (when no `errorHandler` is provided) now includes the parsed response body and headers on the thrown error.
  - **JSDoc**: Added documentation to all `HttpErrorContext` fields and clarified the distinction between `responseTransformer` and `responseHandler`.

## 0.6.0

### Minor Changes

- 5265ab6: Separate HTTP error handling into detection, enrichment, and classification stages. `errorHandler` now receives a typed `HttpErrorContext` instead of `unknown` and is only called for HTTP errors (non-2xx responses), not network failures. Network errors are always wrapped in `HttpClientError` by the toolkit.

## 0.5.0

### Minor Changes

- ecb6c9c: Add `fetchFn`, `requestInterceptor`, and `responseInterceptor` options to HttpClient for customising the HTTP lifecycle

## 0.4.0

### Minor Changes

- 0586ad7: Add Vary header support to HttpClient. Cached responses with a Vary header are now only served when the current request's headers match the stored values. A new `headers` option on `get()` lets callers send custom request headers, which are also used for Vary-based cache matching.

## 0.3.0

### Minor Changes

- 601e241: Respect RFC 9111 HTTP cache headers by default. The client now always uses `Cache-Control`, `ETag`, `Last-Modified`, and `Expires` headers for freshness-based caching, conditional requests (304 Not Modified), `stale-while-revalidate`, and `stale-if-error`. The `defaultCacheTTL` is used as a fallback when response headers don't specify freshness. Store backends require no changes. The `cacheOverrides` option allows selectively bypassing specific cache directives.

## 0.2.0

### Minor Changes

- d673265: Add opt-in RFC 9111 HTTP cache header support. When `respectCacheHeaders: true` is set, the client respects `Cache-Control`, `ETag`, `Last-Modified`, and `Expires` headers for freshness-based caching, conditional requests (304 Not Modified), `stale-while-revalidate`, and `stale-if-error`. All new options default to off, preserving full backward compatibility. Store backends require no changes.

## 0.1.0

## 0.0.1

### Patch Changes

- beefad8: Initial release with HTTP client, store interfaces, in-memory and SQLite store implementations.
