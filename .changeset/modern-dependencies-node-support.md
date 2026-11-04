---
'@http-client-toolkit/core': major
'@http-client-toolkit/dashboard': major
'@http-client-toolkit/store-memory': major
'@http-client-toolkit/store-sqlite': major
'@http-client-toolkit/store-dynamodb': major
---

Update runtime dependencies, including Zod 4, better-sqlite3 13, Drizzle ORM,
React, and the AWS SDK. Exported validation schemas now use Zod 4 types.

Require Node.js 22 or newer, dropping the end-of-life Node 20 line. Verify
installed ESM and CommonJS packages on the supported stable Node 22, 24, and 26
lines, while keeping builds and releases on Node 24.

Ship the SQLite type definitions required by its public API.
