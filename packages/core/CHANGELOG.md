# @http-client-toolkit/core

## 0.2.0

### Minor Changes

- d673265: Add opt-in RFC 9111 HTTP cache header support. When `respectCacheHeaders: true` is set, the client respects `Cache-Control`, `ETag`, `Last-Modified`, and `Expires` headers for freshness-based caching, conditional requests (304 Not Modified), `stale-while-revalidate`, and `stale-if-error`. All new options default to off, preserving full backward compatibility. Store backends require no changes.

## 0.1.0

## 0.0.1

### Patch Changes

- beefad8: Initial release with HTTP client, store interfaces, in-memory and SQLite store implementations.
