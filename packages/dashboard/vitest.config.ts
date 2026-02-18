import { defineConfig } from 'vitest/config';
import { sharedVitestConfig } from '@repo/vitest-config';

export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    coverage: {
      ...sharedVitestConfig.test?.coverage,
      include: ['src/server/**/*.ts', 'src/adapters/**/*.ts', 'src/config.ts'],
      exclude: [
        ...(sharedVitestConfig.test?.coverage?.exclude ?? []),
        'src/client/**',
      ],
    },
  },
});
