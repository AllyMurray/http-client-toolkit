import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from '@typescript/typescript6';

const require = createRequire(import.meta.url);
const manifest = require('../package.json');

// Install the tarballs outside the workspace so workspace links cannot hide
// missing exports, files, dependencies, or native bindings.
const artifacts = resolve('.package-tests');
const tarballs = readdirSync(artifacts)
  .filter((file) => file.endsWith('.tgz'))
  .map((file) => join(artifacts, file));
assert.equal(tarballs.length, 5, 'Run test:package:prepare after building');
const consumer = mkdtempSync(join(tmpdir(), 'http-client-toolkit-consumer-'));
const packed = tarballs.map((tarball) => ({
  tarball,
  manifest: JSON.parse(
    execFileSync('tar', ['-xOf', tarball, 'package/package.json'], {
      encoding: 'utf8',
    }),
  ),
}));

try {
  const overrides = { ...manifest.overrides };
  for (const { tarball, manifest: pkg } of packed)
    overrides[pkg.name] = `file:${tarball}`;
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({
      private: true,
      packageManager: manifest.packageManager,
      dependencies: Object.fromEntries([
        ...packed.map(({ tarball, manifest: pkg }) => [
          pkg.name,
          `file:${tarball}`,
        ]),
        ['@types/node', manifest.devDependencies['@types/node']],
      ]),
      overrides,
      trustedDependencies: manifest.trustedDependencies,
    }),
  );
  copyFileSync(
    new URL('../bunfig.toml', import.meta.url),
    join(consumer, 'bunfig.toml'),
  );
  mkdirSync(join(consumer, 'scripts'));
  copyFileSync(
    new URL('../scripts/release-age-scanner.mjs', import.meta.url),
    join(consumer, 'scripts/release-age-scanner.mjs'),
  );
  execFileSync('bun', ['install', '--production'], {
    cwd: consumer,
    stdio: 'inherit',
    env: { ...process.env, npm_config_engine_strict: 'true' },
  });
  const consumerRequire = createRequire(join(consumer, 'package.json'));
  const stagedCore = realpathSync(
    consumerRequire.resolve('@http-client-toolkit/core'),
  );
  for (const { manifest: pkg } of packed) {
    if (pkg.dependencies?.['@http-client-toolkit/core']) {
      const dependentRequire = createRequire(consumerRequire.resolve(pkg.name));
      assert.equal(
        realpathSync(dependentRequire.resolve('@http-client-toolkit/core')),
        stagedCore,
        `${pkg.name} must resolve the staged core tarball`,
      );
    }
  }
  copyFileSync(
    new URL('./consumer.mjs', import.meta.url),
    join(consumer, 'consumer.mjs'),
  );
  execFileSync(process.execPath, ['consumer.mjs'], {
    cwd: consumer,
    stdio: 'inherit',
  });
  // Resolve declarations from the installed package, without workspace paths or
  // skipLibCheck hiding missing files and mismatched ESM/CommonJS exports.
  for (const extension of ['mts', 'cts']) {
    copyFileSync(
      new URL('./consumer-types.ts', import.meta.url),
      join(consumer, `consumer.${extension}`),
    );
  }
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: ['node'],
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      },
      files: ['consumer.mts', 'consumer.cts'],
    }),
  );
  const config = ts.readConfigFile(
    join(consumer, 'tsconfig.json'),
    ts.sys.readFile,
  );
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, consumer);
  const host = ts.createCompilerHost(parsed.options);
  host.getCurrentDirectory = () => consumer;
  const program = ts.createProgram(parsed.fileNames, parsed.options, host);
  const diagnostics = [
    config.error,
    ...parsed.errors,
    ...ts.getPreEmitDiagnostics(program),
  ].filter(Boolean);
  // Drizzle 0.45 publishes cross-dialect declarations with known errors and
  // missing optional database drivers. Check every toolkit declaration and
  // consumer use site strictly, excluding only diagnostics in Drizzle's files.
  const upstream = diagnostics.filter((d) =>
    d.file?.fileName.replaceAll('\\', '/').includes('/drizzle-orm/'),
  );
  const failures = diagnostics.filter((d) => !upstream.includes(d));
  if (upstream.length)
    console.log(
      `Drizzle upstream declaration diagnostics excluded: ${upstream.length}`,
    );
  assert.equal(
    failures.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(failures, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => consumer,
      getNewLine: () => '\n',
    }),
  );
  console.log(
    `Node ${process.version}: installed ESM/CommonJS declarations passed`,
  );
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
