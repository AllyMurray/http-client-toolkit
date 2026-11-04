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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = spawnSync('pnpm', ['audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    throw (
      result.error ??
      new Error(`Audit failed: ${result.stderr || result.stdout}`)
    );
  }
  const report = JSON.parse(result.stdout);
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
