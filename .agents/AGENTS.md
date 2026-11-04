# AGENTS

## Project Overview

HTTP Client Toolkit — a TypeScript monorepo providing pluggable HTTP caching, request deduplication, and rate limiting with swappable storage backends.

## Monorepo Structure

**Bun** workspaces + **Turborepo** for build orchestration. All packages under `packages/`.

| Package                   | Scope                                 | Description                                              |
| ------------------------- | ------------------------------------- | -------------------------------------------------------- |
| `packages/core`           | `@http-client-toolkit/core`           | Core HTTP client, interfaces, and adaptive rate limiting |
| `packages/store-memory`   | `@http-client-toolkit/store-memory`   | In-memory store (Map-based, LRU eviction)                |
| `packages/store-sqlite`   | `@http-client-toolkit/store-sqlite`   | SQLite store via better-sqlite3 + Drizzle ORM            |
| `packages/store-dynamodb` | `@http-client-toolkit/store-dynamodb` | DynamoDB store via AWS SDK v3                            |
| `packages/tsdown-config`  | `@repo/tsdown-config`                 | Shared tsdown build config (private)                     |

Use the exact Bun npm build pinned in `.bun-version` and `packageManager`.
Keep workspace and docs installs separate, preserve the strict release-age scanner,
and commit both Bun lockfiles. Changesets continues to publish through npm.

## Commands

```bash
bun run build            # Build all packages (turbo)
bun run test             # Run all tests (turbo)
bun run test:coverage    # Tests with native Bun coverage
bun run lint             # Check lint without edits
bun run lint:check       # Check lint without edits (CI)
bun run typecheck        # Typecheck library sources and tests
bun run test:package     # Check prepared tarballs as installed consumers
bun run test:release     # Rehearse versioning and packing without publishing
bun run test:dependency-policy # Verify release-age enforcement
bun run audit:dependencies # Audit with the documented minimatch exception
bun run lint:fix         # Lint + auto-fix
bun run format           # bun fmt format (ts, tsx, md)
bun run changeset        # Create a changeset for versioning
bun run release          # Build + publish via changesets
```

Per-package: `bun run --filter @http-client-toolkit/core test`

## Architecture

The core `HttpClient` orchestrates three pluggable concerns:

1. **Cache** — check cache → return hit or proceed
2. **Dedup** — atomic `registerOrJoin()` → owner fetches, joiners wait
3. **Rate limit** — basic sliding-window or adaptive priority-aware
4. **Fetch** → parse → optional `responseTransformer` → optional `responseHandler` → cache result

### Key Interfaces (in `packages/core/src/`)

- **CacheStore\<T\>**: `get`, `set` (with TTL), `delete`, `clear`
- **DedupeStore\<T\>**: `registerOrJoin` (atomic ownership), `waitFor`, `complete`, `fail`
- **RateLimitStore**: `canProceed`, `record`, `acquire` (optional atomic), `getWaitTime`, `getStatus`
- **AdaptiveRateLimitStore**: extends RateLimitStore with `priority: 'user' | 'background'`
- **HttpClientContract**: `get<Result>(url, options?)` → typed result or throws `HttpClientError`

### Store Implementation Pattern

Each store backend implements the same interfaces. New backends follow this pattern:

- Implement `CacheStore`, `DedupeStore`, and/or `RateLimitStore` from core
- Use Zod for config validation
- Export from a single `src/index.ts` entry point

## Code Conventions

- **TypeScript strict mode**, `@types/node` v24, Node >= 22 for consumers; Node >= 24.11 for development
- **ESM + CJS dual exports** via tsdown (`lib/index.js` + `lib/index.cjs`)
- **Bun** — tests colocated in `src/`, 100% per-file line/function coverage via the LCOV checker (see README for Bun coverage limits)
- **bun lint** with `.oxlintrc.json` and `eslint-plugin-import`; **bun fmt** with explicit style in `bunfig.toml`
- **Zod** for runtime schema validation (configs, inputs)
- **Changesets** for versioning; **Husky** for git hooks

## Testing

- Tests live alongside source: `src/**/*.test.ts`
- **Core**: restored native fetch spies and strict HTTP fixtures
- **DynamoDB**: `aws-sdk-client-mock` command-call assertions
- **Memory/SQLite**: Direct instance testing
- Time mocking: `vi.spyOn(Date, 'now').mockReturnValue(fixedTimestamp)` for TTL tests
- **Always clean up in `afterEach()`** — stores have timers that cause test pollution if leaked

## Important Implementation Details

### Cache TTL Semantics (all backends)

- `ttlSeconds > 0`: expires after N seconds
- `ttlSeconds === 0`: never expires (permanent)
- `ttlSeconds < 0`: already expired (immediate removal)

### Dedup Ownership

- `registerOrJoin()` returns `{ jobId, isOwner }` — only the owner makes the HTTP call
- Non-owners `waitFor()` the result; failed jobs resolve as `undefined` (not thrown)

### Rate Limiting

- Sliding window: tracks request timestamps per resource
- Server hints (429, 503, Retry-After) trigger origin-level cooldowns
- Adaptive mode monitors user activity over configurable window (default 15min) with 4 strategies

### Request Hashing

- Deterministic SHA-256 via `hashRequest(endpoint, params)`
- Sorts keys, normalizes primitives (`10` and `"10"` hash identically)
- `undefined` omitted, `null` preserved

### Memory Management

- In-memory stores have cleanup timers — call `.destroy()` to prevent event-loop leaks
- Timers use `unref()` so stores don't keep the process alive

### DynamoDB

- Single table design: `pk`/`sk` partition + sort keys, GSI1 for queries
- Native TTL on `ttl` attribute; max 400KB per item
- Batch writes: exponential backoff with jitter, max 8 retries
- Conditional writes for atomics; detect failures via `isConditionalTransactionFailure()`

## Build Config

- tsdown: ESM + CJS, dts, sourcemaps, treeshake, target es2015, output to `lib/`
- Bun: explicit `bun:test` imports; coverage settings in each package `bunfig.toml`
- Build order matters: core must build before store packages

## Git Conventions

- Conventional commits with scope: `feat(core):`, `fix(store-dynamodb):`, `perf(store-memory):`
- Changesets for versioning — run `bun run changeset` before PR
- Pre-push hook runs build, lint and tests
