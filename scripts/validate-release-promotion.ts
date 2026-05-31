#!/usr/bin/env -S bun --preload ./shims/deno-compat.ts

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
      'root completion roadmap',
      'ROADMAP.md',
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
      '`sha-*` tag',
      'bun run release-manifest:check-artifacts',
      'takosumi/',
      'takos-worker',
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
      'Removed Takos-owned surfaces',
      'Account model docs',
      'Validation Evidence',
      'No-user clean-cut evidence',
      'Rollback Plan',
      'Block release if',
    ],
  },
  {
    path: '../takos-private/docs/operations/no-user-clean-cut-evidence.md',
    expected: [
      'No-User Clean-Cut Evidence',
      'Cleanup Scope',
      'Takos-owned OAuth/OIDC issuer endpoints',
      'Takos app public/proxy direct deploy routes',
      'does **not** include takosumi kernel',
      '5 endpoint API',
      'Takosumi installer / Accounts',
      'Required Evidence',
      'Completion Rule',
      'actual public no-user clean-cut evidence',
    ],
  },
];

const requiredTextFiles = [
  {
    path: 'package.json',
    expected: [
      '"takosRelease"',
      '"validate:release-promotion"',
      '"release-manifest:check-clean"',
      '"release-manifest:check-artifacts"',
    ],
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
      'releaseComponents',
      'collectReleaseComponents',
      'containers/agent/Cargo.toml',
      'canonicalLayout',
      'collectReleaseIdentity',
      '--release-version',
      '--release-tag',
      'collectCanonicalLayout',
      '--require-clean-git',
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
      'actions/checkout@',
      'actions/cache@',
      'actions/upload-artifact@',
      'actions/download-artifact@',
      'azure/setup-helm@',
      'pinned: v6',
      'pinned: v5',
      'pinned: v7',
      'pinned: v8',
      'ghcr.io/${{ github.repository_owner }}',
      'docker/build-push-action',
      'sbom: true',
      'provenance: mode=max',
      'type=raw,value=${{ inputs.version }}',
      'type=sha,prefix=sha-',
      'steps.build.outputs.digest',
      '--arg commit "${GITHUB_SHA}"',
      '--arg workflowRun "${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"',
      'takos-image-digest-',
      '--require-image-digests',
      'helm package deploy/helm/takos',
      'helm push',
      '--release-version "${release_version}"',
      '--release-tag "${release_tag}"',
      'bun run validate:release-promotion',
      'FORCE_JAVASCRIPT_ACTIONS_TO_NODE24',
    ],
  },
  {
    path: 'deploy/docker/takos-worker.Dockerfile',
    expected: [
      'src/worker/local-platform/unified-entrypoint.ts',
      'COPY takos/src ./src',
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
    expected: ['validate:release-promotion'],
  },
  {
    path: '../.github/workflows/pr-check.yml',
    expected: ['validate:release-promotion'],
  },
  {
    path: '../.github/workflows/release-gate.yml',
    expected: ['validate:release-promotion'],
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
