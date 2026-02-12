---
'@http-client-toolkit/core': minor
---

Add opt-in RFC 9111 HTTP cache header support. When `respectCacheHeaders: true` is set, the client respects `Cache-Control`, `ETag`, `Last-Modified`, and `Expires` headers for freshness-based caching, conditional requests (304 Not Modified), `stale-while-revalidate`, and `stale-if-error`. All new options default to off, preserving full backward compatibility. Store backends require no changes.
