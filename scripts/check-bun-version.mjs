import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function checkBunVersions(root) {
  const pin = readFileSync(resolve(root, '.bun-version'), 'utf8').trim();
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pin)) {
    throw new Error(`Invalid Bun version pin: ${JSON.stringify(pin)}`);
  }
  const readManifest = (path) =>
    JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const rootManifest = readManifest('package.json');
  const paths = [
    'package.json',
    'docs-site/package.json',
    ...globSync(
      rootManifest.workspaces.map((pattern) => `${pattern}/package.json`),
      { cwd: root },
    ),
  ];
  const expected = `bun@${pin}`;
  const mismatches = paths.flatMap((path) => {
    const actual = readManifest(path).packageManager;
    return actual === expected
      ? []
      : [`${path}: expected ${expected}, found ${actual ?? '(missing)'}`];
  });
  if (mismatches.length) {
    throw new Error(
      `Bun version declarations disagree:\n${mismatches.join('\n')}`,
    );
  }
  return { pin, count: paths.length };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { pin, count } = checkBunVersions(
    fileURLToPath(new URL('../', import.meta.url)),
  );
  console.log(`All ${count} packageManager declarations match Bun ${pin}.`);
}
