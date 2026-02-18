---
"@http-client-toolkit/dashboard": minor
---

BREAKING: Refactor dashboard to support multiple named HTTP clients.

The `createDashboard`, `createDashboardHandler`, and `startDashboard` functions now require a `clients` array instead of top-level store properties.

Before:
```ts
createDashboard({ cacheStore, dedupeStore, rateLimitStore })
```

After:
```ts
createDashboard({
  clients: [
    { name: 'user-api', cacheStore, dedupeStore, rateLimitStore },
    { name: 'product-api', cacheStore: anotherCacheStore },
  ],
})
```

API routes are now scoped per client under `/api/clients/:clientName/...`. The health endpoint (`GET /api/health`) returns an aggregate view of all clients.
