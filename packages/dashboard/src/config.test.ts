import { describe, it, expect } from 'vitest';
import {
  validateDashboardOptions,
  validateStandaloneOptions,
} from './config.js';

const minimalCacheStore = {
  get: async () => undefined,
  set: async () => {},
  delete: async () => {},
  clear: async () => {},
};

describe('validateDashboardOptions', () => {
  it('should accept valid options with a single client', () => {
    const opts = validateDashboardOptions({
      clients: [{ name: 'test', cacheStore: minimalCacheStore }],
    });
    expect(opts.basePath).toBe('/');
    expect(opts.pollIntervalMs).toBe(5000);
    expect(opts.clients).toHaveLength(1);
    expect(opts.clients[0]!.name).toBe('test');
  });

  it('should accept multiple clients', () => {
    const opts = validateDashboardOptions({
      clients: [
        { name: 'client-a', cacheStore: minimalCacheStore },
        { name: 'client-b', cacheStore: minimalCacheStore },
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

  it('should reject empty client name', () => {
    expect(() =>
      validateDashboardOptions({
        clients: [{ name: '', cacheStore: minimalCacheStore }],
      }),
    ).toThrow('Client name must not be empty');
  });

  it('should reject client name with invalid characters', () => {
    expect(() =>
      validateDashboardOptions({
        clients: [{ name: 'has spaces', cacheStore: minimalCacheStore }],
      }),
    ).toThrow('URL-safe');
  });

  it('should accept client names with hyphens, underscores, and alphanumerics', () => {
    const opts = validateDashboardOptions({
      clients: [{ name: 'my-client_123', cacheStore: minimalCacheStore }],
    });
    expect(opts.clients[0]!.name).toBe('my-client_123');
  });

  it('should reject duplicate client names', () => {
    expect(() =>
      validateDashboardOptions({
        clients: [
          { name: 'dupe', cacheStore: minimalCacheStore },
          { name: 'dupe', cacheStore: minimalCacheStore },
        ],
      }),
    ).toThrow('unique');
  });

  it('should reject a client with no stores', () => {
    expect(() =>
      validateDashboardOptions({
        clients: [{ name: 'no-stores' }],
      }),
    ).toThrow('At least one store');
  });

  it('should accept custom basePath and pollInterval', () => {
    const opts = validateDashboardOptions({
      clients: [{ name: 'test', cacheStore: minimalCacheStore }],
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
      clients: [{ name: 'test', cacheStore: minimalCacheStore }],
    });
    expect(opts.port).toBe(4000);
    expect(opts.host).toBe('localhost');
  });

  it('should accept custom port and host', () => {
    const opts = validateStandaloneOptions({
      clients: [{ name: 'test', cacheStore: minimalCacheStore }],
      port: 8080,
      host: '0.0.0.0',
    });
    expect(opts.port).toBe(8080);
    expect(opts.host).toBe('0.0.0.0');
  });
});
