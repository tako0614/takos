import * as runtime from "./runtime.ts";
type DistributionManifest = {
  target?: {
    id?: string;
  };
  operatorProfile?: {
    distribution?: string;
    profileId?: string;
    implementationIds?: string[];
  };
  routing?: {
    adminBaseUrl?: string;
    accountsBaseUrl?: string;
    wildcardDomain?: string;
  };
  services?: Array<{
    serviceId?: string;
    image?: string;
  }>;
};

type OverlayTarget = {
  targetId: 'aws' | 'gcp';
  manifestPath: string;
  outputPath: string;
};

type ImageRef = {
  registry: string;
  repository: string;
  tag: string;
};

const targets: OverlayTarget[] = [
  {
    targetId: 'aws',
    manifestPath: 'deploy/distributions/aws.json',
    outputPath: 'deploy/helm/takos/values-aws.yaml',
  },
  {
    targetId: 'gcp',
    manifestPath: 'deploy/distributions/gcp.json',
    outputPath: 'deploy/helm/takos/values-gcp.yaml',
  },
];

const serviceValueKeys: Record<string, string> = {
  'takos-worker': 'takosWorker',
  takosumi: 'takosumi',
  'takosumi-accounts': 'takosumiAccounts',
  'takos-git': 'takosGit',
  'takos-agent': 'takosAgent',
};

const check = runtime.args.includes('--check');
const unknownArgs = runtime.args.filter((arg) => arg !== '--check');

if (unknownArgs.length > 0) {
  console.error(`Unknown argument(s): ${unknownArgs.join(', ')}`);
  console.error(
    'Usage: bun scripts/generate-helm-overlays.ts [--check]',
  );
  runtime.exit(2);
}

const results = [];
let hasDrift = false;

for (const target of targets) {
  const manifest = await readManifest(target);
  const generated = generateOverlay(target, manifest);

  if (check) {
    const current = await runtime.readTextFile(target.outputPath);
    const matches = current === generated;
    results.push({
      target: target.targetId,
      outputPath: target.outputPath,
      status: matches ? 'in-sync' : 'drift',
    });
    if (!matches) hasDrift = true;
  } else {
    await runtime.writeTextFile(target.outputPath, generated);
    results.push({
      target: target.targetId,
      outputPath: target.outputPath,
      status: 'written',
    });
  }
}

if (hasDrift) {
  console.error(
    'Helm overlay generation drift detected. Run `bun run helm:generate-overlays`.',
  );
  console.error(JSON.stringify({ ok: false, check, results }, null, 2));
  runtime.exit(1);
}

console.log(JSON.stringify({ ok: true, check, results }, null, 2));

async function readManifest(
  target: OverlayTarget,
): Promise<DistributionManifest> {
  const parsed = JSON.parse(await runtime.readTextFile(target.manifestPath)) as DistributionManifest;
  if (parsed.target?.id !== target.targetId) {
    throw new Error(
      `${target.manifestPath} target.id must be ${target.targetId}`,
    );
  }
  return parsed;
}

function generateOverlay(
  target: OverlayTarget,
  manifest: DistributionManifest,
): string {
  const adminDomain = hostname(manifest.routing?.adminBaseUrl);
  const accountsDomain = hostname(manifest.routing?.accountsBaseUrl);
  const tenantBase = tenantBaseDomain(manifest.routing?.wildcardDomain);
  const images = collectImages(target, manifest);
  const provider = providerConfig(target.targetId);
  const operatorProfile = profileConfig(target, manifest);

  const lines = [
    `# ${provider.label} fail-closed overlay template.`,
    `# Generated from ${target.manifestPath} by scripts/generate-helm-overlays.ts.`,
    '# Re-run `bun run helm:generate-overlays` after editing the distribution profile.',
    '# This file is not a complete production profile by itself: the operator',
    '# must provide implementationIds through OpenTofu/operator-owned values.',
    `# Usage: helm install takos . -f values.yaml -f ${basename(target.outputPath)}`,
    '',
    'images:',
    ...renderImages(images),
    '',
    'runtimeConfig:',
    '  environment: production',
    '  operatorProfile:',
    `    distribution: ${quote(operatorProfile.distribution)}`,
    `    profileId: ${quote(operatorProfile.profileId)}`,
    '    # Empty implementationIds keep this overlay fail-closed until the',
    '    # operator/OpenTofu values select concrete provider implementations.',
    '    implementationIds: []',
    '',
    `# ${provider.label} managed-resource identifiers can be supplied by the OpenTofu`,
    '# bridge values overlay. Credentials and secret material stay in takos-private',
    '# or external secrets, not in generated Helm values.',
    '',
    '# Production domains',
    'domains:',
    `  admin: ${quote(adminDomain)}`,
    `  tenantBase: ${quote(tenantBase)}`,
    `  accounts: ${quote(accountsDomain)}`,
    '',
    '# Empty values keep the chart default secret names derived from the Helm release:',
    '# <release>-platform, <release>-auth, <release>-llm. Set a field only when an',
    '# external secret uses a different name.',
    'secrets:',
    '  create: false',
    '  existingSecrets:',
    '    platform: ""',
    '    auth: ""',
    '    llm: ""',
    '',
    `# ${provider.ingressLabel}`,
    'ingress:',
    '  enabled: true',
    `  className: ${quote(provider.ingressClass)}`,
    '  annotations:',
    ...provider.annotations,
    ...provider.gcpManagedCertificate,
    '  tls:',
    ...provider.tls,
    '',
    '# Production resource tuning',
    'services:',
    '  takosWorker:',
    '    replicaCount: 3',
    '    resources:',
    '      requests:',
    '        cpu: 500m',
    '        memory: 1Gi',
    '      limits:',
    '        cpu: "2"',
    '        memory: 2Gi',
    '  takosumi:',
    '    replicaCount: 3',
    '  takosumiAccounts:',
    '    replicaCount: 2',
    '  takosGit:',
    '    replicaCount: 2',
    '  takosAgent:',
    '    replicaCount: 2',
    '',
    `# ${provider.serviceAccountComment}`,
    'serviceAccount:',
    '  create: true',
    '  annotations:',
    ...provider.serviceAccountAnnotations,
  ];

  return `${lines.join('\n')}\n`;
}

function profileConfig(
  target: OverlayTarget,
  manifest: DistributionManifest,
): { distribution: string; profileId: string } {
  const operatorProfile = manifest.operatorProfile;
  const expected = `operator.takosumi.${target.targetId}`;
  if (operatorProfile?.distribution !== 'takosumi') {
    throw new Error(`${target.manifestPath} operatorProfile.distribution must be takosumi`);
  }
  if (operatorProfile.profileId !== expected) {
    throw new Error(`${target.manifestPath} operatorProfile.profileId must be ${expected}`);
  }
  return {
    distribution: operatorProfile.distribution,
    profileId: operatorProfile.profileId,
  };
}

function collectImages(
  target: OverlayTarget,
  manifest: DistributionManifest,
): Record<string, ImageRef> {
  const images: Record<string, ImageRef> = {};
  for (const service of manifest.services ?? []) {
    const serviceId = service.serviceId;
    if (!serviceId) continue;
    const key = serviceValueKeys[serviceId];
    if (!key) continue;
    if (!service.image) {
      throw new Error(
        `${target.manifestPath} service ${serviceId} must declare image`,
      );
    }
    images[key] = parseImageRef(service.image);
  }

  for (const key of Object.values(serviceValueKeys)) {
    if (!images[key]) {
      throw new Error(`${target.manifestPath} missing image for ${key}`);
    }
  }
  return images;
}

function renderImages(images: Record<string, ImageRef>): string[] {
  return Object.entries(images).flatMap(([key, image]) => [
    `  ${key}:`,
    `    registry: ${image.registry}`,
    `    repository: ${image.repository}`,
    `    tag: ${quote(image.tag)}`,
    '    pullPolicy: IfNotPresent',
  ]);
}

function parseImageRef(ref: string): ImageRef {
  const lastSlash = ref.lastIndexOf('/');
  const tagSeparator = ref.lastIndexOf(':');
  if (tagSeparator <= lastSlash) {
    throw new Error(`Image ref must include an explicit tag: ${ref}`);
  }

  const name = ref.slice(0, tagSeparator);
  const tag = ref.slice(tagSeparator + 1);
  const [firstSegment, ...rest] = name.split('/');
  if (
    rest.length > 0 &&
    (firstSegment.includes('.') ||
      firstSegment.includes(':') ||
      firstSegment === 'localhost')
  ) {
    return {
      registry: firstSegment,
      repository: rest.join('/'),
      tag,
    };
  }

  return {
    registry: '',
    repository: name,
    tag,
  };
}

function providerConfig(targetId: 'aws' | 'gcp') {
  if (targetId === 'aws') {
    return {
      label: 'AWS',
      ingressLabel: 'AWS ALB Ingress',
      ingressClass: 'alb',
      annotations: [
        '    alb.ingress.kubernetes.io/scheme: internet-facing',
        '    alb.ingress.kubernetes.io/target-type: ip',
        '    alb.ingress.kubernetes.io/listen-ports: \'[{"HTTPS":443}]\'',
        '    alb.ingress.kubernetes.io/certificate-arn: "" # Set to ACM certificate ARN',
      ],
      gcpManagedCertificate: [],
      tls: ['    enabled: false # ALB handles TLS termination via ACM'],
      serviceAccountComment: 'EKS service account for IAM roles (IRSA)',
      serviceAccountAnnotations: [
        '    eks.amazonaws.com/role-arn: "" # Set to IAM role ARN',
      ],
    };
  }

  return {
    label: 'GCP',
    ingressLabel: 'GCE Ingress',
    ingressClass: 'gce',
    annotations: [
      '    kubernetes.io/ingress.global-static-ip-name: "" # Set to reserved static IP name',
      '    networking.gke.io/managed-certificates: "takos-managed-cert"',
    ],
    gcpManagedCertificate: [
      '  gcpManagedCertificate:',
      '    enabled: true',
      '    name: "takos-managed-cert"',
      '    domains: []',
    ],
    tls: ['    enabled: false # GCP managed certificates handle TLS'],
    serviceAccountComment: 'GKE Workload Identity for Kubernetes API/cloud integrations.',
    serviceAccountAnnotations: [
      '    iam.gke.io/gcp-service-account: "" # Set to GCP service account email',
    ],
  };
}

function hostname(value: string | undefined): string {
  if (!value) throw new Error('routing.adminBaseUrl is required');
  return new URL(value).hostname;
}

function tenantBaseDomain(value: string | undefined): string {
  if (!value) throw new Error('routing.wildcardDomain is required');
  return value.startsWith('*.') ? value.slice(2) : value;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path;
}
