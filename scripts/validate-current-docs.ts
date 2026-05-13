const checks: Array<() => Promise<string[]>> = [
  validateRemovedHistoricalDocs,
  validateVitePressExcludesNonCurrentDocs,
  validateContributingIndex,
];

const errors = (await Promise.all(checks.map((check) => check()))).flat();

if (errors.length > 0) {
  console.error(errors.join('\n'));
  Deno.exit(1);
}

console.log('Validated Takos current docs boundary.');

async function validateRemovedHistoricalDocs(): Promise<string[]> {
  const forbiddenPaths = [
    'docs/contributing/system-architecture-implementation-plan.md',
    'docs/releases/v0.9.0.md',
  ];
  const errors: string[] = [];
  for (const path of forbiddenPaths) {
    if (await exists(path)) {
      errors.push(`${path}: historical or no-user clean-cut docs must not be kept as current Takos docs`);
    }
  }
  return errors;
}

async function validateVitePressExcludesNonCurrentDocs(): Promise<string[]> {
  const config = await Deno.readTextFile('docs/.vitepress/config.ts');
  const errors: string[] = [];
  for (const required of ["'contributing/**'", "'releases/**'"]) {
    if (!config.includes(required)) {
      errors.push(`docs/.vitepress/config.ts: srcExclude must include ${required}`);
    }
  }
  return errors;
}

async function validateContributingIndex(): Promise<string[]> {
  const index = await Deno.readTextFile('docs/contributing/index.md');
  const forbidden = [
    'system-architecture-implementation-plan',
    'historical 1.0 Core Release plan',
    'apps/paas',
    `takos-${'paas'}`,
  ];
  return forbidden
    .filter((term) => index.includes(term))
    .map((term) => `docs/contributing/index.md: remove non-current docs reference '${term}'`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
