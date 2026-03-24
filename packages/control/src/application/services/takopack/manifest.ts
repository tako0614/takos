import YAML from 'yaml';
import type {
  ManifestEndpoint,
  ManifestWorkerConfig,
  ParsedTakopackPackage,
  TakopackApplyReportEntry,
  TakopackBindingObject,
  TakopackEndpointObject,
  TakopackManifest,
  TakopackMcpServerObject,
  TakopackObject,
  TakopackPackageObject,
  TakopackResourceObject,
  TakopackRolloutObject,
  TakopackWorkloadObject,
} from './types';
import { getWorkloadPlugin, listWorkloadPlugins } from './plugins';
import { computeSHA256, constantTimeEqual } from '../../../shared/utils/hash';

const SUPPORTED_KINDS = new Set<string>([
  'Package',
  'Resource',
  'Workload',
  'Endpoint',
  'Binding',
  'McpServer',
  'Policy',
  'Rollout',
]);

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown, fieldPath: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${fieldPath} must be an array of strings`);
  }

  return value.map((entry, index) => {
    const normalized = String(entry || '').trim();
    if (!normalized) {
      throw new Error(`${fieldPath}[${index}] must be a non-empty string`);
    }
    return normalized;
  });
}

function asStringMap(value: unknown, fieldPath: string): Record<string, string> {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldPath} must be an object`);
  }

  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
      throw new Error(`${fieldPath} contains an empty key`);
    }
    out[normalizedKey] = String(entry ?? '');
  }

  return out;
}

function parseOptionalTimeoutMs(value: unknown, fieldPath: string): number | undefined {
  if (value == null) return undefined;
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 30000) {
    throw new Error(`${fieldPath} must be a number in range 1..30000`);
  }
  return Math.floor(timeout);
}

export function normalizePackagePath(path: string): string {
  const normalized = path
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');

  return normalized === '.' ? '' : normalized;
}

export function normalizePackageDirectory(path: string): string {
  const normalized = normalizePackagePath(path).replace(/\/+$/, '');
  if (!normalized) return '';
  return `${normalized}/`;
}

export function getPackageFile(files: Map<string, ArrayBuffer>, path: string): ArrayBuffer | undefined {
  const targetPath = normalizePackagePath(path);
  for (const [filePath, content] of Array.from(files.entries())) {
    if (normalizePackagePath(filePath) === targetPath) {
      return content;
    }
  }
  return undefined;
}

export function getRequiredPackageFile(
  files: Map<string, ArrayBuffer>,
  path: string,
  errorMessage: string
): ArrayBuffer {
  const content = getPackageFile(files, path);
  if (!content) {
    throw new Error(errorMessage);
  }
  return content;
}

export function decodeArrayBuffer(content: ArrayBuffer): string {
  return new TextDecoder().decode(content);
}

export function looksLikeSQL(value: string): boolean {
  const sql = value.trim();
  if (!sql) return false;

  if (/\n/.test(sql) && /;/.test(sql)) {
    return true;
  }

  return /^(--|\/\*|\s*(create|alter|drop|insert|update|delete|pragma|begin|commit|with)\b)/i.test(sql);
}

export function getAssetContentType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'application/javascript';
  if (lower.endsWith('.css')) return 'text/css';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'application/yaml';
  if (lower.endsWith('.html')) return 'text/html';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.woff')) return 'font/woff';
  if (lower.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}

export function normalizeManifestBundleHash(workerConfig: ManifestWorkerConfig): string {
  const rawHash = workerConfig.bundleHash.trim().toLowerCase();
  if (!rawHash) {
    throw new Error(
      `Invalid worker bundle hash for ${workerConfig.name} (${workerConfig.bundle}): hash is empty`
    );
  }

  let digest = rawHash;
  if (rawHash.includes(':')) {
    const [algorithm, value = ''] = rawHash.split(':', 2);
    if (algorithm !== 'sha256') {
      throw new Error(
        `Invalid worker bundle hash for ${workerConfig.name} (${workerConfig.bundle}): unsupported algorithm ${algorithm}`
      );
    }
    digest = value;
  }

  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(
      `Invalid worker bundle hash for ${workerConfig.name} (${workerConfig.bundle}): expected 64-char SHA-256 hex`
    );
  }

  return digest;
}

export async function assertManifestWorkerBundleIntegrity(
  workerConfig: ManifestWorkerConfig,
  workerScriptBuffer: ArrayBuffer
): Promise<void> {
  if (!Number.isInteger(workerConfig.bundleSize) || workerConfig.bundleSize < 0) {
    throw new Error(
      `Invalid worker bundle size for ${workerConfig.name} (${workerConfig.bundle}): ${workerConfig.bundleSize}`
    );
  }

  const actualSize = workerScriptBuffer.byteLength;
  if (actualSize !== workerConfig.bundleSize) {
    throw new Error(
      `Worker bundle integrity check failed for ${workerConfig.name} (${workerConfig.bundle}): size mismatch (expected ${workerConfig.bundleSize}, got ${actualSize})`
    );
  }

  const expectedHash = normalizeManifestBundleHash(workerConfig);
  const actualHash = await computeSHA256(workerScriptBuffer);
  if (!constantTimeEqual(actualHash, expectedHash)) {
    throw new Error(
      `Worker bundle integrity check failed for ${workerConfig.name} (${workerConfig.bundle}): hash mismatch`
    );
  }
}

function parseChecksums(content: string): Map<string, string> {
  const checksums = new Map<string, string>();
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (line.startsWith('#')) continue;

    const match = /^([a-fA-F0-9]{64})\s+(.+)$/.exec(line);
    if (!match) {
      throw new Error(`Invalid checksums.txt line: ${line}`);
    }

    const digest = match[1].toLowerCase();
    const filePath = normalizePackagePath(match[2]);
    if (!filePath) {
      throw new Error(`Invalid checksums.txt entry path: ${line}`);
    }

    checksums.set(filePath, digest);
  }

  return checksums;
}

function parseObjectDocument(docValue: unknown, index: number): TakopackObject {
  const record = asRecord(docValue);
  const apiVersion = String(record.apiVersion || '').trim();
  const kind = String(record.kind || '').trim();
  const metadata = asRecord(record.metadata);
  const spec = asRecord(record.spec);

  if (apiVersion !== 'takos.dev/v1alpha1') {
    throw new Error(`manifest.yaml doc[${index}] has unsupported apiVersion: ${apiVersion || '<empty>'}`);
  }

  if (!SUPPORTED_KINDS.has(kind)) {
    throw new Error(`manifest.yaml doc[${index}] has unsupported kind: ${kind || '<empty>'}`);
  }

  const name = String(metadata.name || '').trim();
  if (!name) {
    throw new Error(`manifest.yaml doc[${index}] metadata.name is required`);
  }

  const labels = asStringMap(metadata.labels, `manifest.yaml doc[${index}] metadata.labels`);

  return {
    apiVersion: 'takos.dev/v1alpha1',
    kind: kind as TakopackObject['kind'],
    metadata: {
      name,
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
    },
    spec,
  } as TakopackObject;
}

function buildBindingLookup(
  resources: TakopackResourceObject[],
  workloads: TakopackWorkloadObject[],
  bindings: TakopackBindingObject[]
): Map<string, { d1: string[]; r2: string[]; kv: string[] }> {
  const resourcesByName = new Map(resources.map((resource) => [resource.metadata.name, resource]));
  const workloadsByName = new Map(workloads.map((workload) => [workload.metadata.name, workload]));
  const out = new Map<string, { d1: string[]; r2: string[]; kv: string[] }>();

  for (const workload of workloads) {
    out.set(workload.metadata.name, { d1: [], r2: [], kv: [] });
  }

  for (const binding of bindings) {
    const from = String(binding.spec.from || '').trim();
    const to = String(binding.spec.to || '').trim();
    if (!from || !to) {
      throw new Error(`Binding ${binding.metadata.name} must include spec.from and spec.to`);
    }

    const resource = resourcesByName.get(from);
    if (!resource) {
      throw new Error(`Binding ${binding.metadata.name} references missing Resource: ${from}`);
    }

    const workload = workloadsByName.get(to);
    if (!workload) {
      throw new Error(`Binding ${binding.metadata.name} references missing Workload: ${to}`);
    }

    const type = String(resource.spec.type || '').trim();
    if (type !== 'd1' && type !== 'r2' && type !== 'kv') {
      throw new Error(`Binding ${binding.metadata.name} references unsupported resource type: ${type}`);
    }

    const mount = asRecord(binding.spec.mount);
    const mountType = String(mount.type || '').trim();
    if (mountType && mountType !== type) {
      throw new Error(
        `Binding ${binding.metadata.name} mount.type (${mountType}) does not match Resource type (${type})`
      );
    }

    const defaultBinding = String(resource.spec.binding || resource.metadata.name || '').trim();
    const bindingName = String(mount.as || defaultBinding).trim();
    if (!bindingName) {
      throw new Error(`Binding ${binding.metadata.name} resolved to empty binding name`);
    }

    const resolved = out.get(workload.metadata.name);
    if (!resolved) {
      throw new Error(`Binding ${binding.metadata.name} references unresolved workload bindings`);
    }

    const target = resolved[type as 'd1' | 'r2' | 'kv'];
    if (!target.includes(bindingName)) {
      target.push(bindingName);
    }
  }

  return out;
}

export function buildNormalizedManifest(params: {
  objects: TakopackObject[];
  files: Map<string, ArrayBuffer>;
  checksums: Map<string, string>;
}): { manifest: TakopackManifest; applyReport: TakopackApplyReportEntry[] } {
  const packageObjects = params.objects.filter((obj) => obj.kind === 'Package') as TakopackPackageObject[];
  const resourceObjects = params.objects.filter((obj) => obj.kind === 'Resource') as TakopackResourceObject[];
  const workloadObjects = params.objects.filter((obj) => obj.kind === 'Workload') as TakopackWorkloadObject[];
  const endpointObjects = params.objects.filter((obj) => obj.kind === 'Endpoint') as TakopackEndpointObject[];
  const bindingObjects = params.objects.filter((obj) => obj.kind === 'Binding') as TakopackBindingObject[];
  const mcpServerObjects = params.objects.filter((obj) => obj.kind === 'McpServer') as TakopackMcpServerObject[];
  const rolloutObjects = params.objects.filter((obj) => obj.kind === 'Rollout') as TakopackRolloutObject[];

  if (packageObjects.length !== 1) {
    throw new Error(`manifest.yaml must contain exactly one Package object (found ${packageObjects.length})`);
  }

  const pkg = packageObjects[0];
  const pkgSpec = asRecord(pkg.spec);
  const rawAppId = String(pkgSpec.appId || '').trim();
  const appId = rawAppId || pkg.metadata.name;
  const version = String(pkgSpec.version || '').trim();
  if (!version) {
    throw new Error('Package.spec.version is required');
  }

  const applyReport: TakopackApplyReportEntry[] = params.objects.map((obj) => ({
    objectName: obj.metadata.name,
    kind: obj.kind,
    phase: 'validated',
    status: 'success',
  }));

  if (!rawAppId) {
    applyReport.push({
      objectName: pkg.metadata.name,
      kind: 'Package',
      phase: 'validated',
      status: 'success',
      message: 'Package.spec.appId is missing; falling back to metadata.name.',
    });
  }

  const resourcesD1: Array<{ binding: string; migrations?: string }> = [];
  const resourcesR2: Array<{ binding: string }> = [];
  const resourcesKV: Array<{ binding: string }> = [];

  for (const resource of resourceObjects) {
    const type = String(resource.spec.type || '').trim();
    const binding = String(resource.spec.binding || resource.metadata.name || '').trim();

    if (!binding) {
      throw new Error(`Resource ${resource.metadata.name} is missing binding`);
    }

    if (type === 'd1') {
      const migrations = String(resource.spec.migrations || '').trim();
      resourcesD1.push({
        binding,
        ...(migrations ? { migrations } : {}),
      });
      continue;
    }

    if (type === 'r2') {
      resourcesR2.push({ binding });
      continue;
    }

    if (type === 'kv') {
      resourcesKV.push({ binding });
      continue;
    }

    throw new Error(`Unsupported Resource.spec.type for ${resource.metadata.name}: ${type}`);
  }

  const bindingLookup = buildBindingLookup(resourceObjects, workloadObjects, bindingObjects);

  const workers: ManifestWorkerConfig[] = [];
  const workloadRuntimeByName = new Map<string, string>();
  const workloadWorkerRefByName = new Map<string, string>();
  for (const workload of workloadObjects) {
    const pluginType = String(workload.spec.type || '').trim();
    const plugin = getWorkloadPlugin(pluginType);
    if (!plugin) {
      const supported = listWorkloadPlugins();
      throw new Error(
        `Unsupported workload plugin type: ${pluginType || '<empty>'}. Supported: ${supported.join(', ') || '<none>'}`
      );
    }

    const bindings = bindingLookup.get(workload.metadata.name) || { d1: [], r2: [], kv: [] };
    plugin.validate(workload, {
      files: params.files,
      checksums: params.checksums,
    });

    const applied = plugin.apply(workload, {
      files: params.files,
      checksums: params.checksums,
      bindings,
    });

    const runtime = String(applied.runtime || pluginType).trim() || pluginType;
    workloadRuntimeByName.set(workload.metadata.name, runtime);

    if (applied.worker) {
      workers.push(applied.worker);
      workloadWorkerRefByName.set(workload.metadata.name, applied.worker.name);
    }
  }

  const workloadNames = new Set(workloadObjects.map((workload) => workload.metadata.name));
  const endpoints: ManifestEndpoint[] = endpointObjects.map((endpointObject) => {
    const spec = asRecord(endpointObject.spec);
    const protocol = String(spec.protocol || '').trim();
    if (protocol !== 'http') {
      throw new Error(`Endpoint ${endpointObject.metadata.name} has unsupported protocol: ${protocol || '<empty>'}`);
    }

    const targetRef = String(spec.targetRef || '').trim();
    if (!targetRef) {
      throw new Error(`Endpoint ${endpointObject.metadata.name} is missing spec.targetRef`);
    }
    if (!workloadNames.has(targetRef)) {
      throw new Error(`Endpoint ${endpointObject.metadata.name} references unknown workload: ${targetRef}`);
    }

    const targetRuntime = workloadRuntimeByName.get(targetRef) || '';
    if (!targetRuntime) {
      throw new Error(`Endpoint ${endpointObject.metadata.name} target workload runtime is unresolved: ${targetRef}`);
    }

    const rawIngressRef = String(spec.ingressRef || '').trim();
    if (targetRuntime !== 'cloudflare.worker') {
      throw new Error(
        `Endpoint ${endpointObject.metadata.name} target workload must be cloudflare.worker (${targetRef})`
      );
    }
    const resolvedTargetRuntime: 'cloudflare.worker' = 'cloudflare.worker';
    const ingressRef = rawIngressRef || targetRef;

    let ingressWorker: string | undefined;
    if (ingressRef) {
      if (!workloadNames.has(ingressRef)) {
        throw new Error(`Endpoint ${endpointObject.metadata.name} ingressRef references unknown workload: ${ingressRef}`);
      }
      const ingressRuntime = workloadRuntimeByName.get(ingressRef) || '';
      if (ingressRuntime !== 'cloudflare.worker') {
        throw new Error(
          `Endpoint ${endpointObject.metadata.name} ingressRef must reference a cloudflare.worker workload (${ingressRef})`
        );
      }
      ingressWorker = workloadWorkerRefByName.get(ingressRef);
      if (!ingressWorker) {
        throw new Error(
          `Endpoint ${endpointObject.metadata.name} ingress workload has no deployable worker reference: ${ingressRef}`
        );
      }
    }

    const path = String(spec.path || '').trim();
    if (path && !path.startsWith('/')) {
      throw new Error(`Endpoint ${endpointObject.metadata.name} spec.path must start with "/"`);
    }

    const timeoutMs = parseOptionalTimeoutMs(
      spec.timeoutMs,
      `Endpoint ${endpointObject.metadata.name} spec.timeoutMs`
    );

    const routes = path ? [{ pathPrefix: path }] : [];

    return {
      name: endpointObject.metadata.name,
      protocol: 'http',
      targetRef,
      targetRuntime: resolvedTargetRuntime,
      ...(ingressRef ? { ingressRef } : {}),
      ...(ingressWorker ? { ingressWorker } : {}),
      routes,
      ...(path ? { path } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    };
  });

  const endpointByName = new Map(endpoints.map((endpoint) => [endpoint.name, endpoint]));
  const mcpServers = mcpServerObjects.map((mcpServer) => {
    const spec = asRecord(mcpServer.spec);
    const endpointRef = String(spec.endpointRef || '').trim();
    if (!endpointRef) {
      throw new Error(`McpServer ${mcpServer.metadata.name} is missing spec.endpointRef`);
    }

    const endpoint = endpointByName.get(endpointRef);
    if (!endpoint) {
      throw new Error(`McpServer ${mcpServer.metadata.name} references unknown endpoint: ${endpointRef}`);
    }

    const name = String(spec.name || mcpServer.metadata.name || '').trim();
    if (!name) {
      throw new Error(`McpServer ${mcpServer.metadata.name} resolved to empty name`);
    }

    const transport = String(spec.transport || 'streamable-http').trim();
    if (transport !== 'streamable-http') {
      throw new Error(`McpServer ${mcpServer.metadata.name} has invalid spec.transport: ${transport}`);
    }

    const workerRef = endpoint.ingressWorker
      ?? workloadWorkerRefByName.get(endpoint.targetRef)
      ?? '';
    if (!workerRef) {
      throw new Error(
        `McpServer ${mcpServer.metadata.name} references endpoint ${endpointRef} with no resolvable Cloudflare worker`
      );
    }

    const endpointPath = endpoint.path || '/mcp';

    return {
      name,
      transport: 'streamable-http' as const,
      worker: workerRef,
      endpoint: endpointRef,
      path: endpointPath,
    };
  });

  const dependenciesRaw = pkgSpec.dependencies;
  const dependencies = Array.isArray(dependenciesRaw)
    ? dependenciesRaw
        .map((entry) => {
          const item = asRecord(entry);
          const repo = String(item.repo || '').trim();
          const depVersion = String(item.version || '').trim();
          return { repo, version: depVersion };
        })
        .filter((entry) => entry.repo && entry.version)
    : undefined;

  const capabilities = asStringArray(pkgSpec.capabilities, 'Package.spec.capabilities');

  const oauth = (() => {
    const oauthSpec = asRecord(pkgSpec.oauth);
    if (Object.keys(oauthSpec).length === 0) {
      return undefined;
    }

    const clientName = String(oauthSpec.clientName || '').trim();
    const redirectUris = asStringArray(oauthSpec.redirectUris, 'Package.spec.oauth.redirectUris');
    const scopes = asStringArray(oauthSpec.scopes, 'Package.spec.oauth.scopes');

    if (!clientName || redirectUris.length === 0 || scopes.length === 0) {
      throw new Error('Package.spec.oauth requires clientName, redirectUris, and scopes');
    }

    const metadata = asRecord(oauthSpec.metadata);

    return {
      clientName,
      redirectUris,
      scopes,
      autoEnv: oauthSpec.autoEnv === true,
      metadata: Object.keys(metadata).length > 0
        ? {
            ...(metadata.logoUri ? { logoUri: String(metadata.logoUri) } : {}),
            ...(metadata.tosUri ? { tosUri: String(metadata.tosUri) } : {}),
            ...(metadata.policyUri ? { policyUri: String(metadata.policyUri) } : {}),
          }
        : undefined,
    };
  })();

  const takos = (() => {
    const takosSpec = asRecord(pkgSpec.takos);
    if (Object.keys(takosSpec).length === 0) {
      return undefined;
    }

    const scopes = asStringArray(takosSpec.scopes, 'Package.spec.takos.scopes');
    if (scopes.length === 0) {
      throw new Error('Package.spec.takos.scopes must contain at least one scope');
    }

    return { scopes };
  })();

  const env = (() => {
    const envSpec = asRecord(pkgSpec.env);
    if (Object.keys(envSpec).length === 0) {
      return undefined;
    }

    const required = asStringArray(envSpec.required, 'Package.spec.env.required');
    return { required };
  })();

  const fileHandlers = (() => {
    const raw = pkgSpec.fileHandlers;
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    return raw.map((entry, index) => {
      const item = asRecord(entry);
      const name = String(item.name || '').trim();
      const openPath = String(item.openPath || '').trim();
      if (!name || !openPath) {
        throw new Error(`Package.spec.fileHandlers[${index}] requires name and openPath`);
      }
      const mimeTypes = item.mimeTypes ? asStringArray(item.mimeTypes, `Package.spec.fileHandlers[${index}].mimeTypes`) : undefined;
      const extensions = item.extensions ? asStringArray(item.extensions, `Package.spec.fileHandlers[${index}].extensions`) : undefined;
      if (!mimeTypes?.length && !extensions?.length) {
        throw new Error(`Package.spec.fileHandlers[${index}] requires at least one of mimeTypes or extensions`);
      }
      return { name, mimeTypes, extensions, openPath };
    });
  })();

  const categoryRaw = String(pkgSpec.category || '').trim();
  const category = categoryRaw
    ? (categoryRaw as 'app' | 'service' | 'library' | 'template' | 'social')
    : undefined;

  const manifest: TakopackManifest = {
    manifestVersion: 'vnext-infra-v1alpha1',
    meta: {
      name: pkg.metadata.name,
      appId,
      version,
      ...(pkgSpec.description ? { description: String(pkgSpec.description) } : {}),
      ...(pkgSpec.icon ? { icon: String(pkgSpec.icon) } : {}),
      ...(category ? { category } : {}),
      tags: asStringArray(pkgSpec.tags, 'Package.spec.tags'),
      createdAt: new Date().toISOString(),
      ...(dependencies ? { dependencies } : {}),
    },
    ...(dependencies ? { dependencies } : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    ...((resourcesD1.length > 0 || resourcesR2.length > 0 || resourcesKV.length > 0)
      ? {
          resources: {
            ...(resourcesD1.length > 0 ? { d1: resourcesD1 } : {}),
            ...(resourcesR2.length > 0 ? { r2: resourcesR2 } : {}),
            ...(resourcesKV.length > 0 ? { kv: resourcesKV } : {}),
          },
        }
      : {}),
    ...(oauth ? { oauth } : {}),
    ...(takos ? { takos } : {}),
    ...(env ? { env } : {}),
    ...(workers.length > 0 ? { workers } : {}),
    ...(endpoints.length > 0 ? { endpoints } : {}),
    ...(mcpServers.length > 0 ? { mcpServers } : {}),
    ...(fileHandlers ? { fileHandlers } : {}),
    ...(rolloutObjects.length > 0 ? { rollout: parseRolloutSpec(rolloutObjects[0]) } : {}),
    objects: params.objects,
  };

  applyReport.push(
    ...params.objects.map((obj) => ({
      objectName: obj.metadata.name,
      kind: obj.kind,
      phase: 'planned' as const,
      status: 'success' as const,
    }))
  );

  return {
    manifest,
    applyReport,
  };
}

async function loadPackageFiles(data: ArrayBuffer): Promise<Map<string, ArrayBuffer>> {
  const jszip = await import('jszip');
  const JSZip = 'default' in jszip ? jszip.default : jszip;
  const zip = await (JSZip as { loadAsync(data: ArrayBuffer): Promise<import('jszip')> }).loadAsync(data);

  const files = new Map<string, ArrayBuffer>();
  // JSZip's type declarations omit `externalFileAttributes`.
  // Cast to a narrow interface that includes only the fields we access.
  interface ZipFileEntry {
    dir: boolean;
    externalFileAttributes: number;
    async(type: 'arraybuffer'): Promise<ArrayBuffer>;
  }
  const zipFiles = zip.files as unknown as Record<string, ZipFileEntry>;

  for (const [filePathRaw, file] of Object.entries(zipFiles)) {
    if (file.dir) continue;

    const filePath = normalizePackagePath(filePathRaw);
    if (!filePath) continue;

    const unixMode = (file.externalFileAttributes >>> 16) & 0xffff;
    if ((unixMode & 0xf000) === 0xa000) {
      throw new Error(`Invalid takopack: symlinks are not allowed (${filePath})`);
    }

    files.set(filePath, await file.async('arraybuffer'));
  }

  return files;
}

function parseManifestObjects(content: string): TakopackObject[] {
  const docs = YAML.parseAllDocuments(content);
  if (docs.length === 0) {
    throw new Error('Invalid takopack: manifest.yaml is empty');
  }

  const objects = docs.map((doc, index) => {
    if (doc.errors.length > 0) {
      throw new Error(`Invalid takopack: manifest.yaml doc[${index}] parse error`);
    }
    return parseObjectDocument(doc.toJSON(), index);
  });

  const names = new Set<string>();
  for (const obj of objects) {
    const name = obj.metadata.name;
    if (names.has(name)) {
      throw new Error(`Invalid takopack: duplicate metadata.name in manifest.yaml (${name})`);
    }
    names.add(name);
  }

  return objects;
}

export async function parsePackage(data: ArrayBuffer): Promise<ParsedTakopackPackage> {
  const files = await loadPackageFiles(data);

  const manifestBuffer = getPackageFile(files, 'manifest.yaml');
  if (!manifestBuffer) {
    throw new Error('Invalid takopack: manifest.yaml not found');
  }

  const checksumsBuffer = getPackageFile(files, 'checksums.txt');
  if (!checksumsBuffer) {
    throw new Error('Invalid takopack: checksums.txt not found');
  }

  const manifestText = decodeArrayBuffer(manifestBuffer);
  const checksumsText = decodeArrayBuffer(checksumsBuffer);

  const objects = parseManifestObjects(manifestText);
  const checksums = parseChecksums(checksumsText);

  const { manifest, applyReport } = buildNormalizedManifest({
    objects,
    files,
    checksums,
  });

  return {
    manifest,
    files,
    applyReport,
  };
}

export async function parseManifestOnly(data: ArrayBuffer): Promise<TakopackManifest> {
  const { manifest } = await parsePackage(data);
  return manifest;
}

function parseRolloutSpec(obj: TakopackRolloutObject): TakopackRolloutObject['spec'] {
  const spec = obj.spec as Record<string, unknown>;
  const strategy = spec.strategy === 'immediate' ? 'immediate' : 'staged';
  const autoPromote = spec.autoPromote !== false;

  const defaultStages = [
    { weight: 1, pauseMinutes: 5 },
    { weight: 5, pauseMinutes: 10 },
    { weight: 25, pauseMinutes: 15 },
    { weight: 50, pauseMinutes: 15 },
    { weight: 100, pauseMinutes: 0 },
  ];

  let stages: Array<{ weight: number; pauseMinutes: number }>;
  if (Array.isArray(spec.stages) && spec.stages.length > 0) {
    stages = spec.stages.map((s: unknown) => {
      const stage = s as Record<string, unknown>;
      const weight = Math.min(100, Math.max(1, Math.floor(Number(stage.weight) || 1)));
      const pauseMinutes = Math.max(0, Math.floor(Number(stage.pauseMinutes) || 0));
      return { weight, pauseMinutes };
    });
    // Ensure final stage is 100%
    if (stages[stages.length - 1].weight !== 100) {
      stages.push({ weight: 100, pauseMinutes: 0 });
    }
  } else {
    stages = defaultStages;
  }

  let healthCheck: { errorRateThreshold: number; minRequests: number } | undefined;
  if (spec.healthCheck && typeof spec.healthCheck === 'object') {
    const hc = spec.healthCheck as Record<string, unknown>;
    const errorRateThreshold = Math.min(1, Math.max(0, Number(hc.errorRateThreshold) || 0.05));
    const minRequests = Math.max(1, Math.floor(Number(hc.minRequests) || 100));
    healthCheck = { errorRateThreshold, minRequests };
  }

  return { strategy, stages, healthCheck, autoPromote };
}
