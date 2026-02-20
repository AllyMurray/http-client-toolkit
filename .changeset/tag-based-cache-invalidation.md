---
"@http-client-toolkit/core": minor
"@http-client-toolkit/store-memory": minor
"@http-client-toolkit/store-sqlite": minor
"@http-client-toolkit/store-dynamodb": minor
---

Add tag-based cache invalidation. Cache entries can now be labelled with tags via `cache: { tags: ['users'] }` on requests, then selectively invalidated with `client.invalidateByTag()` and `client.invalidateByTags()`.
