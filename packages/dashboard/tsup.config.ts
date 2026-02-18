import { defineConfig } from 'tsup';
import { sharedTsupConfig } from '@repo/tsup-config';

export default defineConfig({
  ...sharedTsupConfig,
  target: 'node20',
  external: [
    '@http-client-toolkit/store-memory',
    '@http-client-toolkit/store-sqlite',
    '@http-client-toolkit/store-dynamodb',
    'react',
    'react-dom',
  ],
});
