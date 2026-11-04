import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { test } from 'node:test';
import { ignoredLines } from '../scripts/check-coverage.mjs';

const checker = resolve('scripts/check-coverage.mjs');
test('preserves counted and block V8 exclusions without skipping later lines', () => {
  assert.deepEqual(
    [
      ...ignoredLines(
        'a\n/* v8 ignore next 2 */\nb\nc\nd\n/* v8 ignore start */\ne\n/* v8 ignore stop */\nf',
      ),
    ],
    [3, 4, 6, 7, 8],
  );
});
test('coverage gate rejects uncovered source lines and function totals', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'toolkit-coverage-'));
  try {
    writeFileSync(
      join(cwd, 'bunfig.toml'),
      '[test]\ncoveragePathIgnorePatterns = []\n',
    );
    mkdirSync(join(cwd, 'src'));
    mkdirSync(join(cwd, 'coverage'));
    writeFileSync(
      join(cwd, 'src/example.ts'),
      'export function example() { return 1; }\n',
    );
    const check = (record) => {
      writeFileSync(
        join(cwd, 'coverage/lcov.info'),
        `SF:src/example.ts\n${record}\nend_of_record\n`,
      );
      return spawnSync(process.execPath, [checker], { cwd, encoding: 'utf8' });
    };
    assert.equal(check('FNF:1\nFNH:1\nDA:1,1').status, 0);
    writeFileSync(
      join(cwd, 'src/unimported.ts'),
      'export const uncovered = 1;\n',
    );
    assert.notEqual(check('FNF:1\nFNH:1\nDA:1,1').status, 0);
    rmSync(join(cwd, 'src/unimported.ts'));
    assert.notEqual(check('FNF:1\nFNH:0\nDA:1,1').status, 0);
    assert.notEqual(check('FNF:1\nFNH:1\nDA:1,0').status, 0);
    assert.notEqual(check('DA:1,1').status, 0);
    writeFileSync(
      join(cwd, 'src/example.ts'),
      '/* v8 ignore start */\nexport const defensive = () => {\n return 1;\n};\n/* v8 ignore stop */\n',
    );
    assert.equal(check('FNF:1\nFNH:0\nDA:2,0\nDA:3,0').status, 0);
    // Empty/missing source inventories must fail closed.
    writeFileSync(join(cwd, 'coverage/lcov.info'), '');
    assert.throws(() =>
      execFileSync(process.execPath, [checker], { cwd, stdio: 'pipe' }),
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
