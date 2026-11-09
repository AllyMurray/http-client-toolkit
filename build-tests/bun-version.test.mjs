import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkBunVersions } from '../scripts/check-bun-version.mjs';

function fixture(t, pin = '1.4.4') {
  const root = mkdtempSync(join(tmpdir(), 'toolkit-bun-version-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, '.bun-version'), `${pin}\n`);
  for (const path of ['.', 'docs-site', 'packages/core', 'packages/store']) {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(
      join(root, path, 'package.json'),
      JSON.stringify({
        packageManager: `bun@${pin}`,
        workspaces: ['packages/*'],
      }),
    );
  }
  return root;
}

for (const pin of ['1.4.4', '1.4.4-canary.20261104.1']) {
  test(`accepts matching declarations for ${pin}`, (t) => {
    assert.deepEqual(checkBunVersions(fixture(t, pin)), { pin, count: 4 });
  });
}

for (const path of [
  'package.json',
  'docs-site/package.json',
  'packages/core/package.json',
]) {
  for (const packageManager of ['bun@1.4.3', undefined]) {
    test(`rejects ${packageManager ?? 'missing declaration'} in ${path}`, (t) => {
      const root = fixture(t);
      writeFileSync(
        join(root, path),
        JSON.stringify({ packageManager, workspaces: ['packages/*'] }),
      );
      assert.throws(
        () => checkBunVersions(root),
        (error) => {
          assert.ok(error.message.includes(path), error.message);
          assert.match(error.message, /expected bun@1\.4\.4/);
          return true;
        },
      );
    });
  }
}

test('rejects a changed runtime pin even when all manifests agree', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, '.bun-version'), '1.4.5\n');
  assert.throws(() => checkBunVersions(root), /expected bun@1\.4\.5/);
});

test('rejects an invalid runtime pin', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, '.bun-version'), 'latest\n');
  assert.throws(() => checkBunVersions(root), /Invalid Bun version pin/);
});
