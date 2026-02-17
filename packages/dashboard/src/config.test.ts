import { describe, it, expect } from 'vitest';
import {
  validateDashboardOptions,
  validateStandaloneOptions,
} from './config.js';

describe('validateDashboardOptions', () => {
  it('should accept valid options with a cache store', () => {
    const opts = validateDashboardOptions({
      cacheStore: {
        get: async () => undefined,
        set: async () => {},
        delete: async () => {},
        clear: async () => {},
      },
    });
    expect(opts.basePath).toBe('/');
    expect(opts.pollIntervalMs).toBe(5000);
  });

  it('should reject options with no stores', () => {
    expect(() => validateDashboardOptions({})).toThrow('At least one store');
  });

  it('should accept custom basePath and pollInterval', () => {
    const opts = validateDashboardOptions({
      cacheStore: {
        get: async () => undefined,
        set: async () => {},
        delete: async () => {},
        clear: async () => {},
      },
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
      cacheStore: {
        get: async () => undefined,
        set: async () => {},
        delete: async () => {},
        clear: async () => {},
      },
    });
    expect(opts.port).toBe(4000);
    expect(opts.host).toBe('localhost');
  });

  it('should accept custom port and host', () => {
    const opts = validateStandaloneOptions({
      cacheStore: {
        get: async () => undefined,
        set: async () => {},
        delete: async () => {},
        clear: async () => {},
      },
      port: 8080,
      host: '0.0.0.0',
    });
    expect(opts.port).toBe(8080);
    expect(opts.host).toBe('0.0.0.0');
  });
});
