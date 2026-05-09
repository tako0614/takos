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

const expectedServiceIds = new Set<string>(
  expectedServices.map((service) => service.id),
);
const helmRoot = 'deploy/helm/takos';
const helmTemplateDir = `${helmRoot}/templates`;

type Finding = {
  file: string;
  line: number;
  value: string;
};

const errors: string[] = [];
const targets = await readTargets();
const valuesText = await Deno.readTextFile(`${helmRoot}/values.yaml`);

assertContains(`${helmRoot}/values.yaml`, valuesText, '  imageRegistry: ""');
assertContains(`${helmRoot}/values.yaml`, valuesText, '  imagePullSecrets: []');
assertContains(
  `${helmTemplateDir}/_helpers.tpl`,
  await Deno.readTextFile(`${helmTemplateDir}/_helpers.tpl`),
  'define "takos.image"',
);

for (const service of expectedServices) {
  const deploymentPath = `${helmTemplateDir}/${service.deploymentFile}`;
  const servicePath = `${helmTemplateDir}/${service.serviceFile}`;
  const deploymentText = await readRequiredText(deploymentPath);
  const serviceText = await readRequiredText(servicePath);

  assertTemplateHasServiceId(deploymentPath, deploymentText, service.id);
  assertTemplateHasServiceId(servicePath, serviceText, service.id);
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

const findings = targets.flatMap(({ path, text }) => collectFindings(path, text));
for (const finding of findings) {
  if (!expectedServiceIds.has(finding.value)) {
    errors.push(
      `${finding.file}:${finding.line} has undocumented service id '${finding.value}'`,
    );
  }
}

for (const service of expectedServices) {
  if (!findings.some((finding) => finding.value === service.id)) {
    errors.push(`missing service id '${service.id}'`);
  }
}

for (const { path, text } of targets) {
  assertNoStaleProcessRoleSurface(path, text);
}

if (errors.length > 0) {
  console.error('Service set validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  Deno.exit(1);
}

console.log(
  `Validated ${expectedServices.length} Takos services across ${targets.length} Helm template files (${findings.length} service-id labels).`,
);

async function readTargets(): Promise<Array<{ path: string; text: string }>> {
  const entries: Array<{ path: string; text: string }> = [];

  for await (const entry of Deno.readDir(helmTemplateDir)) {
    if (!entry.isFile) continue;
    if (!/\.(ya?ml|tpl|txt)$/.test(entry.name)) continue;

    const path = `${helmTemplateDir}/${entry.name}`;
    entries.push({ path, text: await Deno.readTextFile(path) });
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

async function readRequiredText(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    errors.push(`missing required Helm template ${path}`);
    return '';
  }
}

function assertTemplateHasServiceId(
  path: string,
  text: string,
  serviceId: string,
): void {
  assertContains(path, text, `takos.io/service-id: ${serviceId}`);
  assertContains(path, text, `app.kubernetes.io/component: ${serviceId}`);
}

function assertContains(path: string, text: string, expected: string): void {
  if (!text.includes(expected)) {
    errors.push(`${path} must contain ${expected}`);
  }
}

function assertValuesKey(section: 'images' | 'services', key: string): void {
  const pattern = new RegExp(`^${section}:\\n(?:[\\s\\S]*?\\n)?  ${key}:`, 'm');
  if (!pattern.test(valuesText)) {
    errors.push(`${helmRoot}/values.yaml must define ${section}.${key}`);
  }
}

function assertImageSubkey(imageKey: string, subkey: string): void {
  const pattern = new RegExp(
    `^  ${imageKey}:\\n(?:    [^\\n]+\\n)*    ${subkey}:`,
    'm',
  );
  if (!pattern.test(valuesText)) {
    errors.push(`${helmRoot}/values.yaml must define images.${imageKey}.${subkey}`);
  }
}

function collectFindings(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const labelPattern = /takos\.io\/service-id:\s*([^\n]+)/g;

  for (const match of text.matchAll(labelPattern)) {
    findings.push({
      file,
      line: lineOf(text, match.index ?? 0),
      value: unquote(stripInlineComment(match[1])),
    });
  }

  return findings;
}

function assertNoStaleProcessRoleSurface(path: string, text: string): void {
  const stalePatterns: Array<[RegExp, string]> = [
    [/takos\.io\/process-role/, 'takos.io/process-role'],
    [/TAKOSUMI_PROCESS_ROLE/, 'TAKOSUMI_PROCESS_ROLE'],
    [/\bpaas(Api|Router|Worker|RuntimeAgent|LogWorker)\b/, 'paas* values keys'],
    [/\bociOrchestrator\b/, 'ociOrchestrator values key'],
    [/takosumi-(api|router|worker|runtime-agent|log-worker)/, 'old takosumi role resource name'],
  ];

  for (const [pattern, label] of stalePatterns) {
    if (pattern.test(text)) {
      errors.push(`${path} must not contain stale ${label}`);
    }
  }
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function stripInlineComment(value: string): string {
  const quote = value.trimStart()[0];
  if (quote === '"' || quote === "'") return value;
  return value.replace(/\s+#.*$/, '');
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}
