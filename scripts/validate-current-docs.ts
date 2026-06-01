import * as runtime from "./runtime.ts";
const checks: Array<() => Promise<string[]>> = [
  validateRemovedHistoricalDocs,
  validateVitePressExcludesNonCurrentDocs,
  validateContributingIndex,
  validateCurrentInstallDocs,
  validateCanonicalLayoutDocs,
];

const errors = (await Promise.all(checks.map((check) => check()))).flat();

if (errors.length > 0) {
  console.error(errors.join('\n'));
  runtime.exit(1);
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
  const config = await runtime.readTextFile('docs/.vitepress/config.ts');
  const errors: string[] = [];
  for (const required of ["'contributing/**'", "'releases/**'"]) {
    if (!config.includes(required)) {
      errors.push(`docs/.vitepress/config.ts: srcExclude must include ${required}`);
    }
  }
  return errors;
}

async function validateContributingIndex(): Promise<string[]> {
  const index = await runtime.readTextFile('docs/contributing/index.md');
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

async function validateCurrentInstallDocs(): Promise<string[]> {
  const files = [
    'docs/platform/upgrade-export.md',
    'docs/apps/install-paths.md',
    'docs/index.md',
    'docs/get-started/index.md',
    'docs/overview/index.md',
    'docs/operator/account-model.md',
    'docs/deploy/rollback.md',
    'docs/hosting/index.md',
    'docs/hosting/cloudflare.md',
  ];
  const errors: string[] = [];
  for (const path of files) {
    const text = await runtime.readTextFile(path);
    for (
      const forbidden of [
        '400 mutable-ref-rejected',
        'installation.upgrade-failed',
        'database migration: yes',
        'migration checkpoint',
        '過去 N 世代',
        'takosumi install ./takos.bundle',
        'takosumi install bundle --to',
        'データや設定はそのまま引き継がれます',
        'dedicated-runtime-appinstallation-adoption',
        'Takos がソースを保証する',
        'ユーザーのデータ主権を保証',
        '途中で path を乗り換えても所有・data namespace',
        '後から乗り換えられる',
        '最初の選択を間違えても所有権と data はそのまま持ち越せる',
        'データや設定を保ったまま dedicated runtime に materialize',
        '既存のアプリをエクスポートして持ち出すこともできます',
        'Export は「data を移植し',
        'runtime を戻します',
        'Takosumi kernel は 5 つのホスティング先に対応しています',
        'operator が残すのは初回 admin login のみ',
        'データもアイデンティティも自分のもの',
        '完全退出。利用者自身',
      ]
    ) {
      if (text.includes(forbidden)) {
        errors.push(`${path}: remove stale current install wording '${forbidden}'`);
      }
    }
  }
  const upgradeExport = await runtime.readTextFile('docs/platform/upgrade-export.md');
  for (
    const required of [
      'Accounts 台帳操作',
      'binding-level review',
      'ledger revision primitive',
      'current guarantee としては扱わない',
    ]
  ) {
    if (!includesRequiredText(upgradeExport, required)) {
      errors.push(`docs/platform/upgrade-export.md: missing current revision boundary '${required}'`);
    }
  }
  const rollback = await runtime.readTextFile('docs/deploy/rollback.md');
  if (
    !rollback.includes(
      'provider data copy / schema migration の巻き戻しは rollback の current guarantee ではありません',
    )
  ) {
    errors.push('docs/deploy/rollback.md: missing current rollback data boundary');
  }
  const hostingIndex = await runtime.readTextFile('docs/hosting/index.md');
  if (
    !includesRequiredText(
      hostingIndex,
      'target ごとの production parity は operator evidence で確認する必要があります',
    )
  ) {
    errors.push('docs/hosting/index.md: missing target parity evidence boundary');
  }
  const cloudflareHosting = await runtime.readTextFile('docs/hosting/cloudflare.md');
  if (
    !includesRequiredText(
      cloudflareHosting,
      'launch-readiness evidence / operator approval / staged rehearsal',
    )
  ) {
    errors.push('docs/hosting/cloudflare.md: missing public managed offering readiness boundary');
  }
  return errors;
}

async function validateCanonicalLayoutDocs(): Promise<string[]> {
  const files = [
    'README.md',
    'AGENTS.md',
    'docs/architecture/system-architecture.md',
    'docs/architecture/service-topology.md',
    'docs/architecture/diagrams.md',
    'docs/contributing/current-state.md',
    'docs/get-started/local-shell.md',
    'docs/get-started/local-development.md',
    'docs/hosting/cloudflare.md',
    'docs/hosting/local.md',
    'docs/hosting/self-hosted.md',
  ];
  const forbidden = [
    'takos/app/',
    'takos/git/',
    'takos/agent/',
    '`app/`',
    '`git/`',
    '`agent/`',
    '`takos-app`',
    'apps/api',
    'apps/control',
    'packages/control',
    'packages/common',
    'packages/api-contract',
    'packages/actions-engine',
    'packages/deploy-' + 'intent',
    'wrangler.worker.toml',
    'apps/web',
  ];
  const required = [
    'src/worker',
    'web',
    'containers/git',
    'containers/agent',
  ];
  const errors: string[] = [];
  for (const path of files) {
    const text = await runtime.readTextFile(path);
    for (const term of forbidden) {
      if (text.includes(term)) {
        errors.push(`${path}: remove stale Takos split layout reference '${term}'`);
      }
    }
  }
  const currentState = await runtime.readTextFile('docs/contributing/current-state.md');
  for (const term of required) {
    if (!currentState.includes(term)) {
      errors.push(`docs/contributing/current-state.md: missing canonical layout reference '${term}'`);
    }
  }
  return errors;
}

function includesRequiredText(text: string, required: string): boolean {
  return text.includes(required) ||
    text.replace(/\s+/g, ' ').includes(required.replace(/\s+/g, ' '));
}

async function exists(path: string): Promise<boolean> {
  try {
    await runtime.stat(path);
    return true;
  } catch (error) {
    if (error instanceof runtime.errors.NotFound) return false;
    throw error;
  }
}
