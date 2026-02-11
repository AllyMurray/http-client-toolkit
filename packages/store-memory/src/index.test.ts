import * as memory from './index.js';

describe('store-memory index exports', () => {
  it('re-exports in-memory store classes', () => {
    expect(memory.InMemoryCacheStore).toBeTypeOf('function');
    expect(memory.InMemoryDedupeStore).toBeTypeOf('function');
    expect(memory.InMemoryRateLimitStore).toBeTypeOf('function');
    expect(memory.AdaptiveRateLimitStore).toBeTypeOf('function');
  });
});
