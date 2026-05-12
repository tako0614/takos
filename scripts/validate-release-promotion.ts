#!/usr/bin/env -S deno run --config deno.json --allow-read

const requiredDocs = [
  {
    path: '../takos-private/docs/operations/release-promotion.md',
    expected: [
      'dev -> staging -> production',
      'Takos Web / API',
      'manual approval',
      'release artifact manifest',
      'Branch Protection',
      'Release Artifact Pipelines',
      'takos-private/',
      'release announcement',
      'deno task audit:roadmap-release-readiness',
      'ROADMAP 1.x blockers',
    ],
  },
  {
    path: '../takos-private/docs/operations/release-artifacts.md',
    expected: [
      'Release Artifact Pipelines',
      'JSR packages',
      'OCI image',
      'Helm chart',
      'SBOM',
      'provenance',
      'image digest metadata',
      'digest-pinned',
      'semver tags',
      'takosumi/',
      'takosumi-git/',
      'takos-app',
    ],
  },
  {
    path: '../takos-private/docs/operations/rollback-sop.md',
    expected: [
      'Rollback SOP',
      'deployment id',
      'one-click revert',
      'POST /v1/installations/:id/rollback',
      'takos-private',
      'Staging Rehearsal',
    ],
  },
  {
    path: '../takos-private/docs/operations/release-announcement-template.md',
    expected: [
      'Release Announcement Template',
      'Breaking Changes',
      'Legacy API removal scope',
      'Migration Guide',
      'Validation Evidence',
      'Migration window evidence',
      'Rollback Plan',
      'Block release if',
    ],
  },
  {
    path: '../takos-private/docs/operations/migration-window-evidence.md',
    expected: [
      'Migration Window Evidence',
      'Removal Scope',
      'Takos-owned OAuth/OIDC issuer endpoints',
      'Takos app public/proxy direct deploy routes',
      'does **not** include takosumi kernel',
      'POST /v1/deployments',
      'Required Evidence',
      'Completion Rule',
      'public announcement evidence',
    ],
  },
  {
    path: '../takos-private/docs/operations/roadmap-1x-release-readiness.md',
    expected: [
      'ROADMAP 1.x Release Readiness',
      'release gate 17/17 green',
      'community announcement + migration window',
      'CI-equivalent Command Evidence',
      'GitHub-hosted CI success is not a completion requirement',
      'Hosted GitHub runs',
      'Release Gate',
      'CI',
      'takos-ecosystem release/sign-off evidence',
      'Takos release/tag sequence',
      'migration-window-evidence.md',
      'Keep the ROADMAP at `95/96`',
    ],
  },
];

const requiredTextFiles = [
  {
    path: 'deno.json',
    expected: ['"validate:release-promotion"'],
  },
  {
    path: 'scripts/release-gate.ts',
    expected: ['validate-release-promotion', 'validate:release-promotion'],
  },
  {
    path: 'scripts/build-release-manifest.ts',
    expected: [
      'validate-release-promotion',
      'validate:release-promotion',
      'officialImages',
      '--require-image-digests',
      'digestRef',
      'provenance',
      'sbom',
    ],
  },
  {
    path: '.github/workflows/release-artifacts.yml',
    expected: [
      'Release Artifacts',
      'actions/checkout@v6',
      'actions/cache@v5',
      'actions/upload-artifact@v7',
      'actions/download-artifact@v8',
      'azure/setup-helm@v5',
      'ghcr.io/${{ github.repository_owner }}',
      'docker/build-push-action',
      'sbom: true',
      'provenance: mode=max',
      'steps.build.outputs.digest',
      'takos-image-digest-',
      '--require-image-digests',
      'helm package deploy/helm/takos',
      'helm push',
      'deno task validate:release-promotion',
      'FORCE_JAVASCRIPT_ACTIONS_TO_NODE24',
    ],
  },
  {
    path: 'deploy/docker/takos-app.Dockerfile',
    expected: [
      'apps/api/src/index.ts',
      'git/packages/git-contract',
      'PORT=8080',
    ],
  },
];

const externalTextFiles = [
  {
    path: '../docs/quality/release-gate.md',
    expected: ['Release promotion validator', 'validate:release-promotion'],
  },
  {
    path: '../.github/workflows/ci.yml',
    expected: ['deno task validate:release-promotion'],
  },
  {
    path: '../.github/workflows/pr-check.yml',
    expected: ['deno task validate:release-promotion'],
  },
  {
    path: '../.github/workflows/release-gate.yml',
    expected: ['deno task validate:release-promotion'],
  },
];

const failures: string[] = [];
const warnings: string[] = [];
let validatedArtifacts = 0;

for (const doc of requiredDocs) {
  validateTextIncludes(doc.path, doc.expected, { missing: 'warn' });
}

for (const file of requiredTextFiles) {
  validateTextIncludes(file.path, file.expected);
}

for (const file of externalTextFiles) {
  validateTextIncludes(file.path, file.expected, { missing: 'warn' });
}

if (failures.length > 0) {
  for (const warning of warnings) console.warn(warning);
  for (const failure of failures) console.error(failure);
  Deno.exit(1);
}

for (const warning of warnings) console.warn(warning);
console.log(`Validated ${validatedArtifacts} release promotion artifact(s)`);

function validateTextIncludes(
  path: string,
  expectedValues: readonly string[],
  options: { missing?: 'fail' | 'warn' } = {},
): void {
  if (!exists(path)) {
    if (options.missing === 'warn') {
      warnings.push(
        `skipped external release promotion artifact in standalone checkout: ${path}`,
      );
      return;
    }

    failures.push(`missing release promotion artifact: ${path}`);
    return;
  }

  const text = Deno.readTextFileSync(path);
  validatedArtifacts += 1;
  for (const expected of expectedValues) {
    if (!text.includes(expected)) {
      failures.push(`${path}: expected to contain '${expected}'`);
    }
  }
}

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
