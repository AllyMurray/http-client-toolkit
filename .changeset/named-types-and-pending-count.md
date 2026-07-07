---
'@http-client-toolkit/core': minor
---

Export `HttpClientObservabilityOptions` and `PerRequestCacheOptions` as named types so consuming SDKs can reference them directly instead of re-deriving inline shapes. `HttpClientOptions.observability` and the per-request `get()` `cache` option now use these named types.

Add a synchronous `getPendingRequestCount(resourceKey?)` accessor on
`HttpClient` (and `HttpClientContract`) returning the number of in-flight
`get()` calls. Includes both executing requests and joiners waiting on a
deduplicated request. Pass a `resourceKey` (as produced by
`resourceKeyResolver`, or the URL origin by default) to scope the count to a
single rate-limit bucket; omit it for the total across all resources.
Complements the asynchronous `dedupe:owner` / `dedupe:join` observability
events as a synchronous queue-depth probe.
