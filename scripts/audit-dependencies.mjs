import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function blockingFindings(report) {
  if (!report.metadata?.vulnerabilities || !report.advisories) {
    throw new Error(
      'Invalid audit response; refusing to treat it as a clean audit',
    );
  }
  return Object.values(report.advisories).flatMap((advisory) =>
    advisory.findings
      .filter((finding) => {
        // The registry range is broader than the upstream advisory. Minimatch 3
        // has neither optimizationLevel nor firstPhasePreProcess(), the affected
        // algorithm. Keep the exception specific to the inspected legacy version.
        // https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249
        return !(
          advisory.github_advisory_id === 'GHSA-g3hv-75wg-m249' &&
          advisory.module_name === 'minimatch' &&
          finding.version === '3.1.5'
        );
      })
      .map((finding) => ({
        advisory: advisory.github_advisory_id,
        severity: advisory.severity,
        package: advisory.module_name,
        version: finding.version,
        paths: finding.paths,
      })),
  );
}

// Bun returns the registry's bulk advisory format. Reconstruct exact affected
// versions from the committed lockfile to retain the narrow legacy exception.
export function normalizeBunAudit(bulk, packages, satisfies) {
  if (!bulk || typeof bulk !== 'object' || Array.isArray(bulk) || bulk.error)
    throw new Error('Invalid audit response');
  const advisories = [];
  for (const [name, reports] of Object.entries(bulk)) {
    if (!Array.isArray(reports) || reports.length === 0)
      throw new Error('Invalid audit advisories');
    for (const report of reports) {
      const id = report.url?.match(
        /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/,
      )?.[0];
      if (
        !id ||
        !['info', 'low', 'moderate', 'high', 'critical'].includes(
          report.severity,
        ) ||
        typeof report.vulnerable_versions !== 'string'
      )
        throw new Error('Invalid audit advisory');
      const findings = packages.filter(
        (pkg) =>
          pkg.name === name &&
          satisfies(pkg.version, report.vulnerable_versions),
      );
      if (findings.length === 0)
        throw new Error('Audit advisory has no locked affected version');
      advisories.push({
        github_advisory_id: id,
        module_name: name,
        severity: report.severity,
        findings,
      });
    }
  }
  return { advisories, metadata: { vulnerabilities: {} } };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = spawnSync('bun', ['audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    throw (
      result.error ??
      new Error(`Audit failed: ${result.stderr || result.stdout}`)
    );
  }
  const bulk = JSON.parse(result.stdout);
  if (Object.keys(bulk).length > 0 !== (result.status === 1))
    throw new Error('Audit status disagrees with response');
  const lock = Bun.JSON5.parse(readFileSync('bun.lock', 'utf8'));
  const packages = Object.entries(lock.packages).flatMap(([path, entry]) => {
    const separator = entry[0].lastIndexOf('@');
    if (separator < 1) return [];
    return [
      {
        name: entry[0].slice(0, separator),
        version: entry[0].slice(separator + 1),
        paths: [path],
      },
    ];
  });
  const report = normalizeBunAudit(bulk, packages, Bun.semver.satisfies);
  const findings = blockingFindings(report);
  if (findings.length) {
    console.error(JSON.stringify(findings, null, 2));
    process.exitCode = 1;
  } else {
    console.log(
      'Dependency audit passed (only the documented minimatch 3.1.5 false positive is excluded).',
    );
  }
}
