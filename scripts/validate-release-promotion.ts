#!/usr/bin/env -S deno run --config deno.json --allow-read

const requiredDocs = [
  {
    path: 'docs/operations/release-promotion.md',
    expected: [
      'dev -> staging -> production',
      'Takos Web / API',
      'manual approval',
      'release artifact manifest',
      'Branch Protection',
      'takos-private/',
      'release announcement',
    ],
  },
  {
    path: 'docs/operations/rollback-sop.md',
    expected: [
      'Rollback SOP',
      'deployment id',
      'one-click revert',
      '/api/public/v1/groups/:groupId/rollback',
      'takos-private',
      'Staging Rehearsal',
    ],
  },
  {
    path: 'docs/operations/release-announcement-template.md',
    expected: [
      'Release Announcement Template',
      'Breaking Changes',
      'Migration Guide',
      'Validation Evidence',
      'Rollback Plan',
      'Block release if',
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
    expected: ['validate-release-promotion', 'validate:release-promotion'],
  },
  {
    path: 'docs/.vitepress/config.ts',
    expected: [
      "link: '/operations/release-promotion'",
      "link: '/operations/rollback-sop'",
      "link: '/operations/release-announcement-template'",
    ],
  },
  {
    path: 'docs/contributing/release-gate.md',
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

for (const doc of requiredDocs) {
  validateTextIncludes(doc.path, doc.expected);
}

for (const file of requiredTextFiles) {
  validateTextIncludes(file.path, file.expected);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  Deno.exit(1);
}

console.log(`Validated ${requiredDocs.length} release promotion document(s)`);

function validateTextIncludes(path: string, expectedValues: readonly string[]): void {
  if (!exists(path)) {
    failures.push(`missing release promotion artifact: ${path}`);
    return;
  }

  const text = Deno.readTextFileSync(path);
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
