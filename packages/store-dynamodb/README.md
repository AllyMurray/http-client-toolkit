# @http-client-toolkit/store-dynamodb

DynamoDB store implementations for HTTP client toolkit caching, deduplication, and rate limiting. Designed for distributed, serverless-friendly environments.

## Installation

```bash
npm install @http-client-toolkit/store-dynamodb @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

The AWS SDK packages are peer dependencies — you likely already have them in a serverless project.

Requires Node.js >= 20.

## Table Setup

All stores share a single DynamoDB table (default name: `http-client-toolkit`) with a partition key `pk` (String), sort key `sk` (String), and a GSI named `gsi1`.

**Option 1: Create the table yourself** (recommended for production)

Use the AWS Console, CloudFormation, CDK, or Terraform. The required schema is exported as `TABLE_SCHEMA`:

```typescript
import {
  TABLE_SCHEMA,
  DEFAULT_TABLE_NAME,
} from '@http-client-toolkit/store-dynamodb';
```

Enable DynamoDB native TTL on the `ttl` attribute for automatic item expiration.

**Option 2: Auto-create at startup** (development only)

```typescript
const cache = new DynamoDBCacheStore({ ensureTableExists: true });
```

**Option 3: Setup script**

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createTable } from '@http-client-toolkit/store-dynamodb';

const client = new DynamoDBClient({ region: 'us-east-1' });
await createTable(client, 'my-table-name');
```

## Usage

```typescript
import { HttpClient } from '@http-client-toolkit/core';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBCacheStore,
  DynamoDBDedupeStore,
  DynamoDBRateLimitStore,
} from '@http-client-toolkit/store-dynamodb';

const dynamoClient = new DynamoDBClient({ region: 'us-east-1' });

const client = new HttpClient({
  cache: new DynamoDBCacheStore({ client: dynamoClient }),
  dedupe: new DynamoDBDedupeStore({ client: dynamoClient }),
  rateLimit: new DynamoDBRateLimitStore({ client: dynamoClient }),
});
```

All stores accept a `DynamoDBDocumentClient`, a plain `DynamoDBClient` (auto-wrapped), or no client (created internally with optional `region`).

### DynamoDBCacheStore

```typescript
new DynamoDBCacheStore({
  client: dynamoClient,
  tableName: 'http-client-toolkit', // Default
  maxEntrySizeBytes: 390 * 1024, // Default: 390 KB (DynamoDB 400 KB limit minus overhead)
  ensureTableExists: false, // Default
});
```

### DynamoDBDedupeStore

```typescript
new DynamoDBDedupeStore({
  client: dynamoClient,
  jobTimeoutMs: 300_000, // Default: 5 minutes
  pollIntervalMs: 500, // Default: 500ms (higher than SQLite to reduce API calls)
});
```

### DynamoDBRateLimitStore

```typescript
new DynamoDBRateLimitStore({
  client: dynamoClient,
  defaultConfig: { limit: 60, windowMs: 60_000 },
  resourceConfigs: new Map([['slow-api', { limit: 10, windowMs: 60_000 }]]),
});
```

### DynamoDBAdaptiveRateLimitStore

```typescript
new DynamoDBAdaptiveRateLimitStore({
  client: dynamoClient,
  defaultConfig: { limit: 200, windowMs: 3_600_000 },
  adaptiveConfig: {
    highActivityThreshold: 10,
    moderateActivityThreshold: 3,
  },
});
```

## Key Design Notes

- **No cleanup intervals**: Unlike SQLite/memory stores, DynamoDB native TTL handles automatic item expiration. No background timers are needed.
- **TTL lag**: DynamoDB TTL deletion can be delayed up to 48 hours. Stores check `ttl` in `get()` to filter expired items immediately.
- **Single-table design**: All store types share one table, separated by key prefixes (`CACHE#`, `DEDUPE#`, `RATELIMIT#`).
- **`clear()` is expensive**: Uses Scan + BatchWriteItem. DynamoDB has no truncate operation.
- **GSI for priority queries**: The adaptive rate limit store uses the `gsi1` GSI to efficiently query requests by priority.

## License

ISC
