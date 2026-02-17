---
'@http-client-toolkit/core': minor
---

Merge `HttpClient` constructor into a single options object — stores (`cache`, `dedupe`, `rateLimit`) and behavioral options are now passed together instead of as two separate arguments. Also rename `defaultCacheTTL` to `cacheTTL` for clarity.
