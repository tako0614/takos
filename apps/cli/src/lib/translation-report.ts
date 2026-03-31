import chalk from 'chalk';

export type TranslationIssue = {
  category: 'resource' | 'workload' | 'route';
  name: string;
  message: string;
};

type ResourceTranslationEntry = {
  resolutionMode?: 'cloudflare-native' | 'provider-backed' | 'takos-runtime' | 'unsupported';
};

type WorkloadTranslationEntry = {
  status?: 'native' | 'portable' | 'unsupported';
};

type RouteTranslationEntry = {
  status?: 'native' | 'portable' | 'unsupported';
};

export type TranslationReport = {
  provider: string;
  supported: boolean;
  requirements?: string[];
  resources?: ResourceTranslationEntry[];
  workloads?: WorkloadTranslationEntry[];
  routes?: RouteTranslationEntry[];
  unsupported: TranslationIssue[];
};

function describeBackend(provider: string): string {
  switch (provider) {
    case 'cloudflare':
      return 'Cloudflare backend';
    case 'aws':
      return 'AWS compatibility backend';
    case 'gcp':
      return 'GCP compatibility backend';
    case 'k8s':
      return 'Kubernetes compatibility backend';
    case 'local':
      return 'local compatibility backend';
    default:
      return `${provider} backend`;
  }
}

function formatSummary<T extends string>(
  entries: Array<T | undefined> | undefined,
  order: readonly T[],
): string | null {
  if (!entries || entries.length === 0) return null;
  const counts = new Map<T, number>();
  for (const entry of entries) {
    if (!entry) continue;
    counts.set(entry, (counts.get(entry) ?? 0) + 1);
  }
  const parts = order
    .filter((key) => (counts.get(key) ?? 0) > 0)
    .map((key) => `${key}=${counts.get(key)}`);
  return parts.length > 0 ? parts.join(', ') : null;
}

export function printTranslationReport(report: TranslationReport): void {
  console.log(chalk.bold('Translation:'));
  console.log('  Spec:     Cloudflare-native');
  console.log('  Runtime:  Takos runtime');
  console.log(`  Backend:  ${describeBackend(report.provider)}`);
  console.log(`  Status:   ${report.supported ? chalk.green('supported') : chalk.yellow('blocked')}`);

  if (report.requirements && report.requirements.length > 0) {
    console.log(`  Needs:    ${report.requirements.join(', ')}`);
  }

  const resourceSummary = formatSummary(
    report.resources?.map((entry) => entry.resolutionMode),
    ['cloudflare-native', 'provider-backed', 'takos-runtime', 'unsupported'],
  );
  if (resourceSummary) {
    console.log(`  Resources: ${resourceSummary}`);
  }

  const workloadSummary = formatSummary(
    report.workloads?.map((entry) => entry.status),
    ['native', 'portable', 'unsupported'],
  );
  if (workloadSummary) {
    console.log(`  Workloads: ${workloadSummary}`);
  }

  const routeSummary = formatSummary(
    report.routes?.map((entry) => entry.status),
    ['native', 'portable', 'unsupported'],
  );
  if (routeSummary) {
    console.log(`  Routes:   ${routeSummary}`);
  }

  if (report.unsupported.length > 0) {
    console.log('');
    console.log(chalk.bold('Blocked:'));
    for (const issue of report.unsupported) {
      console.log(`  ${chalk.red('!')} ${issue.category}.${issue.name} ${issue.message}`);
    }
  }

  console.log('');
}
