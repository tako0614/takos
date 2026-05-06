#!/usr/bin/env -S deno run --config deno.json --allow-read

const requiredDocs = [
  {
    path: 'docs/legal/index.md',
    expected: [
      'Data Processing Agreement template',
      'Sub-processor list',
      'Data residency policy',
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
  'link: "/legal/"',
  'link: "/legal/data-processing-agreement"',
  'link: "/legal/subprocessors"',
  'link: "/legal/data-residency"',
  'link: "/legal/soc2-readiness"',
]);

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  Deno.exit(1);
}

console.log(`Validated ${requiredDocs.length} legal document(s)`);

function validateTextIncludes(path: string, expectedValues: readonly string[]): void {
  if (!exists(path)) {
    failures.push(`missing legal document artifact: ${path}`);
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
