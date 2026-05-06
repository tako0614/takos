type JsonRecord = Record<string, unknown>;
type SmokeResult = {
  manifest: string;
  serviceId: string;
  url: string | null;
  status: string;
  error?: string;
};

const args = parseArgs(Deno.args);
const manifests = args.all
  ? await allDistributionManifests()
  : [args.manifest ?? 'deploy/distributions/selfhosted.json'];
const results: SmokeResult[] = [];
const errors: string[] = [];

for (const manifestPath of manifests) {
  const manifest = await readJson(manifestPath);
  const services = arrayAt(manifest, 'services', manifestPath);
  for (const [index, serviceValue] of services.entries()) {
    const service = record(serviceValue, `${manifestPath}.services[${index}]`);
    const serviceId = stringAt(service, 'serviceId', `${manifestPath}.services[${index}]`);
    const smoke = record(service.smoke, `${manifestPath}.services[${index}].smoke`);
    const healthPath = stringAt(smoke, 'healthPath', `${manifestPath}.services[${index}].smoke`);
    const expectedStatus = smoke.expectedStatus;
    if (expectedStatus !== 200) {
      errors.push(`${manifestPath}.services[${index}].smoke.expectedStatus must be 200`);
    }
    const expectedJson = record(smoke.expectedJson, `${manifestPath}.services[${index}].smoke.expectedJson`);
    const expectedService = stringAt(expectedJson, 'service', `${manifestPath}.services[${index}].smoke.expectedJson`);
    if (expectedService !== serviceId) {
      errors.push(`${manifestPath}.services[${index}].smoke.expectedJson.service must be ${serviceId}`);
    }

    const baseUrl = maybeString(service.publicUrl) ?? maybeString(service.internalUrl);
    const url = baseUrl ? new URL(healthPath, baseUrl).toString() : null;
    if (args.live) {
      if (!url) {
        errors.push(`${manifestPath}.services[${index}] needs publicUrl or internalUrl for live smoke`);
        continue;
      }
      results.push(await checkLiveService(manifestPath, serviceId, url, expectedService));
    } else {
      results.push({ manifest: manifestPath, serviceId, url, status: 'dry-run' });
    }
  }
}

const failed = results.filter((result) => result.status === 'failed');
if (errors.length > 0 || failed.length > 0) {
  console.error('Distribution smoke failed:');
  for (const error of errors) console.error(`- ${error}`);
  for (const result of failed) console.error(`- ${result.manifest} ${result.serviceId}: ${result.error}`);
  Deno.exit(1);
}

console.log(JSON.stringify(
  {
    ok: true,
    live: args.live,
    checkedManifests: manifests.length,
    checkedServices: results.length,
    results,
  },
  null,
  2,
));

async function checkLiveService(
  manifest: string,
  serviceId: string,
  url: string,
  expectedService: string,
): Promise<SmokeResult> {
  try {
    const response = await fetchWithTimeout(url);
    const bodyText = await response.text();
    if (!response.ok) {
      return { manifest, serviceId, url, status: 'failed', error: `${response.status} ${bodyText}` };
    }
    const body = JSON.parse(bodyText) as JsonRecord;
    if (body.service !== expectedService) {
      return {
        manifest,
        serviceId,
        url,
        status: 'failed',
        error: `expected service ${expectedService}, got ${String(body.service)}`,
      };
    }
    return { manifest, serviceId, url, status: 'passed' };
  } catch (error) {
    return {
      manifest,
      serviceId,
      url,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseArgs(values: readonly string[]): { manifest?: string; all: boolean; live: boolean } {
  let manifest: string | undefined;
  let all = false;
  let live = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--manifest') {
      manifest = values[index + 1];
      index += 1;
      continue;
    }
    if (value === '--all') {
      all = true;
      continue;
    }
    if (value === '--live') {
      live = true;
      continue;
    }
    console.error(
      'Usage: deno task distribution:smoke [--manifest deploy/distributions/<target>.json | --all] [--live]',
    );
    Deno.exit(2);
  }
  if (all && manifest) {
    console.error('Use either --all or --manifest, not both');
    Deno.exit(2);
  }
  return { manifest, all, live };
}

async function allDistributionManifests(): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir('deploy/distributions')) {
    if (entry.isFile && entry.name.endsWith('.json')) {
      files.push(`deploy/distributions/${entry.name}`);
    }
  }
  return files.sort();
}

async function readJson(path: string): Promise<JsonRecord> {
  return JSON.parse(await Deno.readTextFile(path)) as JsonRecord;
}

function arrayAt(recordValue: JsonRecord, key: string, label: string): unknown[] {
  const value = recordValue[key];
  if (!Array.isArray(value)) {
    errors.push(`${label}.${key} must be an array`);
    return [];
  }
  return value;
}

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return {};
  }
  return value as JsonRecord;
}

function stringAt(recordValue: JsonRecord, key: string, label: string): string {
  const value = recordValue[key];
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${label}.${key} must be a string`);
    return '';
  }
  return value;
}

function maybeString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
