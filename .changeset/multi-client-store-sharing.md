---
"@http-client-toolkit/core": major
"@http-client-toolkit/store-memory": minor
"@http-client-toolkit/store-sqlite": minor
"@http-client-toolkit/store-dynamodb": minor
---

Restructure HttpClientOptions and add multi-client store sharing

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
