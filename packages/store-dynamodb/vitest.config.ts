import { defineConfig } from 'vitest/config';
import { sharedVitestConfig } from '@repo/vitest-config';

export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    setupFiles: ['./src/test/setup.ts'],
  },
});
