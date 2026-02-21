---
'@http-client-toolkit/dashboard': patch
'@http-client-toolkit/store-dynamodb': patch
---

Fix path traversal vulnerability in dashboard static file serving, add readonly mode for mutation endpoints, add request body size limit, and clean up stale DynamoDB TAG items on delete/clear/update
