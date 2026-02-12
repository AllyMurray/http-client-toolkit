---
'@http-client-toolkit/core': minor
---

Respect RFC 9111 HTTP cache headers by default. The client now always uses `Cache-Control`, `ETag`, `Last-Modified`, and `Expires` headers for freshness-based caching, conditional requests (304 Not Modified), `stale-while-revalidate`, and `stale-if-error`. The `defaultCacheTTL` is used as a fallback when response headers don't specify freshness. Store backends require no changes. The `cacheOverrides` option allows selectively bypassing specific cache directives.
