import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const destination = resolve('.package-tests');
mkdirSync(destination, { recursive: true });
for (const directory of readdirSync('packages')) {
  const cwd = join('packages', directory);
  const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
  if (!manifest.private)
    execFileSync('bun', ['pm', 'pack', '--destination', destination], {
      cwd,
      stdio: 'inherit',
    });
}
