# HTTP Client Toolkit

A modular HTTP client toolkit with pluggable caching, deduplication, and rate limiting. Each concern is implemented as a standalone store that can be used independently or composed together.

**[Documentation](https://allymurray.github.io/http-client-toolkit)**

## Packages

| Package                                                                                                    | Description                           |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [`@http-client-toolkit/core`](https://www.npmjs.com/package/@http-client-toolkit/core)                     | HTTP client and store interfaces      |
| [`@http-client-toolkit/store-memory`](https://www.npmjs.com/package/@http-client-toolkit/store-memory)     | In-memory store implementations       |
| [`@http-client-toolkit/store-sqlite`](https://www.npmjs.com/package/@http-client-toolkit/store-sqlite)     | SQLite-backed store implementations   |
| [`@http-client-toolkit/store-dynamodb`](https://www.npmjs.com/package/@http-client-toolkit/store-dynamodb) | DynamoDB-backed store implementations |
| [`@http-client-toolkit/dashboard`](https://www.npmjs.com/package/@http-client-toolkit/dashboard) | Dashboard UI for monitoring stores |

## Quick Start

```bash
npm install @http-client-toolkit/core @http-client-toolkit/store-memory
```

```typescript
import { HttpClient } from '@http-client-toolkit/core';
import {
  InMemoryCacheStore,
  InMemoryDedupeStore,
  InMemoryRateLimitStore,
} from '@http-client-toolkit/store-memory';

const client = new HttpClient({
  name: 'example-api',
  cache: new InMemoryCacheStore(),
  dedupe: new InMemoryDedupeStore(),
  rateLimit: new InMemoryRateLimitStore(),
  cacheTTL: 300,
});

const data = await client.get<{ name: string }>(
  'https://api.example.com/user/1',
);
```

Every store is optional. Use only what you need.

Requires Node.js >= 20.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

### Dependency updates

[Renovate](https://docs.renovatebot.com/) manages workspace dependencies, the
separate documentation project, pnpm versions, and GitHub Actions through
[`renovate.json`](./renovate.json). The policy follows `comic-vine` and
`iracing-data-client`, adapted to this monorepo:

- Ordinary updates run between midnight and 06:00 Europe/London, with at most
  five open PRs and two new PRs per hour. The Dependency Dashboard tracks updates.
- npm releases wait one day; selected stable development-tool patches wait three
  days and can automerge after CI passes. Runtime, documentation, shared-config,
  peer, compiler, and major updates require review. Vitest and its coverage
  provider are updated together and require review.
- Lockfile maintenance runs in the same overnight window, gets priority, and
  requires review. Security alert PRs bypass the schedule and release-age delay
  but still require review.
- Node engines and the CI runtime remain deliberate decisions; Node types stay
  on version 20. Peer dependency ranges are widened to preserve consumer support.

CI builds the library and documentation on dependency PRs. Renovate configuration
changes also run the [strict config validator](https://docs.renovatebot.com/config-validation/).
Consumer-facing dependency updates need an appropriate changeset before merging
so the release workflow publishes the affected packages.

The Renovate GitHub App must have access to this repository. Keep the `validate`
and `docs` checks required in branch protection; the path-filtered
`validate-renovate` check only runs when its configuration changes.

## License

ISC
