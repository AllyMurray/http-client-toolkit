export const sharedTsdownConfig = {
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'] as const,
  dts: true,
  outExtensions: ({ format }: { format: string }) =>
    format === 'cjs'
      ? { js: '.cjs', dts: '.d.cts' }
      : { js: '.js', dts: '.d.ts' },
  sourcemap: true,
  clean: true,
  outDir: 'lib',
  treeshake: true,
  minify: false,
  target: 'es2015' as const,
  tsconfig: './tsconfig.json',
  deps: { neverBundle: true },
};
