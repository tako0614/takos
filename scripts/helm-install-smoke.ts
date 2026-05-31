type HelmCase = {
  name: string;
  release: string;
  valuesFile?: string;
};

type HelmStep = {
  name: string;
  command: string[];
  status: 'passed' | 'failed';
  stdoutBytes: number;
  stderr: string;
};

type HelmCommandResult = {
  step: HelmStep;
  stdout: string;
};

type ManifestDoc = {
  kind: string;
  name: string;
  serviceId: string | null;
};

type InstallCaseResult = {
  name: string;
  release: string;
  valuesFile: string | null;
  status: 'passed' | 'failed';
  steps: HelmStep[];
  observedServiceIds: string[];
  missingResources: string[];
};

const chartRoot = 'deploy/helm/takos';
const smokeCrdsChartRoot = 'deploy/helm/takos/testdata/helm-smoke-crds';
const namespace = 'takos-install-smoke';
const installTestCrds = Deno.env.get('TAKOS_HELM_INSTALL_TEST_CRDS') === '1';
const expectedServiceIds = [
  'takos-worker',
  'takosumi',
  'takos-git',
  'takos-agent',
];
const cases: HelmCase[] = [
  {
    name: 'base-install',
    release: 'takos-smoke-base',
  },
  {
    name: 'aws-install',
    release: 'takos-smoke-aws',
    valuesFile: `${chartRoot}/values-aws.yaml`,
  },
  {
    name: 'gcp-install',
    release: 'takos-smoke-gcp',
    valuesFile: `${chartRoot}/values-gcp.yaml`,
  },
];

const version = await runHelm(['version', '--short']);
if (!version.success) {
  console.error(
    'Helm CLI is required for this smoke. Install Helm v3 and point it at a Kubernetes cluster.',
  );
  console.error(version.stderr);
  Deno.exit(1);
}

const cluster = await runHelm(['list', '--namespace', namespace]);
if (!cluster.success && isClusterUnreachable(cluster.stderr)) {
  console.error(
    'A reachable Kubernetes cluster is required for helm:install-smoke. Start kind/k3d or point Helm at a production kubeconfig.',
  );
  console.error(cluster.stderr);
  Deno.exit(1);
}

const setupResults: HelmStep[] = [];
if (installTestCrds) {
  setupResults.push(
    (await runHelmStep('install-smoke-crds', [
      'upgrade',
      '--install',
      'takos-helm-smoke-crds',
      smokeCrdsChartRoot,
      '--namespace',
      namespace,
      '--create-namespace',
      '--wait',
    ])).step,
  );
}

const results: InstallCaseResult[] = [];
if (setupResults.every((result) => result.status === 'passed')) {
  for (const testCase of cases) {
    results.push(await runInstallCase(testCase));
  }
}

const cleanupResults: HelmStep[] = [];
if (installTestCrds) {
  cleanupResults.push(
    (await runHelmStep('uninstall-smoke-crds', [
      'uninstall',
      'takos-helm-smoke-crds',
      '--namespace',
      namespace,
      '--ignore-not-found',
    ])).step,
  );
}

const failedSetup = setupResults.filter((result) => result.status === 'failed');
const failedCases = results.filter((result) => result.status === 'failed');
const failedCleanup = cleanupResults.filter((result) => result.status === 'failed');
const summary = {
  ok: failedSetup.length === 0 &&
    failedCases.length === 0 &&
    failedCleanup.length === 0,
  helmVersion: version.stdout.trim(),
  chartRoot,
  smokeCrdsChartRoot,
  namespace,
  installTestCrds,
  expectedServiceIds,
  setupResults,
  results,
  cleanupResults,
};

console.log(JSON.stringify(summary, null, 2));

if (!summary.ok) {
  Deno.exit(1);
}

async function runInstallCase(testCase: HelmCase): Promise<InstallCaseResult> {
  const steps: HelmStep[] = [];
  steps.push(
    (await runHelmStep('cleanup-before-install', [
      'uninstall',
      testCase.release,
      '--namespace',
      namespace,
      '--ignore-not-found',
    ])).step,
  );

  const installArgs = [
    'install',
    testCase.release,
    chartRoot,
    '--namespace',
    namespace,
    '--create-namespace',
  ];
  if (testCase.valuesFile) {
    installArgs.push('-f', testCase.valuesFile);
  }
  steps.push((await runHelmStep('install', installArgs)).step);

  let observedServiceIds: string[] = [];
  let missingResources = expectedServiceIds.flatMap((serviceId) => [
    `Deployment/${testCase.release}-${serviceId}`,
    `Service/${testCase.release}-${serviceId}`,
  ]);

  if (steps.at(-1)?.status === 'passed') {
    steps.push(
      (await runHelmStep('status', [
        'status',
        testCase.release,
        '--namespace',
        namespace,
      ])).step,
    );
    const manifest = await runHelmStep('get-manifest', [
      'get',
      'manifest',
      testCase.release,
      '--namespace',
      namespace,
    ]);
    steps.push(manifest.step);
    if (manifest.step.status === 'passed') {
      const inventory = inspectManifest(testCase.release, manifest.stdout);
      observedServiceIds = inventory.observedServiceIds;
      missingResources = inventory.missingResources;
    }
  }

  steps.push(
    (await runHelmStep('cleanup-after-install', [
      'uninstall',
      testCase.release,
      '--namespace',
      namespace,
      '--ignore-not-found',
    ])).step,
  );

  const status = steps.every((step) => step.status === 'passed') &&
      missingResources.length === 0
    ? 'passed'
    : 'failed';
  return {
    name: testCase.name,
    release: testCase.release,
    valuesFile: testCase.valuesFile ?? null,
    status,
    steps,
    observedServiceIds,
    missingResources,
  };
}

async function runHelmStep(
  name: string,
  args: string[],
): Promise<HelmCommandResult> {
  const output = await runHelm(args);
  return {
    step: {
      name,
      command: ['helm', ...args],
      status: output.success ? 'passed' : 'failed',
      stdoutBytes: output.stdout.length,
      stderr: output.stderr,
    },
    stdout: output.stdout,
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

function inspectManifest(
  release: string,
  manifest: string,
): { observedServiceIds: string[]; missingResources: string[] } {
  const docs = parseManifestDocs(manifest);
  const observedServiceIds = [
    ...new Set(docs.flatMap((doc) => doc.serviceId ? [doc.serviceId] : [])),
  ].sort();
  const missingResources: string[] = [];

  for (const serviceId of expectedServiceIds) {
    for (const kind of ['Deployment', 'Service']) {
      const name = `${release}-${serviceId}`;
      const found = docs.some((doc) => doc.kind === kind && doc.name === name && doc.serviceId === serviceId);
      if (!found) {
        missingResources.push(`${kind}/${name}`);
      }
    }
  }

  return { observedServiceIds, missingResources };
}

function parseManifestDocs(manifest: string): ManifestDoc[] {
  return manifest.split(/^---\s*$/m)
    .map((doc) => doc.trim())
    .filter((doc) => doc.length > 0)
    .map((doc) => ({
      kind: matchYamlScalar(doc, 'kind') ?? '',
      name: matchMetadataName(doc) ?? '',
      serviceId: matchServiceId(doc),
    }))
    .filter((doc) => doc.kind && doc.name);
}

function matchYamlScalar(text: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^${escapedKey}:\\s*"?([^"\\n#]+)"?`, 'm'));
  return match?.[1]?.trim() ?? null;
}

function matchMetadataName(text: string): string | null {
  const match = text.match(/^metadata:\n(?:[ ]{2}.+\n)*?[ ]{2}name:\s*"?([^"\n#]+)"?/m);
  return match?.[1]?.trim() ?? null;
}

function matchServiceId(text: string): string | null {
  const match = text.match(/takos\.io\/service-id:\s*"?([^"\n#]+)"?/);
  return match?.[1]?.trim() ?? null;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trimEnd();
}

function isClusterUnreachable(stderr: string): boolean {
  return stderr.includes('Kubernetes cluster unreachable') ||
    stderr.includes('connect: connection refused');
}
