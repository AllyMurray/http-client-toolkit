import type { RateLimitStore } from '@http-client-toolkit/core';
import { describe, it, expect } from 'vitest';
import { createGenericRateLimitAdapter } from './generic.js';

const mockStore: RateLimitStore = {
  canProceed: async () => true,
  record: async () => {},
  getStatus: async () => ({ remaining: 10, resetTime: new Date(), limit: 100 }),
  reset: async () => {},
  getWaitTime: async () => 0,
};

describe('createGenericRateLimitAdapter', () => {
  it('should return generic type', () => {
    const adapter = createGenericRateLimitAdapter(mockStore);
    expect(adapter.type).toBe('generic');
  });

  it('should report limited capabilities', () => {
    const adapter = createGenericRateLimitAdapter(mockStore);
    expect(adapter.capabilities.canList).toBe(false);
    expect(adapter.capabilities.canGetStats).toBe(false);
    expect(adapter.capabilities.canUpdateConfig).toBe(false);
    expect(adapter.capabilities.canReset).toBe(true);
  });

  it('should return empty resources list', async () => {
    const adapter = createGenericRateLimitAdapter(mockStore);
    const resources = await adapter.listResources();
    expect(resources).toEqual([]);
  });

  it('should get resource status via core interface', async () => {
    const adapter = createGenericRateLimitAdapter(mockStore);
    const status = await adapter.getResourceStatus('any');
    expect(status.remaining).toBe(10);
    expect(status.limit).toBe(100);
  });

  it('should reset a resource', async () => {
    let resetCalled = false;
    const store: RateLimitStore = {
      ...mockStore,
      reset: async () => {
        resetCalled = true;
      },
    };
    const adapter = createGenericRateLimitAdapter(store);
    await adapter.resetResource('any');
    expect(resetCalled).toBe(true);
  });

  it('should throw on updateResourceConfig', async () => {
    const adapter = createGenericRateLimitAdapter(mockStore);
    await expect(
      adapter.updateResourceConfig('any', { limit: 5, windowMs: 1000 }),
    ).rejects.toThrow('Config updates not supported');
  });
});
