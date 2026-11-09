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

Requires Node.js >= 22. Developing this repository requires Node.js >= 26.13 and the Bun version pinned in `package.json`.

## Development

```bash
npm install --global "bun@$(cat .bun-version)"
bun install --frozen-lockfile
bun run build
bun run test
bun run lint:check
bun run format:check
bun run typecheck
bun run test:dependency-policy
bun run audit:dependencies
bun run test:release
bun run test:package:prepare
bun run test:package
```

The workspace and `docs-site` have separate `bun.lock` files and installs. Run
`cd docs-site && bun install --frozen-lockfile && bun run build` for documentation.
Commit both lockfiles when their dependencies change. CI installs the exact npm
build recorded in `.bun-version`; `bun --version` alone omits the npm build suffix.
Native linting reads `.oxlintrc.json`; `--no-script` prevents lint script recursion.
Formatting and format checks share the TypeScript/TSX/Markdown scope, preserve
existing style, and skip generated Changesets changelogs. Import and manifest
sorting are disabled. Use `bun run lint:fix` only for intentional edits.

`bun run test:coverage` uses native Bun LCOV output and enforces 100% line/function
coverage per source file. The checker preserves existing V8 exclusion comments
and treats empty-object parameter defaults as parameter branches, matching the
previous line-coverage semantics. Bun does not expose statement/branch counters;
those former V8 thresholds cannot be enforced. Each package has a `bunfig.toml`
because Bun loads test settings from the working directory.

### Dependency updates

[Renovate](https://docs.renovatebot.com/) manages workspace dependencies, the
separate documentation project, Bun versions, and GitHub Actions through
[`renovate.json`](./renovate.json). The policy follows `comic-vine` and
`iracing-data-client`, adapted to this monorepo:

- Ordinary updates run between midnight and 06:00 Europe/London, with at most
  five open PRs and two new PRs per hour. The Dependency Dashboard tracks updates.
- Both Bun installs and Renovate updates enforce a one-day release age, including
  transitive dependencies and frozen lockfiles; missing publication dates fail
  closed. Local registry tests verify this policy. Selected stable development-tool patches wait three
  days and can automerge after CI passes. Runtime, documentation, shared-config,
  peer, compiler, Bun, and major updates require review.
- The Bun manager updates manifests and their matching lockfiles in each PR.
  CI runs `node scripts/check-bun-version.mjs` before installing dependencies to
  ensure `.bun-version` matches the root, workspace, and docs declarations.
- Lockfile maintenance runs in the same overnight window, gets priority, and
  requires review. Security alert PRs bypass Renovate's schedule and release-age
  delay but still require review; installs continue to enforce the Bun policy.
- Node engines and the CI runtime remain deliberate decisions; Node types follow
  the Node 26 development runtime. Peer dependency ranges are widened to preserve
  consumer support.

CI builds the library and documentation on Node 26. Installed ESM and CommonJS
packages are tested on every supported stable Node line: 22, 24, and 26.
Unit tests run on the pinned Bun build. Installed package checks run on Node
and validate ESM and CommonJS behavior and declaration resolution. Keep it current with the
[Node.js release schedule](https://nodejs.org/en/about/previous-releases). Renovate configuration
changes also run the [strict config validator](https://docs.renovatebot.com/config-validation/).
Consumer-facing dependency updates need an appropriate changeset before merging
so the release workflow publishes the affected packages.

The Renovate GitHub App must have access to this repository. The active `Required CI on main` ruleset
requires `validate`, `docs`, and every `consumers` matrix check against the current
base branch. Only `github-actions[bot]` bypasses this rule so the release workflow
can push its validated version commits. The path-filtered `validate-renovate`
check only runs when its configuration changes.

### Compatibility exceptions

- TypeScript 7 generates declarations and builds the shared configuration. The
  `@typescript/typescript6` compatibility package supplies the compiler API for
  coverage analysis and installed-consumer checks. Source and test typechecks use
  native `bun check`. Node types follow Node 26.
- `rimraf` uses the patched glob 14 release through an override. The minimatch
  override applies only to glob 14 so legacy glob keeps its compatible API.
- The audit wrapper excludes only minimatch **3.1.5** for
  [GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249):
  that legacy version lacks the affected optimization algorithm. Affected
  versions of minimatch remain blocked. Other findings still fail.
- Installed declaration checks use `skipLibCheck: false`. Drizzle 0.45's own
  cross-dialect declaration errors are excluded; errors in toolkit declarations,
  other dependencies, and consumer code still fail. SQLite ships its required
  `@types/better-sqlite3` dependency.

Release workflows audit dependencies, refresh the lockfile after versioning,
then rebuild and check the versioned packages before publishing. Bun packs
workspace ranges into verified tarballs; Changesets publishes those artifacts
through npm, preserving provenance, access, release ordering and tags. `test:release`
rehearses a coordinated major release in a temporary directory without publishing.

## License

ISC
