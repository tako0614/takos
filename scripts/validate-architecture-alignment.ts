type CheckFailure = {
  path: string;
  message: string;
};

const README_PATH = 'README.md';
const TAKOSUMI_DOCS_ROOT = 'docs/takosumi';
const CURRENT_STATE_PATH = `${TAKOSUMI_DOCS_ROOT}/current-state.md`;
const CHECKLIST_PATH = `${TAKOSUMI_DOCS_ROOT}/10-v1.0-implementation-checklist.md`;
const DOMAIN_ROOT = '../takosumi/packages/kernel/src/domains';
const TAKOSUMI_CLOUD_ACCOUNTS_CONTRACT = '../takosumi-cloud/packages/accounts-contract/src/mod.ts';

const REQUIRED_INTERNAL_DOMAIN_DOCS = [CURRENT_STATE_PATH];
const REQUIRED_KERNEL_PLUGIN_DOCS = [CURRENT_STATE_PATH, CHECKLIST_PATH];
const APP_GRANT_CATALOG_DOCS = [
  'docs/reference/app-yml-spec.md',
  'docs/architecture/app-installation.md',
  'docs/reference/database.md',
];
const REQUIRED_DOMAIN_DIRS = [
  'core',
  'deploy',
  'runtime',
  'resources',
  'routing',
  'network',
  'registry',
  'audit',
  'events',
  'outputs',
  'service-endpoints',
  'supply-chain',
];

const PRODUCT_ROOT_TERMS = [
  'product root',
  'repo',
  'repository',
  'top-level service',
  'service boundary',
  'service boundaries',
];

const SAFE_DRIFT_TERMS = [
  'internal domain',
  'internal domains',
  'domain modules',
  'domains/deploy',
  'domains/runtime',
  'inside `takosumi`',
  'inside takosumi',
  'implemented as',
  'not default top-level',
  'not a default top-level',
  'not top-level',
  'no longer top-level',
  'compatibility',
  'legacy',
];

const KERNEL_PLUGIN_REQUIRED_TERMS = [
  'kernel',
  'plugin',
  'self-host',
  'cloud',
];

const FORBIDDEN_CURRENT_BOUNDARY_PATTERNS = [
  {
    pattern: /Implement local Docker\/single-node only first/i,
    message:
      'Runtime/routing milestones must describe kernel ports/projections first; Docker/self-host belongs to plugins.',
  },
  {
    pattern: /real backend[^.\n]*(kernel release|release gate|criterion|criteria)/i,
    message: 'Real backend proofs must not be described as kernel release criteria.',
  },
];

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

async function readText(
  path: string,
  failures: CheckFailure[],
): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    failures.push({
      path,
      message: `Unable to read file: ${error instanceof Error ? error.message : String(error)}`,
    });
    return '';
  }
}

async function collectMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(directory: string): Promise<void> {
    for await (const entry of Deno.readDir(directory)) {
      const entryPath = `${directory}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(entryPath);
      } else if (entry.isFile && entry.name.endsWith('.md')) {
        files.push(entryPath);
      }
    }
  }

  await walk(root);
  return files.sort();
}

function paragraphAt(text: string, index: number): string {
  const before = text.lastIndexOf('\n\n', index);
  const after = text.indexOf('\n\n', index);
  const start = before === -1 ? 0 : before + 2;
  const end = after === -1 ? text.length : after;
  return text.slice(start, end).trim();
}

function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function hasAny(text: string, terms: string[]): boolean {
  const lowerText = text.toLowerCase();
  return terms.some((term) => lowerText.includes(term));
}

function extractStringArrayConst(
  path: string,
  text: string,
  constName: string,
  failures: CheckFailure[],
): string[] {
  const match = new RegExp(
    `export\\s+const\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s+as\\s+const`,
  ).exec(text);
  if (!match) {
    failures.push({
      path,
      message: `Unable to find exported const array ${constName}.`,
    });
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function validateInternalDomainMentions(
  path: string,
  text: string,
  failures: CheckFailure[],
): void {
  const lowerText = text.toLowerCase();
  const mentionsPaas = lowerText.includes('takosumi') ||
    lowerText.includes('takos paas');
  const mentionsInternalDomains = lowerText.includes('internal domain') ||
    lowerText.includes('internal domains') ||
    lowerText.includes('domain modules') ||
    lowerText.includes('packages/kernel/src/domains');
  const mentionsDeployRuntimeDomains = lowerText.includes('domains/deploy') ||
    lowerText.includes('domains/runtime') ||
    (lowerText.includes('deploy') && lowerText.includes('runtime'));

  if (
    !mentionsPaas || !mentionsInternalDomains || !mentionsDeployRuntimeDomains
  ) {
    failures.push({
      path,
      message:
        'Expected README/current-state docs to describe takosumi internal domains, including deploy/runtime as domains inside the Takosumi kernel.',
    });
  }
}

function validateKernelPluginBoundaryMentions(
  path: string,
  text: string,
  failures: CheckFailure[],
): void {
  const lowerText = text.toLowerCase();
  for (const term of KERNEL_PLUGIN_REQUIRED_TERMS) {
    if (lowerText.includes(term)) continue;
    failures.push({
      path,
      message: `Expected kernel/plugin boundary docs to mention "${term}" explicitly.`,
    });
  }
}

function validateForbiddenCurrentBoundaryDrift(
  path: string,
  text: string,
  failures: CheckFailure[],
): void {
  for (const rule of FORBIDDEN_CURRENT_BOUNDARY_PATTERNS) {
    const match = rule.pattern.exec(text);
    if (match?.index === undefined) continue;
    failures.push({
      path: `${path}:${lineNumberAt(text, match.index)}`,
      message: rule.message,
    });
  }
}

function validateStaleProductRootDrift(
  path: string,
  text: string,
  failures: CheckFailure[],
): void {
  const staleNamePattern = /`?takos-(deploy|runtime)`?/gi;
  for (const match of text.matchAll(staleNamePattern)) {
    if (match.index === undefined) {
      continue;
    }

    const paragraph = paragraphAt(text, match.index);
    const lowerParagraph = paragraph.toLowerCase();
    const mentionsProductRootShape = hasAny(lowerParagraph, PRODUCT_ROOT_TERMS);
    const isSafeInternalDomainStatement = hasAny(
      lowerParagraph,
      SAFE_DRIFT_TERMS,
    );

    if (mentionsProductRootShape && !isSafeInternalDomainStatement) {
      failures.push({
        path: `${path}:${lineNumberAt(text, match.index)}`,
        message: `Stale boundary drift: ${
          match[0]
        } appears near product-root/top-level service wording without an internal-domain qualifier.`,
      });
    }
  }
}

async function validateDomainDirs(failures: CheckFailure[]): Promise<void> {
  for (const domain of REQUIRED_DOMAIN_DIRS) {
    const domainPath = `${DOMAIN_ROOT}/${domain}`;
    if (!(await pathExists(domainPath))) {
      failures.push({
        path: domainPath,
        message: 'Required takosumi core domain directory is missing.',
      });
    }
  }
}

async function validateAppGrantCatalogDocs(
  failures: CheckFailure[],
): Promise<void> {
  const contract = await readText(TAKOSUMI_CLOUD_ACCOUNTS_CONTRACT, failures);
  const capabilities = extractStringArrayConst(
    TAKOSUMI_CLOUD_ACCOUNTS_CONTRACT,
    contract,
    'TAKOSUMI_APP_GRANT_CAPABILITIES',
    failures,
  );
  if (capabilities.length === 0) return;

  for (const path of APP_GRANT_CATALOG_DOCS) {
    const text = await readText(path, failures);
    const missing = capabilities.filter((capability) => !text.includes(capability));
    if (missing.length > 0) {
      failures.push({
        path,
        message: `Missing AppGrant capability catalog entries: ${missing.join(', ')}`,
      });
    }
  }
}

async function main(): Promise<void> {
  const failures: CheckFailure[] = [];

  for (const path of REQUIRED_INTERNAL_DOMAIN_DOCS) {
    const text = await readText(path, failures);
    validateInternalDomainMentions(path, text, failures);
  }

  for (const path of REQUIRED_KERNEL_PLUGIN_DOCS) {
    const text = await readText(path, failures);
    validateKernelPluginBoundaryMentions(path, text, failures);
  }

  const markdownFiles = [
    README_PATH,
    ...await collectMarkdownFiles(TAKOSUMI_DOCS_ROOT),
  ];
  for (const path of markdownFiles) {
    const text = await readText(path, failures);
    validateStaleProductRootDrift(path, text, failures);
    validateForbiddenCurrentBoundaryDrift(path, text, failures);
  }

  await validateDomainDirs(failures);
  await validateAppGrantCatalogDocs(failures);

  if (failures.length > 0) {
    console.error('Architecture alignment validation failed:');
    for (const failure of failures) {
      console.error(`- ${failure.path}: ${failure.message}`);
    }
    Deno.exit(1);
  }

  console.log('Architecture alignment validation passed.');
  console.log(`Checked ${markdownFiles.length} README/plan markdown files.`);
  console.log(`Verified ${REQUIRED_DOMAIN_DIRS.length} domain directories.`);
  console.log(`Verified AppGrant catalog docs in ${APP_GRANT_CATALOG_DOCS.length} files.`);
}

if (import.meta.main) {
  await main();
}
