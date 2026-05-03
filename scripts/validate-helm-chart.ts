const chartRoot = "deploy/helm/takos";
const templateRoot = `${chartRoot}/templates`;

const templateFiles: string[] = [];
for await (const entry of Deno.readDir(templateRoot)) {
  if (entry.isFile && entry.name.endsWith(".yaml")) {
    templateFiles.push(`${templateRoot}/${entry.name}`);
  }
}

const errors: string[] = [];

for (const file of templateFiles.sort()) {
  const text = await Deno.readTextFile(file);
  if (text.includes("dev:local:")) {
    errors.push(`${file} must not use dev:local commands`);
  }
  if (text.includes("path: /health")) {
    errors.push(`${file} must use /livez or /readyz probes, not /health`);
  }
  if (
    text.includes("TAKOS_PAAS_PROCESS_ROLE") &&
    text.includes("kind: Deployment") &&
    !text.includes('command: ["deno", "task", "start"]')
  ) {
    errors.push(`${file} must run the production start task`);
  }
  if (file.endsWith("deployment-paas-worker.yaml")) {
    assertSinglePath(
      text,
      file,
      "TAKOS_PAAS_WORKER_HEARTBEAT_FILE",
      /name:\s+TAKOS_PAAS_WORKER_HEARTBEAT_FILE\s*\n\s*value:\s*"([^"]+)"/,
      "/var/lib/takos/worker-heartbeat.json",
    );
    assertSinglePath(
      text,
      file,
      "paas-worker liveness heartbeat",
      /const f = '([^']+)';/,
      "/var/lib/takos/worker-heartbeat.json",
    );
    if (!text.includes("mountPath: /var/lib/takos")) {
      errors.push(`${file} must mount paas worker data at /var/lib/takos`);
    }
    if (text.includes("mountPath: /var/lib/takos/control")) {
      errors.push(
        `${file} must not mount paas worker heartbeat data at /var/lib/takos/control`,
      );
    }
  }
}

for (const overlay of ["values-aws.yaml", "values-gcp.yaml"]) {
  const path = `${chartRoot}/${overlay}`;
  const text = await Deno.readTextFile(path);
  if (!text.includes("environment: production")) {
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
}

if (errors.length > 0) {
  console.error("Helm chart validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  Deno.exit(1);
}

console.log(
  JSON.stringify({
    ok: true,
    checkedTemplates: templateFiles.length,
    checkedOverlays: ["values-aws.yaml", "values-gcp.yaml"],
  }),
);

function assertSinglePath(
  text: string,
  file: string,
  label: string,
  pattern: RegExp,
  expected: string,
): void {
  const match = text.match(pattern);
  if (!match) {
    errors.push(`${file} must declare ${label}`);
    return;
  }
  if (match[1] !== expected) {
    errors.push(`${file} ${label} must be ${expected}, got ${match[1]}`);
  }
}
