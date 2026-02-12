---
'@http-client-toolkit/core': minor
---

Add Vary header support to HttpClient. Cached responses with a Vary header are now only served when the current request's headers match the stored values. A new `headers` option on `get()` lets callers send custom request headers, which are also used for Vary-based cache matching.
