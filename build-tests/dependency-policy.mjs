import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve('.');
// Use the already selected pnpm binary; a fake registry cannot serve pnpm itself.
const manager = process.env.npm_execpath;
assert.ok(manager, 'Run this check through pnpm test:dependency-policy');
const temporary = await mkdtemp(join(tmpdir(), 'toolkit-age-policy-'));
const now = Date.now();
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const name = url.pathname.split('/').pop();
  if (!['age-policy-probe', 'age-policy-transitive'].includes(name)) {
    response.writeHead(404).end();
    return;
  }
  const metadata = { name, 'dist-tags': { latest: '1.0.1' }, versions: {} };
  for (const version of ['1.0.0', '1.0.1']) {
    metadata.versions[version] = {
      name,
      version,
      dist: {
        tarball: `http://127.0.0.1:${server.address().port}/${name}-${version}.tgz`,
        integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
      },
      ...(name === 'age-policy-probe'
        ? {
            dependencies: {
              'age-policy-transitive': url.pathname.startsWith(
                '/fresh-transitive/',
              )
                ? '1.0.1'
                : '*',
            },
          }
        : {}),
    };
  }
  if (!url.pathname.startsWith('/missing-time/'))
    metadata.time = {
      '1.0.0': new Date(now - 48 * 60 * 60 * 1000).toISOString(),
      '1.0.1': new Date(now - 60 * 60 * 1000).toISOString(),
    };
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(metadata));
});

async function install(cwd, options) {
  const child = spawn(
    manager,
    ['install', '--lockfile-only', '--ignore-scripts', ...options],
    {
      cwd,
      env: { ...process.env, CI: 'true' },
    },
  );
  let output = '';
  child.stdout.on('data', (data) => (output += data));
  child.stderr.on('data', (data) => (output += data));
  const [code] = await once(child, 'close');
  return { code, output };
}

server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  for (const project of ['.', 'docs-site']) {
    for (const scenario of [
      'range',
      'exact',
      'missing-time',
      'frozen',
      'fresh-transitive',
    ]) {
      const cwd = join(temporary, project, scenario);
      await mkdir(cwd, { recursive: true });
      await copyFile(
        join(root, project, 'pnpm-workspace.yaml'),
        join(cwd, 'pnpm-workspace.yaml'),
      );
      await writeFile(
        join(cwd, 'package.json'),
        JSON.stringify({
          private: true,
          dependencies: {
            'age-policy-probe': scenario === 'exact' ? '1.0.1' : '*',
          },
        }),
      );
      const prefix = ['missing-time', 'fresh-transitive'].includes(scenario)
        ? `${scenario}/`
        : '';
      const options = [
        `--registry=http://127.0.0.1:${server.address().port}/${prefix}`,
        `--store-dir=${join(cwd, 'store')}`,
        `--config.cacheDir=${join(cwd, 'cache')}`,
      ];
      let result = await install(cwd, options);
      if (scenario === 'range' || scenario === 'frozen') {
        assert.equal(result.code, 0, result.output);
        const lockPath = join(cwd, 'pnpm-lock.yaml');
        const lock = await readFile(lockPath, 'utf8');
        for (const name of ['age-policy-probe', 'age-policy-transitive']) {
          assert.ok(lock.includes(`${name}@1.0.0`), lock);
          assert.ok(!lock.includes(`${name}@1.0.1`), lock);
        }
        if (scenario === 'frozen') {
          // A contributed lockfile must not bypass the install policy.
          await writeFile(lockPath, lock.replaceAll('1.0.0', '1.0.1'));
          result = await install(cwd, [...options, '--frozen-lockfile']);
        }
      }
      if (scenario !== 'range') {
        assert.notEqual(result.code, 0, result.output);
        assert.match(
          result.output,
          scenario === 'missing-time'
            ? /MISSING_TIME|publish.*time/i
            : /RELEASE_AGE|minimumReleaseAge|NO_MATCHING_VERSION|too (new|recent)/i,
        );
      }
      console.log(`Release-age policy passed: ${project} / ${scenario}`);
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await rm(temporary, { recursive: true, force: true });
}
