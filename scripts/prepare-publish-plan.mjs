import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Changesets falls back to npm for Bun workspaces. Supply Bun's tarballs so
// workspace ranges are resolved before npm handles trusted publishing/provenance.
const artifacts = resolve('.package-tests');
const filename = join(artifacts, 'publish-plan.json');
execFileSync(
  resolve('node_modules/.bin/changeset'),
  ['publish-plan', '--output', filename],
  { stdio: 'inherit' },
);
const plan = JSON.parse(readFileSync(filename, 'utf8'));
for (const release of plan.plan.flat()) {
  if (release.kind !== 'publish') continue;
  const path = `${release.name.replace('@', '').replace('/', '-')}-${release.version}.tgz`;
  const tarball = readFileSync(join(artifacts, path));
  const manifest = JSON.parse(
    execFileSync(
      'tar',
      ['-xOf', join(artifacts, path), 'package/package.json'],
      { encoding: 'utf8' },
    ),
  );
  assert.equal(manifest.name, release.name);
  assert.equal(manifest.version, release.version);
  for (const group of [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
  ])
    for (const range of Object.values(manifest[group] ?? {}))
      assert(
        !range.startsWith('workspace:'),
        'Unresolved workspace range in publish artifact',
      );
  release.tarball = {
    path,
    integrity: `sha256-${createHash('sha256').update(tarball).digest('base64')}`,
  };
}
writeFileSync(filename, JSON.stringify(plan, null, 2) + '\n');
console.log('Prepared npm publishing plan with verified Bun tarballs.');
