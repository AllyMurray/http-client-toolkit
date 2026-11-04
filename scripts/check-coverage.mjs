import assert from 'node:assert/strict';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, matchesGlob } from 'node:path';

// Native Bun coverage does not understand the existing V8 exclusion comments.
// Retain their line/function exclusions and the former per-file 100% gate.
export function ignoredLines(source) {
  const ignored = new Set();
  const lines = source.split('\n');
  let inBlock = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/v8 ignore start/.test(line)) inBlock = true;
    if (inBlock) ignored.add(index + 1);
    if (/v8 ignore stop/.test(line)) inBlock = false;
    const next = line.match(/v8 ignore next(?: (\d+))?/);
    if (next) {
      const count = Number(next[1] ?? 1);
      for (let offset = 1; offset <= count; offset++)
        ignored.add(index + 1 + offset);
    }
  }
  return ignored;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const failures = [];
  let files = 0;
  const seen = new Set();
  for (const record of readFileSync('coverage/lcov.info', 'utf8').split(
    'end_of_record',
  )) {
    const filename = record.match(/^SF:(.+)$/m)?.[1];
    if (!filename) continue;
    // Match the former Vitest include: src/**/*.ts in this package only.
    if (!resolve(filename).startsWith(resolve('src') + '/')) continue;
    seen.add(resolve(filename));
    const source = readFileSync(filename, 'utf8');
    const ignored = ignoredLines(source);
    const hits = new Map(
      [...record.matchAll(/^DA:(\d+),(\d+)/gm)].map((match) => [
        Number(match[1]),
        Number(match[2]),
      ]),
    );
    const ast = ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const lineOf = (position) =>
      ast.getLineAndCharacterOfPosition(position).line + 1;
    let excludedFunctions = 0;
    const visit = (node) => {
      // Bun counts an unused empty-object default parameter as a missed line.
      // V8 treats that as a parameter branch; it is not a separate statement.
      if (
        ts.isParameter(node) &&
        node.initializer &&
        ts.isObjectLiteralExpression(node.initializer) &&
        node.initializer.properties.length === 0
      )
        ignored.add(lineOf(node.initializer.getStart(ast)));
      if (
        ts.isFunctionLike(node) &&
        node.body &&
        ignored.has(lineOf(node.getStart(ast)))
      ) {
        const start = lineOf(node.body.getStart(ast));
        const end = lineOf(node.body.end);
        const bodyHits = [...hits].filter(
          ([line]) => line > start && line < end,
        );
        if (bodyHits.length && bodyHits.every(([, count]) => count === 0))
          excludedFunctions++;
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    const functions = new Map(
      [...record.matchAll(/^FN:(\d+),(.+)$/gm)].map((match) => [
        match[2],
        Number(match[1]),
      ]),
    );
    const uncoveredLines = [...record.matchAll(/^DA:(\d+),(\d+)/gm)]
      .filter(
        (match) => Number(match[2]) === 0 && !ignored.has(Number(match[1])),
      )
      .map((match) => Number(match[1]));
    const uncoveredFunctions = [...record.matchAll(/^FNDA:(\d+),(.+)$/gm)]
      .filter(
        (match) =>
          Number(match[1]) === 0 && !ignored.has(functions.get(match[2])),
      )
      .map((match) => match[2]);
    const found = Number(record.match(/^FNF:(\d+)/m)?.[1]);
    const hit = Number(record.match(/^FNH:(\d+)/m)?.[1]);
    assert(
      Number.isFinite(found) && Number.isFinite(hit),
      'Missing native function totals',
    );
    if (found - hit > excludedFunctions)
      uncoveredFunctions.push(
        `${found - hit - excludedFunctions} uncovered functions`,
      );
    files++;
    if (uncoveredLines.length || uncoveredFunctions.length)
      failures.push({ filename, uncoveredLines, uncoveredFunctions });
  }
  assert(files > 0, 'No source coverage records found');
  const config = readFileSync('bunfig.toml', 'utf8');
  const patterns = JSON.parse(
    config.match(/^coveragePathIgnorePatterns = (.+)$/m)?.[1] ?? '[]',
  );
  for (const relative of readdirSync('src', { recursive: true })) {
    const filename = resolve('src', relative);
    if (
      !filename.endsWith('.ts') ||
      /\.(test|spec|d)\.ts$/.test(filename) ||
      patterns.some((pattern) => matchesGlob(`src/${relative}`, pattern))
    )
      continue;
    // Match the former include-all behavior, even for an unimported source file.
    // Pure type contracts disappear from emitted JavaScript and need no runtime coverage.
    const emitted = ts
      .transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, removeComments: true },
      })
      .outputText.replace(/export \{\};?/, '')
      .trim();
    if (emitted && !seen.has(filename))
      failures.push({ filename, reason: 'Source file missing from coverage' });
  }
  assert.equal(
    failures.length,
    0,
    `100% per-file line/function coverage required:\n${JSON.stringify(failures, null, 2)}`,
  );
  console.log(
    `100% line/function coverage passed for ${files} source files (existing V8 exclusions honored).`,
  );
}
