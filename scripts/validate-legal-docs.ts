#!/usr/bin/env -S bun
import * as runtime from "./runtime.ts";

const requiredDocs = [
  {
    path: 'docs/legal/index.md',
    expected: [
      'Data Processing Agreement template',
      'Sub-processor list',
      'Data residency policy',
      'Privacy rights and lawful bases',
      'Security disclosure policy',
      'License compliance',
      'Third-party dependency inventory',
      'SOC 2 readiness checklist',
    ],
  },
  {
    path: 'docs/legal/data-processing-agreement.md',
    expected: [
      'Last reviewed | 2026-05-07',
      'GDPR Article 28',
      'CCPA / CPRA',
      'Customer Instructions',
      'Sub-processors',
      'Data Subject Requests',
      'Annex I',
      'Annex II',
      'Annex III',
      '/legal/subprocessors',
      'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
      'https://cppa.ca.gov/regulations/pdf/cppa_regs.pdf',
    ],
  },
  {
    path: 'docs/legal/subprocessors.md',
    expected: [
      'Last reviewed | 2026-05-07',
      'Cloudflare',
      'OpenAI',
      'Stripe',
      'Google',
      'Amazon Web Services',
      'Vendor Onboarding Rule',
      'https://www.cloudflare.com/gdpr/subprocessors/cloudflare-services/',
      'https://aws.amazon.com/compliance/sub-processors/',
    ],
  },
  {
    path: 'docs/legal/data-residency.md',
    expected: [
      'Last reviewed | 2026-05-07',
      'Residency Profiles',
      '`global`',
      '`us`',
      '`eu`',
      '`jp`',
      'Provider-specific Handling',
      'Operational Requirements',
      'Enforcement Evidence',
      'https://developers.cloudflare.com/data-localization/metadata-boundary/',
      'https://developers.openai.com/api/docs/guides/your-data',
      'https://d1.awsstatic.com/legal/aws-gdpr/AWS_GDPR_DPA.pdf',
      'https://cloud.google.com/about/locations',
    ],
  },
  {
    path: 'docs/legal/privacy-rights.md',
    expected: [
      'Last reviewed | 2026-05-12',
      'Data Subject Rights Handler',
      '/api/me/privacy/access',
      '/api/me/privacy/export',
      '/api/me/privacy/deletion-requests',
      'Export Redaction Rules',
      'Lawful Bases',
      'Cookie Consent',
      '__Host-tp_session',
      'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
      'https://cppa.ca.gov/regulations/pdf/cppa_regs.pdf',
    ],
  },
  {
    path: 'docs/legal/security-disclosure.md',
    expected: [
      'Last reviewed | 2026-05-07',
      'security@takos.jp',
      '/.well-known/security.txt',
      'Responsible Disclosure Window',
      'PGP Key Publication',
      'Safe Harbor',
      'Out of scope',
      'takos',
    ],
  },
  {
    path: 'docs/legal/license-compliance.md',
    expected: [
      'First-party License Inventory',
      'REUSE / SPDX Baseline',
      'takos-private',
      'bun run check:license-compliance',
      'AGPL-3.0-only',
      'GPL-3.0-only',
      'MIT',
    ],
  },
  {
    path: 'docs/legal/third-party-license-inventory.md',
    expected: [
      'Third-party Dependency Inventory',
      'Hyperformula',
      'GPL-3.0-only',
      '@img/sharp-libvips',
      'LGPL-3.0-or-later',
      'jszip',
      'MIT OR GPL-3.0-or-later',
    ],
  },
  {
    path: 'docs/legal/soc2-readiness.md',
    expected: [
      'Vendor Management',
      'Sub-processor list is published before GA',
    ],
  },
];

const failures: string[] = [];

for (const doc of requiredDocs) {
  validateTextIncludes(doc.path, doc.expected);
}

validateTextIncludes('docs/.vitepress/config.ts', [
  "link: '/legal/'",
  "link: '/legal/data-processing-agreement'",
  "link: '/legal/subprocessors'",
  "link: '/legal/data-residency'",
  "link: '/legal/privacy-rights'",
  "link: '/legal/security-disclosure'",
  "link: '/legal/license-compliance'",
  "link: '/legal/third-party-license-inventory'",
  "link: '/legal/soc2-readiness'",
]);

validateTextIncludes('web/public/.well-known/security.txt', [
  'Contact: mailto:security@takos.jp',
  'Policy: https://docs.takos.jp/legal/security-disclosure',
  'Canonical: https://takos.jp/.well-known/security.txt',
]);

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  runtime.exit(1);
}

console.log(`Validated ${requiredDocs.length} legal document(s)`);

function validateTextIncludes(path: string, expectedValues: readonly string[]): void {
  if (!exists(path)) {
    failures.push(`missing legal document artifact: ${path}`);
    return;
  }

  const text = runtime.readTextFileSync(path);
  for (const expected of expectedValues) {
    if (!includesExpected(text, expected)) {
      failures.push(`${path}: expected to contain '${expected}'`);
    }
  }
}

function includesExpected(text: string, expected: string): boolean {
  if (text.includes(expected)) return true;

  const lastReviewedPrefix = 'Last reviewed | ';
  if (expected.startsWith(lastReviewedPrefix)) {
    const date = escapeRegex(expected.slice(lastReviewedPrefix.length));
    return new RegExp(`\\|\\s*Last reviewed\\s*\\|\\s*${date}\\s*\\|`)
      .test(text);
  }

  return false;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exists(path: string): boolean {
  try {
    runtime.statSync(path);
    return true;
  } catch (error) {
    if (error instanceof runtime.errors.NotFound) return false;
    throw error;
  }
}
