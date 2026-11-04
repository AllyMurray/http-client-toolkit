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
| [`@http-client-toolkit/dashboard`](https://www.npmjs.com/package/@http-client-toolkit/dashboard)           | Dashboard UI for monitoring stores    |

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

Requires Node.js >= 22. Developing this repository requires Node.js >= 24.11 and the pnpm version pinned in `package.json`.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint:check
pnpm typecheck
pnpm test:dependency-policy
pnpm audit:dependencies
pnpm test:release
pnpm test:package:prepare
pnpm test:package
```

### Dependency updates

[Renovate](https://docs.renovatebot.com/) manages workspace dependencies, the
separate documentation project, pnpm versions, and GitHub Actions through
[`renovate.json`](./renovate.json). The policy follows `comic-vine` and
`iracing-data-client`, adapted to this monorepo:

- Ordinary updates run between midnight and 06:00 Europe/London, with at most
  five open PRs and two new PRs per hour. The Dependency Dashboard tracks updates.
- Both pnpm installs and Renovate updates enforce a one-day release age, including
  transitive dependencies and frozen lockfiles; missing publication dates fail
  closed. Local registry tests verify this policy. Selected stable development-tool patches wait three
  days and can automerge after CI passes. Runtime, documentation, shared-config,
  peer, compiler, and major updates require review. Vitest and its coverage
  provider are updated together and require review.
- Lockfile maintenance runs in the same overnight window, gets priority, and
  requires review. Security alert PRs bypass Renovate's schedule and release-age
  delay but still require review; installs continue to enforce the pnpm policy.
- Node engines and the CI runtime remain deliberate decisions; Node types follow
  the Node 24 development runtime. Peer dependency ranges are widened to preserve
  consumer support.

CI builds the library and documentation on Node 24. Installed ESM and CommonJS
packages are tested on every supported stable Node line: 22, 24, and 26.
The matrix also runs unit tests, and installed package checks validate ESM and
CommonJS declaration resolution. Keep it current with the
[Node.js release schedule](https://nodejs.org/en/about/previous-releases). Renovate configuration
changes also run the [strict config validator](https://docs.renovatebot.com/config-validation/).
Consumer-facing dependency updates need an appropriate changeset before merging
so the release workflow publishes the affected packages.

The Renovate GitHub App must have access to this repository. Branch protection
should require `validate`, `docs`, and every `consumers` matrix check; the path-filtered
`validate-renovate` check only runs when its configuration changes.

### Compatibility exceptions

- ESLint remains on 9 while `eslint-plugin-import` requires it; TypeScript remains
  on 6 while `typescript-eslint` requires it. Node types follow the Node 24 build runtime.
- `rimraf` stays on 6.1.3 until 6.1.4 meets the release-age policy. Its `glob`
  dependency is overridden to the same patched version used by 6.1.4.
- The audit wrapper excludes only minimatch **3.1.5** for
  [GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249):
  that legacy version lacks the affected optimization algorithm. Affected
  minimatch 10 is upgraded through a targeted override. Other findings still fail.
- Installed declaration checks use `skipLibCheck: false`. Drizzle 0.45's own
  cross-dialect declaration errors are excluded; errors in toolkit declarations,
  other dependencies, and consumer code still fail. SQLite ships its required
  `@types/better-sqlite3` dependency.

Release workflows audit dependencies, refresh the lockfile after versioning,
then rebuild and check the versioned packages before publishing. `test:release`
rehearses a coordinated major release in a temporary directory without publishing.

## License

ISC
