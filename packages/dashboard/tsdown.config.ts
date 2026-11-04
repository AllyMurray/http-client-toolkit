import { defineConfig } from 'tsdown';
import { sharedTsdownConfig } from '@repo/tsdown-config';

export default defineConfig({
  ...sharedTsdownConfig,
  target: 'node22',
  deps: {
    ...sharedTsdownConfig.deps,
    alwaysExternal: [
      '@http-client-toolkit/store-memory',
      '@http-client-toolkit/store-sqlite',
      '@http-client-toolkit/store-dynamodb',
      'react',
      'react-dom',
    ],
  },
});
