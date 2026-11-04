import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Exercise Changesets and pnpm on an isolated major-release candidate. Nothing
// is committed, pushed, tagged, or published by this check.
const root = resolve('.');
const candidate = mkdtempSync(join(tmpdir(), 'toolkit-release-'));
const run = (command, args) =>
  execFileSync(command, args, {
    cwd: candidate,
    encoding: 'utf8',
    env: { ...process.env, HUSKY: '0', CI: 'true' },
  });
try {
  for (const file of [
    'package.json',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    '.changeset/config.json',
  ]) {
    mkdirSync(join(candidate, file, '..'), { recursive: true });
    cpSync(join(root, file), join(candidate, file));
  }
  const published = [];
  for (const directory of readdirSync(join(root, 'packages'))) {
    const relative = join('packages', directory);
    mkdirSync(join(candidate, relative), { recursive: true });
    cpSync(
      join(root, relative, 'package.json'),
      join(candidate, relative, 'package.json'),
    );
    const pkg = JSON.parse(readFileSync(join(root, relative, 'package.json')));
    if (!pkg.private) {
      published.push({ directory, ...pkg });
      cpSync(join(root, relative, 'lib'), join(candidate, relative, 'lib'), {
        recursive: true,
      });
      if (directory === 'dashboard')
        cpSync(
          join(root, relative, 'dist'),
          join(candidate, relative, 'dist'),
          { recursive: true },
        );
    }
  }
  const expectedVersion = `${Math.max(...published.map((p) => Number(p.version.split('.')[0]))) + 1}.0.0`;
  writeFileSync(
    join(candidate, '.changeset/test-major.md'),
    '---\n"@http-client-toolkit/core": major\n---\n\nTest major release.\n',
  );
  run(resolve('node_modules/.bin/changeset'), ['version']);
  run('pnpm', ['install', '--lockfile-only', '--ignore-scripts']);
  run('pnpm', [
    'install',
    '--lockfile-only',
    '--frozen-lockfile',
    '--ignore-scripts',
  ]);
  run('pnpm', [
    '--filter',
    '@http-client-toolkit/*',
    'pack',
    '--pack-destination',
    '.package-tests',
  ]);
  for (const pkg of published) {
    const filename = `${pkg.name.replace('@', '').replace('/', '-')}-${expectedVersion}.tgz`;
    const manifest = JSON.parse(
      run('tar', [
        '-xOf',
        join('.package-tests', filename),
        'package/package.json',
      ]),
    );
    assert.equal(manifest.version, expectedVersion);
    for (const group of ['dependencies', 'peerDependencies']) {
      for (const [name, range] of Object.entries(manifest[group] ?? {})) {
        assert.ok(
          !range.startsWith('workspace:'),
          `${name} leaked a workspace range`,
        );
        if (name.startsWith('@http-client-toolkit/')) {
          assert.equal(
            range,
            group === 'peerDependencies'
              ? `^${expectedVersion}`
              : expectedVersion,
          );
        }
      }
    }
  }
  // Installing the unpublished version is essential: testing only the current
  // published version can accidentally use registry copies of internal packages.
  console.log(
    run(process.execPath, [join(root, 'build-tests/installed-package.mjs')]),
  );
  console.log(
    `Major release rehearsal passed: ${published.length} packages at ${expectedVersion}, frozen lockfile, packed internal ranges, installed runtime and declarations verified`,
  );
} finally {
  rmSync(candidate, { recursive: true, force: true });
}
