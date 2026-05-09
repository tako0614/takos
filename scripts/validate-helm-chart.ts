const chartRoot = 'deploy/helm/takos';
const templateRoot = `${chartRoot}/templates`;

const expectedServices = [
  {
    id: 'takos-app',
    deploymentFile: 'deployment-takos-app.yaml',
    serviceFile: 'service-takos-app.yaml',
    imageKey: 'takosApp',
    valuesKey: 'takosApp',
  },
  {
    id: 'takosumi',
    deploymentFile: 'deployment-takosumi.yaml',
    serviceFile: 'service-takosumi.yaml',
    imageKey: 'takosumi',
    valuesKey: 'takosumi',
  },
  {
    id: 'takosumi-cloud',
    deploymentFile: 'deployment-takosumi-cloud.yaml',
    serviceFile: 'service-takosumi-cloud.yaml',
    imageKey: 'takosumiCloud',
    valuesKey: 'takosumiCloud',
  },
  {
    id: 'takos-git',
    deploymentFile: 'deployment-takos-git.yaml',
    serviceFile: 'service-takos-git.yaml',
    imageKey: 'takosGit',
    valuesKey: 'takosGit',
  },
  {
    id: 'takos-agent',
    deploymentFile: 'deployment-takos-agent.yaml',
    serviceFile: 'service-takos-agent.yaml',
    imageKey: 'takosAgent',
    valuesKey: 'takosAgent',
  },
] as const;

const templateFiles: string[] = [];
for await (const entry of Deno.readDir(templateRoot)) {
  if (entry.isFile && entry.name.endsWith('.yaml')) {
    templateFiles.push(`${templateRoot}/${entry.name}`);
  }
}

const errors: string[] = [];
const valuesText = await Deno.readTextFile(`${chartRoot}/values.yaml`);
const globalConfigMapText = await Deno.readTextFile(
  `${templateRoot}/configmap-global.yaml`,
);

assertContains(`${chartRoot}/values.yaml`, valuesText, '  imageRegistry: ""');
assertContains(
  `${chartRoot}/values.yaml`,
  valuesText,
  '  imagePullSecrets: []',
);
assertContains(
  `${chartRoot}/values.yaml`,
  valuesText,
  '  managedResources: {}',
);
assertContains(
  `${chartRoot}/values.yaml`,
  valuesText,
  '  defaultAppDistributionJson: ""',
);
assertContains(
  `${templateRoot}/configmap-global.yaml`,
  globalConfigMapText,
  'TAKOS_MANAGED_RESOURCES_JSON: {{ toJson . | quote }}',
);
assertContains(
  `${templateRoot}/configmap-global.yaml`,
  globalConfigMapText,
  'TAKOS_DEFAULT_APP_DISTRIBUTION_JSON: {{ . | quote }}',
);
assertContains(
  `${templateRoot}/_helpers.tpl`,
  await Deno.readTextFile(`${templateRoot}/_helpers.tpl`),
  'define "takos.image"',
);
assertContains(
  `${chartRoot}/values.yaml`,
  valuesText,
  '  persistence:',
);
assertContains(
  `${chartRoot}/values.yaml`,
  valuesText,
  '    databaseUrlSecretKey: "TAKOSUMI_ACCOUNTS_DATABASE_URL"',
);

assertExactTemplateSet(
  'Deployment',
  templateFiles.filter((file) => file.includes('/deployment-')),
  expectedServices.map((service) => `${templateRoot}/${service.deploymentFile}`),
);
assertExactTemplateSet(
  'Service',
  templateFiles.filter((file) => file.includes('/service-')),
  expectedServices.map((service) => `${templateRoot}/${service.serviceFile}`),
);

for (const service of expectedServices) {
  const deploymentPath = `${templateRoot}/${service.deploymentFile}`;
  const servicePath = `${templateRoot}/${service.serviceFile}`;
  const deploymentText = await readTextIfExists(deploymentPath);
  const serviceText = await readTextIfExists(servicePath);

  assertContains(deploymentPath, deploymentText, `kind: Deployment`);
  assertContains(
    deploymentPath,
    deploymentText,
    `takos.io/service-id: ${service.id}`,
  );
  assertContains(
    deploymentPath,
    deploymentText,
    `app.kubernetes.io/component: ${service.id}`,
  );
  assertContains(
    deploymentPath,
    deploymentText,
    `image: "{{ include "takos.image" (dict "root" . "image" .Values.images.${service.imageKey}) }}"`,
  );
  assertContains(
    deploymentPath,
    deploymentText,
    '{{- with .Values.global.imagePullSecrets }}',
  );
  assertContains(
    deploymentPath,
    deploymentText,
    `containerPort: {{ .Values.services.${service.valuesKey}.port }}`,
  );

  assertContains(servicePath, serviceText, `kind: Service`);
  assertContains(
    servicePath,
    serviceText,
    `takos.io/service-id: ${service.id}`,
  );
  assertContains(
    servicePath,
    serviceText,
    `app.kubernetes.io/component: ${service.id}`,
  );
  assertContains(
    servicePath,
    serviceText,
    `port: {{ .Values.services.${service.valuesKey}.port }}`,
  );

  assertValuesKey('images', service.imageKey);
  assertImageSubkey(service.imageKey, 'registry');
  assertImageSubkey(service.imageKey, 'repository');
  assertImageSubkey(service.imageKey, 'tag');
  assertImageSubkey(service.imageKey, 'pullPolicy');
  assertValuesKey('services', service.valuesKey);
}

for (const file of templateFiles.sort()) {
  const text = await Deno.readTextFile(file);
  if (text.includes('dev:local:')) {
    errors.push(`${file} must not use dev:local commands`);
  }
  assertNoStaleWorkloadSurface(file, text);
}

{
  const path = `${templateRoot}/deployment-takosumi-cloud.yaml`;
  const text = await Deno.readTextFile(path);
  assertContains(path, text, 'initContainers:');
  assertContains(path, text, '- accounts');
  assertContains(path, text, '- migrate');
  assertContains(path, text, '--allow-read=packages/accounts-service/migrations');
  assertContains(path, text, '--allow-env=TAKOSUMI_ACCOUNTS_DATABASE_URL');
  assertContains(path, text, 'TAKOSUMI_ACCOUNTS_DATABASE_URL');
  assertContains(path, text, 'takos.accountsDatabaseSecretName');
}

for (const overlay of ['values-aws.yaml', 'values-gcp.yaml']) {
  const path = `${chartRoot}/${overlay}`;
  const text = await Deno.readTextFile(path);
  if (!text.includes('environment: production')) {
    errors.push(`${path} must set production environment`);
  }
  if (!text.includes('auth: ""') || !text.includes('runtime-agent: ""')) {
    errors.push(
      `${path} must keep production plugin ids empty/fail-closed by default`,
    );
  }
  if (/takos\.kernel\.reference/.test(text)) {
    errors.push(`${path} must not select the reference plugin in production`);
  }
  for (const service of expectedServices) {
    assertContains(path, text, `${service.valuesKey}:`);
  }
  assertNoStaleWorkloadSurface(path, text);
}

for (const ingress of ['ingress-admin.yaml', 'ingress-tenant.yaml']) {
  const path = `${templateRoot}/${ingress}`;
  const text = await Deno.readTextFile(path);
  assertContains(
    path,
    text,
    `name: {{ include "takos.fullname" . }}-takos-app`,
  );
  assertContains(path, text, `number: {{ .Values.services.takosApp.port }}`);
}

if (errors.length > 0) {
  console.error('Helm chart validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  Deno.exit(1);
}

console.log(
  JSON.stringify({
    ok: true,
    checkedTemplates: templateFiles.length,
    checkedServiceSet: expectedServices.map((service) => service.id),
    checkedOverlays: ['values-aws.yaml', 'values-gcp.yaml'],
  }),
);

function assertExactTemplateSet(
  kind: string,
  actualFiles: string[],
  expectedFiles: string[],
): void {
  const actual = actualFiles.toSorted();
  const expected = expectedFiles.toSorted();
  if (actual.length !== expected.length) {
    errors.push(
      `${kind} template set must be exactly ${expected.map(basename).join(', ')}, got ${
        actual.map(basename).join(', ')
      }`,
    );
    return;
  }
  for (const [index, expectedPath] of expected.entries()) {
    if (actual[index] !== expectedPath) {
      errors.push(
        `${kind} template set must include ${basename(expectedPath)}, got ${basename(actual[index])}`,
      );
    }
  }
}

async function readTextIfExists(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    errors.push(`missing required Helm template ${path}`);
    return '';
  }
}

function assertContains(path: string, text: string, expected: string): void {
  if (!text.includes(expected)) {
    errors.push(`${path} must contain ${expected}`);
  }
}

function assertValuesKey(section: 'images' | 'services', key: string): void {
  const pattern = new RegExp(`^${section}:\\n(?:[\\s\\S]*?\\n)?  ${key}:`, 'm');
  if (!pattern.test(valuesText)) {
    errors.push(`${chartRoot}/values.yaml must define ${section}.${key}`);
  }
}

function assertImageSubkey(imageKey: string, subkey: string): void {
  const pattern = new RegExp(
    `^  ${imageKey}:\\n(?:    [^\\n]+\\n)*    ${subkey}:`,
    'm',
  );
  if (!pattern.test(valuesText)) {
    errors.push(
      `${chartRoot}/values.yaml must define images.${imageKey}.${subkey}`,
    );
  }
}

function assertNoStaleWorkloadSurface(path: string, text: string): void {
  const stalePatterns: Array<[RegExp, string]> = [
    [/takos\.io\/process-role/, 'takos.io/process-role'],
    [/TAKOSUMI_PROCESS_ROLE/, 'TAKOSUMI_PROCESS_ROLE'],
    [/\bpaas(Api|Router|Worker|RuntimeAgent|LogWorker)\b/, 'paas* values keys'],
    [/\bociOrchestrator\b/, 'ociOrchestrator values key'],
    [
      /takosumi-(api|router|worker|runtime-agent|log-worker)/,
      'old takosumi role resource name',
    ],
  ];

  for (const [pattern, label] of stalePatterns) {
    if (pattern.test(text)) {
      errors.push(`${path} must not contain stale ${label}`);
    }
  }
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path;
}
