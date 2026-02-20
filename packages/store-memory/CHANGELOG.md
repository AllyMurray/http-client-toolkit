# @http-client-toolkit/store-memory

## 1.0.0

### Minor Changes

- 2484ac3: Restructure HttpClientOptions and add multi-client store sharing

  **BREAKING:** `HttpClientOptions` constructor and per-request `get()` options now use nested objects grouped by concern instead of flat properties.

  ### Constructor options
  - **Cache**: `cache: store` → `cache: { store, globalScope?, ttl?, overrides? }`
    - Cache keys are automatically scoped (prefixed) with the client `name` by default, isolating each client's cache entries
    - Set `globalScope: true` to share cache keys across clients (previous unscoped behaviour)
  - **Rate limit**: `rateLimit: store, throwOnRateLimit, maxWaitTime, rateLimitHeaders` → `rateLimit: { store?, throw?, maxWaitTime?, headers?, resourceExtractor?, configs?, defaultConfig? }`
    - `store` is now optional — server cooldown logic (429/Retry-After headers) works without a store
    - New: `resourceExtractor` for per-resource rate limiting, `configs`/`defaultConfig` for rate limit configuration
  - **Dedup**: `dedupe: store` stays flat (no config to group)
  - **Removed**: flat `cacheTTL`, `cacheOverrides`, `throwOnRateLimit`, `maxWaitTime`, `rateLimitHeaders`

  ### Per-request `get()` options
  - `cacheTTL` and `cacheOverrides` → `cache: { ttl?, overrides? }`

  ### Multi-client store sharing
  - Multiple `HttpClient` instances can share the same store instances safely
  - Cache keys are scoped by client name by default, preventing cross-client cache collisions
  - Dedup uses raw (unscoped) hashes, enabling cross-client request deduplication
  - Server cooldowns (429/Retry-After) are shared across clients hitting the same origin

### Patch Changes

- Updated dependencies [2484ac3]
  - @http-client-toolkit/core@1.0.0

## 0.12.1

### Patch Changes

- @http-client-toolkit/core@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies [52fae0d]
  - @http-client-toolkit/core@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [35b888d]
  - @http-client-toolkit/core@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies [b15eafc]
  - @http-client-toolkit/core@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [97853f2]
  - @http-client-toolkit/core@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [558361f]
  - @http-client-toolkit/core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [bbf2912]
  - @http-client-toolkit/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [5265ab6]
  - @http-client-toolkit/core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [ecb6c9c]
  - @http-client-toolkit/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [0586ad7]
  - @http-client-toolkit/core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [601e241]
  - @http-client-toolkit/core@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [d673265]
  - @http-client-toolkit/core@0.2.0

## 0.1.0

### Patch Changes

- @http-client-toolkit/core@0.1.0

## 0.0.1

### Patch Changes

- beefad8: Initial release with HTTP client, store interfaces, in-memory and SQLite store implementations.
- Updated dependencies [beefad8]
  - @http-client-toolkit/core@0.0.1
