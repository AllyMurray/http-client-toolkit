import type { DedupeStore } from '@http-client-toolkit/core';
import { describe, it, expect } from 'vitest';
import { createGenericDedupeAdapter } from './generic.js';

const mockStore: DedupeStore = {
  register: async () => 'id',
  registerOrJoin: async () => ({ jobId: 'id', isOwner: true }),
  waitFor: async () => undefined,
  complete: async () => {},
  fail: async () => {},
  isInProgress: async () => false,
};

describe('createGenericDedupeAdapter', () => {
  it('should return generic type', () => {
    const adapter = createGenericDedupeAdapter(mockStore);
    expect(adapter.type).toBe('generic');
  });

  it('should report limited capabilities', () => {
    const adapter = createGenericDedupeAdapter(mockStore);
    expect(adapter.capabilities.canList).toBe(false);
    expect(adapter.capabilities.canGetStats).toBe(false);
  });

  it('should return empty jobs list', async () => {
    const adapter = createGenericDedupeAdapter(mockStore);
    const result = await adapter.listJobs(0, 10);
    expect(result.jobs).toEqual([]);
  });

  it('should return undefined for getJob', async () => {
    const adapter = createGenericDedupeAdapter(mockStore);
    const job = await adapter.getJob('any');
    expect(job).toBeUndefined();
  });
});
