type HelmCase = {
  name: string;
  args: string[];
  requiresCluster?: boolean;
};

type HelmResult = {
  name: string;
  command: string[];
  status: 'passed' | 'failed' | 'skipped';
  stdoutBytes: number;
  stderr: string;
};

const chartRoot = 'deploy/helm/takos';
const smokeCrdsChartRoot = 'deploy/helm/takos/testdata/helm-smoke-crds';
const namespace = 'takos-system';
const requireInstallDryRun = Deno.env.get('TAKOS_HELM_REQUIRE_INSTALL_DRY_RUN') === '1';
const installTestCrds = Deno.env.get('TAKOS_HELM_INSTALL_TEST_CRDS') === '1';
const cases: HelmCase[] = [
  {
    name: 'base-template',
    args: ['template', 'takos', chartRoot, '--namespace', namespace],
  },
  {
    name: 'aws-template',
    args: [
      'template',
      'takos',
      chartRoot,
      '--namespace',
      namespace,
      '-f',
      `${chartRoot}/values-aws.yaml`,
    ],
  },
  {
    name: 'gcp-template',
    args: [
      'template',
      'takos',
      chartRoot,
      '--namespace',
      namespace,
      '-f',
      `${chartRoot}/values-gcp.yaml`,
    ],
  },
  {
    name: 'base-install-dry-run',
    args: [
      'install',
      'takos',
      chartRoot,
      '--namespace',
      namespace,
      '--create-namespace',
      '--dry-run=client',
      '--debug',
    ],
    requiresCluster: true,
  },
  {
    name: 'aws-install-dry-run',
    args: [
      'install',
      'takos',
      chartRoot,
      '--namespace',
      namespace,
      '--create-namespace',
      '-f',
      `${chartRoot}/values-aws.yaml`,
      '--dry-run=client',
      '--debug',
    ],
    requiresCluster: true,
  },
  {
    name: 'gcp-install-dry-run',
    args: [
      'install',
      'takos',
      chartRoot,
      '--namespace',
      namespace,
      '--create-namespace',
      '-f',
      `${chartRoot}/values-gcp.yaml`,
      '--dry-run=client',
      '--debug',
    ],
    requiresCluster: true,
  },
];

const version = await runHelm(['version', '--short']);
if (!version.success) {
  console.error(
    'Helm CLI is required for this smoke. Install Helm v3 or run it in CI via azure/setup-helm.',
  );
  console.error(version.stderr);
  Deno.exit(1);
}

const setupResults: HelmResult[] = [];
if (installTestCrds) {
  setupResults.push(
    await runHelmCase({
      name: 'install-smoke-crds',
      args: [
        'upgrade',
        '--install',
        'takos-helm-smoke-crds',
        smokeCrdsChartRoot,
        '--namespace',
        namespace,
        '--create-namespace',
        '--wait',
      ],
    }),
  );
}

const results: HelmResult[] = [];
if (setupResults.every((result) => result.status === 'passed')) {
  for (const testCase of cases) {
    results.push(await runHelmCase(testCase));
  }
}

const cleanupResults: HelmResult[] = [];
if (
  installTestCrds &&
  setupResults.every((result) => result.status === 'passed')
) {
  cleanupResults.push(
    await runHelmCase({
      name: 'uninstall-smoke-crds',
      args: [
        'uninstall',
        'takos-helm-smoke-crds',
        '--namespace',
        namespace,
      ],
    }),
  );
}

const failed = results.filter((result) => result.status === 'failed');
const setupFailed = setupResults.filter((result) => result.status === 'failed');
const summary = {
  ok: setupFailed.length === 0 && failed.length === 0,
  helmVersion: version.stdout.trim(),
  chartRoot,
  smokeCrdsChartRoot,
  namespace,
  requireInstallDryRun,
  installTestCrds,
  setupResults,
  results,
  cleanupResults,
};

console.log(JSON.stringify(summary, null, 2));

if (setupFailed.length > 0 || failed.length > 0) {
  Deno.exit(1);
}

async function runHelmCase(testCase: HelmCase): Promise<HelmResult> {
  const output = await runHelm(testCase.args);
  const skipped = testCase.requiresCluster &&
    !requireInstallDryRun &&
    isClusterUnreachable(output.stderr);
  return {
    name: testCase.name,
    command: ['helm', ...testCase.args],
    status: output.success ? 'passed' : skipped ? 'skipped' : 'failed',
    stdoutBytes: output.stdout.length,
    stderr: skipped ? installDryRunSkipReason() : output.stderr,
  };
}

async function runHelm(args: string[]): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
}> {
  try {
    const output = await new Deno.Command('helm', {
      args,
      stdout: 'piped',
      stderr: 'piped',
    }).output();
    return {
      success: output.success,
      stdout: decode(output.stdout),
      stderr: decode(output.stderr),
    };
  } catch (error) {
    return {
      success: false,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trimEnd();
}

function isClusterUnreachable(stderr: string): boolean {
  return stderr.includes('Kubernetes cluster unreachable') ||
    stderr.includes('connect: connection refused');
}

function installDryRunSkipReason(): string {
  return 'Kubernetes cluster unreachable; install dry-run skipped because TAKOS_HELM_REQUIRE_INSTALL_DRY_RUN is not set to 1.';
}
