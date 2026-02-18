import { describe, it, expect, beforeEach, afterEach, vi as _vi } from 'vitest';
import { InMemoryRateLimitStore } from './in-memory-rate-limit-store.js';

describe('InMemoryRateLimitStore', () => {
  let store: InMemoryRateLimitStore;
  const defaultConfig = { limit: 5, windowMs: 1000 };

  beforeEach(() => {
    store = new InMemoryRateLimitStore({ defaultConfig });
  });

  afterEach(() => {
    if (store) {
      store.destroy();
    }
  });

  describe('basic operations', () => {
    it('should allow requests within limit', async () => {
      const resource = 'test-resource';

      for (let i = 0; i < defaultConfig.limit; i++) {
        const canProceed = await store.canProceed(resource);
        expect(canProceed).toBe(true);
        await store.record(resource);
      }
    });

    it('should block requests over limit', async () => {
      const resource = 'test-resource';

      // Fill up the limit
      for (let i = 0; i < defaultConfig.limit; i++) {
        await store.record(resource);
      }

      const canProceed = await store.canProceed(resource);
      expect(canProceed).toBe(false);
    });

    it('should provide status information', async () => {
      const resource = 'test-resource';

      await store.record(resource);
      await store.record(resource);

      const status = await store.getStatus(resource);
      expect(status.remaining).toBe(defaultConfig.limit - 2);
      expect(status.limit).toBe(defaultConfig.limit);
      expect(status.resetTime).toBeInstanceOf(Date);
    });

    it('should calculate wait time correctly', async () => {
      const resource = 'test-resource';

      // Fill up the limit
      for (let i = 0; i < defaultConfig.limit; i++) {
        await store.record(resource);
      }

      const waitTime = await store.getWaitTime(resource);
      expect(waitTime).toBeGreaterThan(0);
      expect(waitTime).toBeLessThanOrEqual(defaultConfig.windowMs);
    });

    it('should return zero wait time when under limit', async () => {
      const resource = 'under-limit';
      await store.record(resource);

      await expect(store.getWaitTime(resource)).resolves.toBe(0);
    });

    it('should guard against malformed request entries in wait-time calculation', async () => {
      const resource = 'malformed';
      const privateStore = store as unknown as {
        limits: Map<
          string,
          {
            requests: Array<number>;
            limit: number;
            windowMs: number;
            resetTime: number;
          }
        >;
      };

      privateStore.limits.set(resource, {
        requests: [undefined as unknown as number],
        limit: 1,
        windowMs: 1000,
        resetTime: Date.now() + 1000,
      });

      await expect(store.getWaitTime(resource)).resolves.toBe(0);
    });

    it('should reset rate limits', async () => {
      const resource = 'test-resource';

      // Fill up the limit
      for (let i = 0; i < defaultConfig.limit; i++) {
        await store.record(resource);
      }

      expect(await store.canProceed(resource)).toBe(false);

      await store.reset(resource);

      expect(await store.canProceed(resource)).toBe(true);
    });
  });

  describe('sliding window behavior', () => {
    it('should allow requests again after window expires', async () => {
      const shortWindowStore = new InMemoryRateLimitStore({
        defaultConfig: { limit: 2, windowMs: 50 },
      });
      const resource = 'test-resource';

      try {
        // Fill up the limit
        await shortWindowStore.record(resource);
        await shortWindowStore.record(resource);

        expect(await shortWindowStore.canProceed(resource)).toBe(false);

        // Wait for window to expire
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(await shortWindowStore.canProceed(resource)).toBe(true);
      } finally {
        shortWindowStore.destroy();
      }
    });

    it('should maintain sliding window correctly', async () => {
      const shortWindowStore = new InMemoryRateLimitStore({
        defaultConfig: { limit: 3, windowMs: 100 },
      });
      const resource = 'test-resource';

      try {
        // Make 2 requests
        await shortWindowStore.record(resource);
        await shortWindowStore.record(resource);

        // Wait half the window time
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Make 1 more request (should be allowed)
        expect(await shortWindowStore.canProceed(resource)).toBe(true);
        await shortWindowStore.record(resource);

        // Should be at limit now
        expect(await shortWindowStore.canProceed(resource)).toBe(false);

        // Wait for first requests to expire
        await new Promise((resolve) => setTimeout(resolve, 60));

        // Should be able to make 2 more requests
        expect(await shortWindowStore.canProceed(resource)).toBe(true);
        await shortWindowStore.record(resource);
        expect(await shortWindowStore.canProceed(resource)).toBe(true);
      } finally {
        shortWindowStore.destroy();
      }
    });
  });

  describe('resource-specific configurations', () => {
    it('should use default config for unspecified resources', async () => {
      const resource = 'unknown-resource';

      const status = await store.getStatus(resource);
      expect(status.limit).toBe(defaultConfig.limit);
      expect(store.getResourceConfig(resource)).toEqual(defaultConfig);
    });

    it('should use resource-specific configs', async () => {
      const resourceConfigs = new Map([
        ['special-resource', { limit: 10, windowMs: 2000 }],
        ['limited-resource', { limit: 2, windowMs: 500 }],
      ]);

      const configStore = new InMemoryRateLimitStore({
        defaultConfig,
        resourceConfigs,
      });

      try {
        // Test special resource
        let status = await configStore.getStatus('special-resource');
        expect(status.limit).toBe(10);

        // Test limited resource
        status = await configStore.getStatus('limited-resource');
        expect(status.limit).toBe(2);

        // Test default resource
        status = await configStore.getStatus('default-resource');
        expect(status.limit).toBe(defaultConfig.limit);
      } finally {
        configStore.destroy();
      }
    });

    it('should apply different limits to different resources', async () => {
      const resourceConfigs = new Map([
        ['high-limit', { limit: 10, windowMs: 1000 }],
        ['low-limit', { limit: 2, windowMs: 1000 }],
      ]);

      const configStore = new InMemoryRateLimitStore({
        defaultConfig,
        resourceConfigs,
      });

      try {
        // High limit resource should allow more requests
        for (let i = 0; i < 10; i++) {
          expect(await configStore.canProceed('high-limit')).toBe(true);
          await configStore.record('high-limit');
        }
        expect(await configStore.canProceed('high-limit')).toBe(false);

        // Low limit resource should block earlier
        for (let i = 0; i < 2; i++) {
          expect(await configStore.canProceed('low-limit')).toBe(true);
          await configStore.record('low-limit');
        }
        expect(await configStore.canProceed('low-limit')).toBe(false);
      } finally {
        configStore.destroy();
      }
    });

    it('should update resource configs dynamically', async () => {
      const resource = 'dynamic-resource';

      // Start with default config
      let status = await store.getStatus(resource);
      expect(status.limit).toBe(defaultConfig.limit);

      // Update config
      store.setResourceConfig(resource, { limit: 20, windowMs: 5000 });

      // Should use new config
      status = await store.getStatus(resource);
      expect(status.limit).toBe(20);

      expect(store.getResourceConfig(resource)).toEqual({
        limit: 20,
        windowMs: 5000,
      });
    });
  });

  describe('statistics', () => {
    it('should provide accurate statistics', async () => {
      await store.record('resource1');
      await store.record('resource1');
      await store.record('resource2');

      const stats = store.getStats();
      expect(stats.totalResources).toBe(2);
      expect(stats.totalRequests).toBe(3);
    });

    it('should update statistics correctly', async () => {
      let stats = store.getStats();
      expect(stats.totalRequests).toBe(0);

      await store.record('test');
      stats = store.getStats();
      expect(stats.totalRequests).toBe(1);

      await store.reset('test');
      stats = store.getStats();
      expect(stats.totalRequests).toBe(0);
    });

    it('counts rate-limited resources in stats', async () => {
      const resource = 'limited';

      for (let i = 0; i < defaultConfig.limit; i++) {
        await store.record(resource);
      }

      const stats = store.getStats();
      expect(stats.rateLimitedResources).toBeGreaterThanOrEqual(1);
    });
  });

  describe('listResources', () => {
    it('should return an empty array when no resources tracked', () => {
      const resources = store.listResources();
      expect(resources).toEqual([]);
    });

    it('should list tracked resources', async () => {
      await store.record('resource-a');
      await store.record('resource-a');
      await store.record('resource-b');

      const resources = store.listResources();
      expect(resources).toHaveLength(2);

      const resourceA = resources.find((r) => r.resource === 'resource-a');
      const resourceB = resources.find((r) => r.resource === 'resource-b');

      expect(resourceA).toBeDefined();
      expect(resourceA!.requestCount).toBe(2);
      expect(resourceA!.limit).toBe(defaultConfig.limit);
      expect(resourceA!.windowMs).toBe(defaultConfig.windowMs);

      expect(resourceB).toBeDefined();
      expect(resourceB!.requestCount).toBe(1);
    });

    it('should reflect resource-specific configs', async () => {
      store.setResourceConfig('custom', { limit: 100, windowMs: 5000 });
      await store.record('custom');

      const resources = store.listResources();
      const custom = resources.find((r) => r.resource === 'custom');
      expect(custom).toBeDefined();
      expect(custom!.limit).toBe(100);
      expect(custom!.windowMs).toBe(5000);
    });
  });

  describe('edge cases', () => {
    it('should handle zero limit', async () => {
      const zeroLimitStore = new InMemoryRateLimitStore({
        defaultConfig: { limit: 0, windowMs: 1000 },
      });

      try {
        const canProceed = await zeroLimitStore.canProceed('test');
        expect(canProceed).toBe(false);

        const waitTime = await zeroLimitStore.getWaitTime('test');
        expect(waitTime).toBeGreaterThan(0);
      } finally {
        zeroLimitStore.destroy();
      }
    });

    it('should handle very small window', async () => {
      const smallWindowStore = new InMemoryRateLimitStore({
        defaultConfig: { limit: 5, windowMs: 1 },
      });

      try {
        await smallWindowStore.record('test');

        // Wait for window to expire
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(await smallWindowStore.canProceed('test')).toBe(true);
      } finally {
        smallWindowStore.destroy();
      }
    });

    it('should handle very large window', async () => {
      const largeWindowStore = new InMemoryRateLimitStore({
        defaultConfig: { limit: 1, windowMs: 86400000 },
      }); // 1 day

      try {
        await largeWindowStore.record('test');
        expect(await largeWindowStore.canProceed('test')).toBe(false);

        const waitTime = await largeWindowStore.getWaitTime('test');
        expect(waitTime).toBeGreaterThan(86400000 - 1000); // Almost a full day
      } finally {
        largeWindowStore.destroy();
      }
    });

    it('should handle many concurrent requests', async () => {
      const promises: Array<Promise<void>> = [];
      const resource = 'concurrent-test';

      // Make many concurrent requests
      for (let i = 0; i < 20; i++) {
        promises.push(store.record(resource));
      }

      await Promise.all(promises);

      const status = await store.getStatus(resource);
      expect(status.remaining).toBe(Math.max(0, defaultConfig.limit - 20));
    });

    it('should handle special characters in resource names', async () => {
      const specialResource = 'resource-with-特殊字符-and-émojis-🚀';

      expect(await store.canProceed(specialResource)).toBe(true);
      await store.record(specialResource);

      const status = await store.getStatus(specialResource);
      expect(status.remaining).toBe(defaultConfig.limit - 1);
    });

    it('should handle reset of non-existent resource', async () => {
      await expect(store.reset('non-existent')).resolves.not.toThrow();
    });

    it('should handle status of non-existent resource', async () => {
      const status = await store.getStatus('non-existent');
      expect(status.remaining).toBe(defaultConfig.limit);
      expect(status.limit).toBe(defaultConfig.limit);
    });
  });

  describe('cleanup', () => {
    it('should clean up expired entries', async () => {
      const cleanupStore = new InMemoryRateLimitStore({
        defaultConfig: { limit: 5, windowMs: 50 },
        cleanupIntervalMs: 10,
      });

      try {
        await cleanupStore.record('test');

        // Wait for cleanup
        await new Promise((resolve) => setTimeout(resolve, 100));

        const stats = cleanupStore.getStats();
        expect(stats.totalRequests).toBe(0);
      } finally {
        cleanupStore.destroy();
      }
    });

    it('should not clean up active entries', async () => {
      const cleanupStore = new InMemoryRateLimitStore({
        defaultConfig: { limit: 5, windowMs: 5000 },
        cleanupIntervalMs: 10,
      });

      try {
        await cleanupStore.record('test');

        // Wait for cleanup to run
        await new Promise((resolve) => setTimeout(resolve, 50));

        const stats = cleanupStore.getStats();
        expect(stats.totalRequests).toBe(1);
      } finally {
        cleanupStore.destroy();
      }
    });

    it('should handle cleanup interval of 0 (disabled)', async () => {
      const noCleanupStore = new InMemoryRateLimitStore({
        defaultConfig,
        cleanupIntervalMs: 0,
      });

      try {
        await noCleanupStore.record('test');
        const status = await noCleanupStore.getStatus('test');
        expect(status.remaining).toBe(defaultConfig.limit - 1);
      } finally {
        noCleanupStore.destroy();
      }
    });
  });

  describe('cooldown management', () => {
    it('should store a cooldown via setCooldown', async () => {
      const cooldownUntil = Date.now() + 60_000;
      await store.setCooldown('api.example.com', cooldownUntil);

      const result = await store.getCooldown('api.example.com');
      expect(result).toBe(cooldownUntil);
    });

    it('should return the cooldown timestamp from getCooldown', async () => {
      const cooldownUntil = Date.now() + 30_000;
      await store.setCooldown('origin-a', cooldownUntil);

      const result = await store.getCooldown('origin-a');
      expect(result).toBe(cooldownUntil);
    });

    it('should return undefined from getCooldown when cooldown has expired', async () => {
      const pastTimestamp = Date.now() - 1000; // already expired
      await store.setCooldown('expired-origin', pastTimestamp);

      const result = await store.getCooldown('expired-origin');
      expect(result).toBeUndefined();
    });

    it('should return undefined from getCooldown when no cooldown is set', async () => {
      const result = await store.getCooldown('unknown-origin');
      expect(result).toBeUndefined();
    });

    it('should remove a cooldown via clearCooldown', async () => {
      const cooldownUntil = Date.now() + 60_000;
      await store.setCooldown('origin-to-clear', cooldownUntil);

      // Confirm it's set
      expect(await store.getCooldown('origin-to-clear')).toBe(cooldownUntil);

      await store.clearCooldown('origin-to-clear');

      expect(await store.getCooldown('origin-to-clear')).toBeUndefined();
    });

    it('should clear cooldowns when clear() is called', async () => {
      await store.setCooldown('origin-1', Date.now() + 60_000);
      await store.setCooldown('origin-2', Date.now() + 60_000);

      store.clear();

      expect(await store.getCooldown('origin-1')).toBeUndefined();
      expect(await store.getCooldown('origin-2')).toBeUndefined();
    });
  });

  describe('destroy', () => {
    it('should clear all data when destroyed', async () => {
      await store.record('test1');
      await store.record('test2');

      store.destroy();

      const stats = store.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalResources).toBe(0);
    });

    it('should be safe to call destroy multiple times', () => {
      expect(() => {
        store.destroy();
        store.destroy();
      }).not.toThrow();
    });

    it('should handle operations after destroy', async () => {
      store.destroy();

      // Should work without throwing
      expect(await store.canProceed('test')).toBe(true);
      await store.record('test');

      const status = await store.getStatus('test');
      expect(status.remaining).toBe(defaultConfig.limit - 1);
    });
  });
});
