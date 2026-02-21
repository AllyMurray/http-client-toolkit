# @http-client-toolkit/store-dynamodb

## 3.0.0

### Minor Changes

- b55885b: Add shared-database factory functions (`createStores`) for DynamoDB and SQLite stores

### Patch Changes

- @http-client-toolkit/core@3.0.0

## 2.0.1

### Patch Changes

- 4b88c5e: Fix path traversal vulnerability in dashboard static file serving, add readonly mode for mutation endpoints, add request body size limit, and clean up stale DynamoDB TAG items on delete/clear/update
  - @http-client-toolkit/core@2.0.1

## 2.0.0

### Minor Changes

- 0fc2d9f: Add tag-based cache invalidation. Cache entries can now be labelled with tags via `cache: { tags: ['users'] }` on requests, then selectively invalidated with `client.invalidateByTag()` and `client.invalidateByTags()`.

### Patch Changes

- Updated dependencies [0fc2d9f]
  - @http-client-toolkit/core@2.0.0

## 1.0.1

### Patch Changes

- 9ef43f7: Version alignment across all packages
- Updated dependencies [9ef43f7]
  - @http-client-toolkit/core@1.0.1

## 1.0.0

### Patch Changes

- Updated dependencies
  - @http-client-toolkit/core@1.0.0

## 0.12.1

### Patch Changes

- @http-client-toolkit/core@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies [52fae0d]
  - @http-client-toolkit/core@0.12.0

## 0.11.0

_Failed release — superseded by 0.12.0._

## 0.10.0

### Patch Changes

- Updated dependencies [b15eafc]
  - @http-client-toolkit/core@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [97853f2]
  - @http-client-toolkit/core@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [558361f]
  - @http-client-toolkit/core@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [bbf2912]
  - @http-client-toolkit/core@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [5265ab6]
  - @http-client-toolkit/core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [ecb6c9c]
  - @http-client-toolkit/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [0586ad7]
  - @http-client-toolkit/core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [601e241]
  - @http-client-toolkit/core@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [d673265]
  - @http-client-toolkit/core@0.2.0

## 0.1.0

### Minor Changes

- 016c608: Harden DynamoDB store with robust error handling, input validation, and performance optimizations. Key changes include bounded conditional transaction retries, dedupe waitFor failure surfacing, hash and resource key validation, hot-path counting bounds, adaptive metrics memory management, and parallelized independent DynamoDB queries.

### Patch Changes

- @http-client-toolkit/core@0.1.0
