import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockingFindings } from '../scripts/audit-dependencies.mjs';

const report = (version, id = 'GHSA-g3hv-75wg-m249', name = 'minimatch') => ({
  metadata: { vulnerabilities: { moderate: 1 } },
  advisories: {
    1: {
      github_advisory_id: id,
      module_name: name,
      severity: 'moderate',
      findings: [{ version }],
    },
  },
});
test('excludes only the inspected legacy minimatch false positive', () => {
  assert.deepEqual(blockingFindings(report('3.1.5')), []);
  assert.equal(blockingFindings(report('10.2.6')).length, 1);
  assert.equal(blockingFindings(report('3.1.4')).length, 1);
  assert.equal(blockingFindings(report('3.1.5', 'GHSA-other')).length, 1);
  assert.equal(
    blockingFindings(report('3.1.5', 'GHSA-g3hv-75wg-m249', 'another-package'))
      .length,
    1,
  );
});
test('fails closed for registry errors instead of reporting success', () => {
  assert.throws(
    () => blockingFindings({ error: 'unavailable' }),
    /Invalid audit/,
  );
});

test('normalizes Bun advisories without broadening the legacy exception', async () => {
  const { normalizeBunAudit } =
    await import('../scripts/audit-dependencies.mjs');
  const bulk = {
    minimatch: [
      {
        url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249',
        severity: 'moderate',
        vulnerable_versions: '*',
      },
    ],
  };
  const normalized = normalizeBunAudit(
    bulk,
    [
      { name: 'minimatch', version: '3.1.5' },
      { name: 'minimatch', version: '10.2.6' },
    ],
    () => true,
  );
  assert.deepEqual(
    blockingFindings(normalized).map((finding) => finding.version),
    ['10.2.6'],
  );
  assert.deepEqual(
    blockingFindings(normalizeBunAudit({}, [], () => false)),
    [],
  );
});
test('rejects malformed Bun advisory reports and unmatched versions', async () => {
  const { normalizeBunAudit } =
    await import('../scripts/audit-dependencies.mjs');
  for (const report of [
    null,
    [],
    { error: 'unavailable' },
    { minimatch: [] },
    { minimatch: [{}] },
  ])
    assert.throws(
      () => normalizeBunAudit(report, [], () => false),
      /Invalid audit/,
    );
  assert.throws(
    () =>
      normalizeBunAudit(
        {
          minimatch: [
            {
              url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249',
              severity: 'moderate',
              vulnerable_versions: '*',
            },
          ],
        },
        [],
        () => false,
      ),
    /no locked affected version/,
  );
});
