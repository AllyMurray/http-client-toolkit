import { HttpClient } from '@http-client-toolkit/core';
import {
  InMemoryCacheStore,
  InMemoryDedupeStore,
} from '@http-client-toolkit/store-memory';
import { describe, it, expect, afterEach } from 'vitest';
import {
  validateDashboardOptions,
  validateStandaloneOptions,
  normalizeClient,
} from './config.js';

let stores: Array<{ destroy(): void }> = [];

function trackedStore<T extends { destroy(): void }>(store: T): T {
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const s of stores) s.destroy();
  stores = [];
});

function makeClient(opts: { name: string; cache?: boolean; dedupe?: boolean }) {
  return new HttpClient({
    name: opts.name,
    cache:
      opts.cache !== false
        ? { store: trackedStore(new InMemoryCacheStore()) }
        : undefined,
    dedupe: opts.dedupe ? trackedStore(new InMemoryDedupeStore()) : undefined,
  });
}

describe('validateDashboardOptions', () => {
  it('should accept HttpClient with name', () => {
    const client = makeClient({ name: 'test' });
    const opts = validateDashboardOptions({
      clients: [{ client }],
    });
    expect(opts.basePath).toBe('/');
    expect(opts.pollIntervalMs).toBe(5000);
    expect(opts.clients).toHaveLength(1);
  });

  it('should accept HttpClient with name override', () => {
    const client = makeClient({ name: 'original' });
    const opts = validateDashboardOptions({
      clients: [{ client, name: 'override' }],
    });
    const normalized = normalizeClient(opts.clients[0]!);
    expect(normalized.name).toBe('override');
  });

  it('should accept multiple clients', () => {
    const opts = validateDashboardOptions({
      clients: [
        { client: makeClient({ name: 'client-a' }) },
        { client: makeClient({ name: 'client-b' }) },
      ],
    });
    expect(opts.clients).toHaveLength(2);
  });

  it('should reject empty clients array', () => {
    expect(() => validateDashboardOptions({ clients: [] })).toThrow();
  });

  it('should reject missing clients', () => {
    expect(() => validateDashboardOptions({} as never)).toThrow();
  });

  it('should reject empty config name', () => {
    const client = makeClient({ name: 'test' });
    expect(() =>
      validateDashboardOptions({
        clients: [{ client, name: '' }],
      }),
    ).toThrow('Client name must not be empty');
  });

  it('should reject config name with invalid characters', () => {
    const client = makeClient({ name: 'test' });
    expect(() =>
      validateDashboardOptions({
        clients: [{ client, name: 'has spaces' }],
      }),
    ).toThrow('URL-safe');
  });

  it('should accept client names with hyphens, underscores, and alphanumerics', () => {
    const client = makeClient({ name: 'my-client_123' });
    const opts = validateDashboardOptions({
      clients: [{ client }],
    });
    const normalized = normalizeClient(opts.clients[0]!);
    expect(normalized.name).toBe('my-client_123');
  });

  it('should reject duplicate client names', () => {
    expect(() =>
      validateDashboardOptions({
        clients: [
          { client: makeClient({ name: 'dupe' }) },
          { client: makeClient({ name: 'dupe' }) },
        ],
      }),
    ).toThrow('unique');
  });

  it('should reject HttpClient with no stores', () => {
    const client = new HttpClient({ name: 'no-stores' });
    expect(() =>
      validateDashboardOptions({
        clients: [{ client }],
      }),
    ).toThrow('at least one store');
  });

  it('should accept custom basePath and pollInterval', () => {
    const opts = validateDashboardOptions({
      clients: [{ client: makeClient({ name: 'test' }) }],
      basePath: '/dashboard',
      pollIntervalMs: 10000,
    });
    expect(opts.basePath).toBe('/dashboard');
    expect(opts.pollIntervalMs).toBe(10000);
  });
});

describe('validateStandaloneOptions', () => {
  it('should accept valid standalone options with defaults', () => {
    const opts = validateStandaloneOptions({
      clients: [{ client: makeClient({ name: 'test' }) }],
    });
    expect(opts.port).toBe(4000);
    expect(opts.host).toBe('localhost');
  });

  it('should accept custom port and host', () => {
    const opts = validateStandaloneOptions({
      clients: [{ client: makeClient({ name: 'test' }) }],
      port: 8080,
      host: '0.0.0.0',
    });
    expect(opts.port).toBe(8080);
    expect(opts.host).toBe('0.0.0.0');
  });
});

describe('normalizeClient', () => {
  it('should extract stores from HttpClient', () => {
    const cache = trackedStore(new InMemoryCacheStore());
    const client = new HttpClient({ name: 'test', cache: { store: cache } });
    const normalized = normalizeClient({ client });
    expect(normalized.name).toBe('test');
    expect(normalized.cacheStore).toBe(cache);
    expect(normalized.dedupeStore).toBeUndefined();
    expect(normalized.rateLimitStore).toBeUndefined();
  });

  it('should prefer config name over client name', () => {
    const client = makeClient({ name: 'client-name' });
    const normalized = normalizeClient({ client, name: 'config-name' });
    expect(normalized.name).toBe('config-name');
  });
});
