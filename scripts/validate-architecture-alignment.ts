import * as runtime from "./runtime.ts";
type CheckFailure = {
  path: string;
  message: string;
};

const README_PATH = 'README.md';
const CURRENT_STATE_PATH = 'docs/contributing/current-state.md';
const TAKOSUMI_MODEL_PATH = '../takosumi/docs/reference/model.md';
const TAKOSUMI_OPERATOR_PATH = '../takosumi/docs/reference/operator.md';
const DOMAIN_ROOT = '../takosumi/core/domains';

const REQUIRED_INTERNAL_DOMAIN_DOCS = [CURRENT_STATE_PATH];
const REQUIRED_OPERATOR_BOUNDARY_DOCS = [CURRENT_STATE_PATH];
const ARCHITECTURE_ALIGNMENT_DOCS = [
  README_PATH,
  CURRENT_STATE_PATH,
  TAKOSUMI_MODEL_PATH,
  TAKOSUMI_OPERATOR_PATH,
];
const PERMISSION_SCOPE_DOCS = [
  TAKOSUMI_OPERATOR_PATH,
];
const TAKOSUMI_MODEL_DOCS = [
  '../docs/platform/runtime-modes.md',
  TAKOSUMI_MODEL_PATH,
  'docs/platform/upgrade-export.md',
];
const RUNTIME_TARGET_DOCS = [
  TAKOSUMI_MODEL_PATH,
  TAKOSUMI_OPERATOR_PATH,
];
const ACCOUNT_MODEL_DOC_PATH = 'docs/operator/account-model.md';
const ACCOUNT_MODEL_REQUIRED_TERMS = [
  'auth_identities',
  'provider_sub = <issuer>#<sub>',
  'email_verified = true',
  'identity.oidc@v1',
  'personal_access_tokens',
  '公開 contract ではなく private operator evidence shaping',
];
const FORBIDDEN_PUBLIC_STATUS_PATTERNS = [
  {
    pattern: /AppInstallation status [^\n]*`ready\s*→\s*materializing\s*→\s*ready`/i,
    message: 'materializing must be documented as an operation phase, not as a public AppInstallation status.',
  },
  {
    pattern: /state は canonical `ready`\s*→\s*transitional `materializing`\s*→\s*canonical `ready`/i,
    message: 'Materialize docs must keep public status canonical and describe materializing as operation metadata.',
  },
  {
    pattern: /`uninstalling` \(data 廃棄\) を選べる/i,
    message: 'uninstalling must be documented as an operation phase, not as a selectable public status.',
  },
];
const FORBIDDEN_RUNTIME_BINDING_TARGET_PATTERNS = [
  {
    pattern: /shared-cell:\/\//,
    message: 'Runtime target docs must use RunnerProfile / Workers for Platforms wording, not shared-cell target URIs.',
  },
  {
    pattern: /"target_id":\s*"tokyo-cell-[^"]*"/,
    message: 'Runtime target docs must not use old shared-cell target_id examples.',
  },
  {
    pattern: /runtime binding:\s*tokyo-cell-[^\n]*/i,
    message: 'Runtime target docs must not use old cell-only binding examples.',
  },
];
const REQUIRED_DOMAIN_DIRS = [
  'space',
  'binding',
  'deploy-control',
  'deploy-records',
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
  'domains/deploy-control',
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

const OPERATOR_BOUNDARY_REQUIRED_TERMS = [
  'service',
  'operator',
  'opentofu',
  'runnerprofile',
];

const FORBIDDEN_CURRENT_BOUNDARY_PATTERNS = [
  {
    pattern: /Implement local Docker\/single-node only first/i,
    message:
      'Runtime/routing milestones must describe service ports/projections first; Docker/self-host belongs to operator-owned implementation wiring.',
  },
  {
    pattern: /real backend[^.\n]*(service release|release gate|criterion|criteria)/i,
    message: 'Real backend proofs must not be described as service release criteria.',
  },
];

async function pathExists(path: string): Promise<boolean> {
  try {
    await runtime.stat(path);
    return true;
  } catch (error) {
    if (error instanceof runtime.errors.NotFound) {
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
    return await runtime.readTextFile(path);
  } catch (error) {
    failures.push({
      path,
      message: `Unable to read file: ${error instanceof Error ? error.message : String(error)}`,
    });
    return '';
  }
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
    lowerText.includes('src/service/domains') ||
    lowerText.includes('src/service/domains');
  const mentionsDeployRuntimeDomains = lowerText.includes('domains/deploy-control') ||
    lowerText.includes('domains/runtime') ||
    (lowerText.includes('deploy control') && lowerText.includes('runtime'));

  if (
    !mentionsPaas || !mentionsInternalDomains || !mentionsDeployRuntimeDomains
  ) {
    failures.push({
      path,
      message:
        'Expected README/current-state docs to describe takosumi internal domains, including deploy/runtime as domains inside the Takosumi service.',
    });
  }
}

function validateOperatorBoundaryMentions(
  path: string,
  text: string,
  failures: CheckFailure[],
): void {
  const lowerText = text.toLowerCase();
  for (const term of OPERATOR_BOUNDARY_REQUIRED_TERMS) {
    if (lowerText.includes(term)) continue;
    failures.push({
      path,
      message: `Expected operator boundary docs to mention "${term}" explicitly.`,
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
        message: 'Required Takosumi domain directory is missing.',
      });
    }
  }
}

async function validatePermissionScopeDocs(
  _failures: CheckFailure[],
): Promise<void> {
  // v1 contract reset (Wave 6): TAKOSUMI_APP_GRANT_CAPABILITIES is removed.
  // Wave J contract minimization: source-level `permissions.requested[]`
  // is also removed — the Source contract is kind-agnostic and capability
  // requests are modeled outside the Source contract (= operator account
  // plane / namespace pub-sub / consumer-defined kind, per
  // takosumi/docs/reference/model.md). This validator is retained as a
  // no-op so the call site stays stable; delete it together with the call
  // in main() once the surrounding architecture validator is restructured.
}

async function validateTakosumiModelDocs(
  failures: CheckFailure[],
): Promise<void> {
  const requiredTerms = [
    'Installation',
    'PlanRun',
    'ApplyRun',
    'Deployment',
    'DeploymentOutput',
    'RunnerProfile',
  ];
  for (const path of TAKOSUMI_MODEL_DOCS) {
    const text = await readText(path, failures);
    for (const term of requiredTerms) {
      if (text.includes(term)) continue;
      failures.push({
        path,
        message: `Expected Takosumi model docs to mention "${term}".`,
      });
    }
    for (const rule of FORBIDDEN_PUBLIC_STATUS_PATTERNS) {
      const match = rule.pattern.exec(text);
      if (!match || match.index === undefined) continue;
      failures.push({
        path: `${path}:${lineNumberAt(text, match.index)}`,
        message: rule.message,
      });
    }
  }
}

async function validateRuntimeTargetDocs(
  failures: CheckFailure[],
): Promise<void> {
  for (const path of RUNTIME_TARGET_DOCS) {
    const text = await readText(path, failures);
    if (!text.includes('Workers for Platforms')) {
      failures.push({
        path,
        message:
          'Expected runtime target docs to describe Workers for Platforms as the tenant/user Worker ingress boundary.',
      });
    }
    for (const rule of FORBIDDEN_RUNTIME_BINDING_TARGET_PATTERNS) {
      const match = rule.pattern.exec(text);
      if (!match || match.index === undefined) continue;
      failures.push({
        path: `${path}:${lineNumberAt(text, match.index)}`,
        message: rule.message,
      });
    }
  }
}

async function validateAccountModelDocs(
  failures: CheckFailure[],
): Promise<void> {
  const text = await readText(ACCOUNT_MODEL_DOC_PATH, failures);
  for (const term of ACCOUNT_MODEL_REQUIRED_TERMS) {
    if (text.includes(term)) continue;
    failures.push({
      path: ACCOUNT_MODEL_DOC_PATH,
      message: `Expected account model docs to include "${term}".`,
    });
  }

  const sidebar = await readText('docs/.vitepress/config.ts', failures);
  if (!sidebar.includes('/operator/account-model')) {
    failures.push({
      path: 'docs/.vitepress/config.ts',
      message: 'Expected Operator sidebar to link account model docs.',
    });
  }
}

async function main(): Promise<void> {
  const failures: CheckFailure[] = [];

  for (const path of REQUIRED_INTERNAL_DOMAIN_DOCS) {
    const text = await readText(path, failures);
    validateInternalDomainMentions(path, text, failures);
  }

  for (const path of REQUIRED_OPERATOR_BOUNDARY_DOCS) {
    const text = await readText(path, failures);
    validateOperatorBoundaryMentions(path, text, failures);
  }

  const markdownFiles = ARCHITECTURE_ALIGNMENT_DOCS;
  for (const path of markdownFiles) {
    const text = await readText(path, failures);
    validateStaleProductRootDrift(path, text, failures);
    validateForbiddenCurrentBoundaryDrift(path, text, failures);
  }

  await validateDomainDirs(failures);
  await validatePermissionScopeDocs(failures);
  await validateTakosumiModelDocs(failures);
  await validateRuntimeTargetDocs(failures);
  await validateAccountModelDocs(failures);

  if (failures.length > 0) {
    console.error('Architecture alignment validation failed:');
    for (const failure of failures) {
      console.error(`- ${failure.path}: ${failure.message}`);
    }
    runtime.exit(1);
  }

  console.log('Architecture alignment validation passed.');
  console.log(
    `Checked ${markdownFiles.length} architecture alignment markdown files.`,
  );
  console.log(`Verified ${REQUIRED_DOMAIN_DIRS.length} domain directories.`);
  console.log(
    `Verified permission scope docs in ${PERMISSION_SCOPE_DOCS.length} files.`,
  );
  console.log(
    `Verified Takosumi model docs in ${TAKOSUMI_MODEL_DOCS.length} files.`,
  );
  console.log(
    `Verified runtime target docs in ${RUNTIME_TARGET_DOCS.length} files.`,
  );
  console.log('Verified account model docs.');
}

if (import.meta.main) {
  await main();
}
