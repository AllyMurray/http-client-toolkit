---
"@http-client-toolkit/core": minor
"@http-client-toolkit/store-memory": minor
"@http-client-toolkit/store-sqlite": minor
"@http-client-toolkit/store-dynamodb": minor
---

Add multi-client store sharing support

- **Scoped cache/dedup keys**: New `storeScope` option on `HttpClient` prefixes all cache and dedup keys, enabling selective `clear(scope)` and preventing cross-client conflicts when sharing a single store instance.
- **Resource-based rate limiting**: `resourceExtractor` replaces `inferResource`, defaulting to URL origin instead of the last path segment. Per-origin configs via `rateLimitConfigs` and `defaultRateLimitConfig`.
- **Shared server cooldowns**: `RateLimitStore` gains optional `setCooldown`/`getCooldown`/`clearCooldown` methods so 429/503 cooldowns propagate across all clients sharing a store.
- **Scoped clear**: `CacheStore.clear(scope?)` and `DedupeStore.clear(scope?)` filter by key prefix when scope is provided, preserving other clients' entries.
- All three backends (memory, SQLite, DynamoDB) implement the new interface methods.
