---
"@http-client-toolkit/core": major
"@http-client-toolkit/store-memory": minor
"@http-client-toolkit/store-sqlite": minor
"@http-client-toolkit/store-dynamodb": minor
---

Restructure HttpClientOptions: group by concern

**BREAKING:** `HttpClientOptions` constructor and per-request `get()` options now use nested objects grouped by concern instead of flat properties.

### Constructor options

- **Cache**: `cache: store` → `cache: { store, scope?, ttl?, overrides? }`
- **Rate limit**: `rateLimit: store, throwOnRateLimit, maxWaitTime, rateLimitHeaders, resourceExtractor, rateLimitConfigs, defaultRateLimitConfig` → `rateLimit: { store?, throw?, maxWaitTime?, headers?, resourceExtractor?, configs?, defaultConfig? }`
- **Dedup**: `dedupe: store` stays flat (no config to group)
- **Removed**: `storeScope` (replaced by `cache.scope` — scope now only applies to cache keys, not dedup)
- **Removed**: flat `cacheTTL`, `cacheOverrides`, `throwOnRateLimit`, `maxWaitTime`, `rateLimitHeaders`, `resourceExtractor`, `rateLimitConfigs`, `defaultRateLimitConfig`

### Per-request `get()` options

- `cacheTTL` and `cacheOverrides` → `cache: { ttl?, overrides? }`

### Other changes

- Dedup now always uses raw (unscoped) hashes for cross-client deduplication
- `rateLimit.store` is optional — server cooldown logic (429/Retry-After headers) works without a store
- Multi-client store sharing support with scoped cache keys, resource-based rate limiting, and shared server cooldowns
