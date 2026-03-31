import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock cloudflare-utils before any imports ────────────────────────────────

const mocks = vi.hoisted(() => ({
  cfApi: vi.fn(),
  execCommand: vi.fn(),
}));

vi.mock('../src/lib/group-deploy/cloudflare-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/group-deploy/cloudflare-utils.js')>();
  return {
    ...actual,
    cfApi: mocks.cfApi,
    execCommand: mocks.execCommand,
  };
});

import type { ResourceProvider, ProvisionResult } from '../src/lib/group-deploy/resource-provider.js';
import { CloudflareProvider } from '../src/lib/group-deploy/providers/cloudflare.js';
import { AWSProvider } from '../src/lib/group-deploy/providers/aws.js';
import { GCPProvider } from '../src/lib/group-deploy/providers/gcp.js';
import { K8sProvider } from '../src/lib/group-deploy/providers/kubernetes.js';
import { DockerProvider } from '../src/lib/group-deploy/providers/docker.js';
import { resolveProvider } from '../src/lib/group-deploy/provisioner.js';

// ── ResourceProvider interface conformance ───────────────────────────────────

describe('ResourceProvider interface', () => {
  const providers: Array<{ name: string; create: () => ResourceProvider }> = [
    {
      name: 'CloudflareProvider',
      create: () => new CloudflareProvider({ accountId: 'test-acct', apiToken: 'test-token', groupName: 'app', env: 'staging' }),
    },
    { name: 'AWSProvider', create: () => new AWSProvider({ region: 'us-east-1' }) },
    { name: 'GCPProvider', create: () => new GCPProvider({ project: 'test-project', region: 'us-central1' }) },
    { name: 'K8sProvider', create: () => new K8sProvider({ namespace: 'test-ns' }) },
    { name: 'DockerProvider', create: () => new DockerProvider({ composeProject: 'test' }) },
  ];

  for (const { name, create } of providers) {
    describe(name, () => {
      it('has a name property', () => {
        const provider = create();
        expect(typeof provider.name).toBe('string');
        expect(provider.name.length).toBeGreaterThan(0);
      });

      it('implements all required methods', () => {
        const provider = create();
        expect(typeof provider.createDatabase).toBe('function');
        expect(typeof provider.createObjectStorage).toBe('function');
        expect(typeof provider.createKeyValueStore).toBe('function');
        expect(typeof provider.createQueue).toBe('function');
        expect(typeof provider.createVectorIndex).toBe('function');
        expect(typeof provider.createSecret).toBe('function');
        expect(typeof provider.skipAutoConfigured).toBe('function');
      });

      it('skipAutoConfigured returns a skipped result synchronously', () => {
        const provider = create();
        const result = provider.skipAutoConfigured('test-resource', 'durableObject');
        expect(result.status).toBe('skipped');
        expect(result.name).toBe('test-resource');
        expect(result.type).toBe('durableObject');
      });
    });
  }
});

// ── CloudflareProvider ───────────────────────────────────────────────────────

describe('CloudflareProvider', () => {
  let provider: CloudflareProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CloudflareProvider({
      accountId: 'acct-123',
      apiToken: 'tok-abc',
      groupName: 'myapp',
      env: 'staging',
    });
  });

  it('creates a D1 database via CF API', async () => {
    mocks.cfApi.mockResolvedValueOnce({ uuid: 'd1-uuid-001' });

    const result = await provider.createDatabase('main-db');

    expect(mocks.cfApi).toHaveBeenCalledWith('acct-123', 'tok-abc', 'POST', '/d1/database', { name: 'myapp-staging-main-db' });
    expect(result).toEqual<ProvisionResult>({
      name: 'myapp-staging-main-db',
      type: 'd1',
      status: 'provisioned',
      id: 'd1-uuid-001',
    });
  });

  it('creates an R2 bucket via CF API', async () => {
    mocks.cfApi.mockResolvedValueOnce({});

    const result = await provider.createObjectStorage('assets');

    expect(mocks.cfApi).toHaveBeenCalledWith('acct-123', 'tok-abc', 'POST', '/r2/buckets', { name: 'myapp-staging-assets' });
    expect(result.status).toBe('provisioned');
    expect(result.type).toBe('r2');
  });

  it('creates a KV namespace via CF API', async () => {
    mocks.cfApi.mockResolvedValueOnce({ id: 'kv-id-001' });

    const result = await provider.createKeyValueStore('cache');

    expect(mocks.cfApi).toHaveBeenCalledWith('acct-123', 'tok-abc', 'POST', '/storage/kv/namespaces', { title: 'myapp-staging-cache' });
    expect(result).toEqual<ProvisionResult>({
      name: 'myapp-staging-cache',
      type: 'kv',
      status: 'provisioned',
      id: 'kv-id-001',
    });
  });

  it('creates a queue via wrangler CLI', async () => {
    mocks.execCommand.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });

    const result = await provider.createQueue('task-queue');

    expect(mocks.execCommand).toHaveBeenCalledWith(
      'npx',
      ['wrangler', 'queues', 'create', 'myapp-staging-task-queue'],
      expect.objectContaining({ env: expect.objectContaining({ CLOUDFLARE_ACCOUNT_ID: 'acct-123' }) }),
    );
    expect(result.status).toBe('provisioned');
  });

  it('reports queue as exists when wrangler exits non-zero', async () => {
    mocks.execCommand.mockResolvedValueOnce({ stdout: '', stderr: 'already exists', exitCode: 1 });

    const result = await provider.createQueue('task-queue');
    expect(result.status).toBe('exists');
  });

  it('creates a vectorize index via wrangler CLI', async () => {
    mocks.execCommand.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });

    const result = await provider.createVectorIndex('embeddings', { dimensions: 768, metric: 'euclidean' });

    expect(mocks.execCommand).toHaveBeenCalledWith(
      'npx',
      ['wrangler', 'vectorize', 'create', 'myapp-staging-embeddings', '--dimensions', '768', '--metric', 'euclidean'],
      expect.objectContaining({ env: expect.objectContaining({ CLOUDFLARE_API_TOKEN: 'tok-abc' }) }),
    );
    expect(result.status).toBe('provisioned');
  });

  it('creates a secret with a random hex value', async () => {
    const result = await provider.createSecret('api-key', 'API_KEY');

    expect(result.status).toBe('provisioned');
    expect(result.type).toBe('secretRef');
    // The id should be a 64-character hex string (32 random bytes)
    expect(result.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('skipAutoConfigured returns skipped with message', () => {
    const result = provider.skipAutoConfigured('my-do', 'durableObject');

    expect(result.status).toBe('skipped');
    expect(result.error).toContain('wrangler deploy');
  });
});

// ── Provider resolution ──────────────────────────────────────────────────────

describe('resolveProvider', () => {
  const baseOpts = { groupName: 'app', env: 'staging' };

  beforeEach(() => {
    // Clean up env vars that influence provider detection
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.KUBECONFIG;
  });

  it('returns CloudflareProvider when accountId and apiToken are provided', () => {
    const provider = resolveProvider({ ...baseOpts, accountId: 'acct', apiToken: 'tok' });
    expect(provider.name).toBe('cloudflare');
    expect(provider).toBeInstanceOf(CloudflareProvider);
  });

  it('returns AWSProvider when AWS_ACCESS_KEY_ID is set', () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKID123';
    const provider = resolveProvider(baseOpts);
    expect(provider.name).toBe('aws');
    expect(provider).toBeInstanceOf(AWSProvider);
  });

  it('returns GCPProvider when GOOGLE_APPLICATION_CREDENTIALS is set', () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/creds.json';
    const provider = resolveProvider(baseOpts);
    expect(provider.name).toBe('gcp');
    expect(provider).toBeInstanceOf(GCPProvider);
  });

  it('returns K8sProvider when KUBECONFIG is set', () => {
    process.env.KUBECONFIG = '/path/to/kubeconfig';
    const provider = resolveProvider(baseOpts);
    expect(provider.name).toBe('k8s');
    expect(provider).toBeInstanceOf(K8sProvider);
  });

  it('falls back to DockerProvider when no cloud env is detected', () => {
    const provider = resolveProvider(baseOpts);
    expect(provider.name).toBe('docker');
    expect(provider).toBeInstanceOf(DockerProvider);
  });

  it('prefers Cloudflare over AWS when both are available', () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKID123';
    const provider = resolveProvider({ ...baseOpts, accountId: 'acct', apiToken: 'tok' });
    expect(provider.name).toBe('cloudflare');
  });

  it('prefers AWS over GCP when both env vars are set', () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKID123';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/creds.json';
    const provider = resolveProvider(baseOpts);
    expect(provider.name).toBe('aws');
  });
});

// ── provisionResources integration with provider ─────────────────────────────

describe('provisionResources (with CloudflareProvider)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cfApi.mockReset();
    mocks.execCommand.mockReset();
  });

  it('provisions mixed resource types through the provider', async () => {
    const { provisionResources } = await import('../src/lib/group-deploy/provisioner.js');

    mocks.cfApi
      .mockResolvedValueOnce({ uuid: 'd1-id' })     // d1
      .mockResolvedValueOnce({})                      // r2
      .mockResolvedValueOnce({ id: 'kv-id' });       // kv

    const resources = {
      'main-db': { type: 'd1', binding: 'DB' },
      assets: { type: 'r2' },
      cache: { type: 'kv' },
      'my-do': { type: 'durableObject' },
    };

    const { provisioned, results } = await provisionResources(resources, {
      accountId: 'acct',
      apiToken: 'tok',
      groupName: 'app',
      env: 'staging',
    });

    expect(provisioned.size).toBe(4);
    expect(results).toHaveLength(4);

    // D1
    const d1Result = results.find(r => r.name === 'main-db');
    expect(d1Result?.status).toBe('provisioned');
    expect(d1Result?.id).toBe('d1-id');

    // R2
    const r2Result = results.find(r => r.name === 'assets');
    expect(r2Result?.status).toBe('provisioned');

    // KV
    const kvResult = results.find(r => r.name === 'cache');
    expect(kvResult?.status).toBe('provisioned');
    expect(kvResult?.id).toBe('kv-id');

    // DurableObject (auto-configured)
    const doResult = results.find(r => r.name === 'my-do');
    expect(doResult?.status).toBe('skipped');
  });

  it('canonicalizes portable-style resource aliases before provisioning', async () => {
    const { provisionResources } = await import('../src/lib/group-deploy/provisioner.js');

    mocks.cfApi
      .mockResolvedValueOnce({ uuid: 'sql-id' })         // sql -> d1
      .mockResolvedValueOnce({})                          // object_store -> r2
      .mockResolvedValueOnce({ id: 'kv-id' })             // kv
      .mockResolvedValueOnce({ id: 'vector-id' })         // vector_index -> vectorize

    mocks.execCommand.mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });

    const resources = {
      'main-db': { type: 'sql', binding: 'DB' },
      assets: { type: 'object_store' },
      cache: { type: 'kv' },
      embeddings: { type: 'vector_index', vectorize: { dimensions: 1536, metric: 'cosine' } },
      'api-secret': { type: 'secret' },
    };

    const { provisioned, results } = await provisionResources(resources, {
      accountId: 'acct',
      apiToken: 'tok',
      groupName: 'app',
      env: 'staging',
    });

    expect(provisioned.size).toBe(5);
    expect(results).toHaveLength(5);

    expect(provisioned.get('main-db')?.type).toBe('d1');
    expect(provisioned.get('assets')?.type).toBe('r2');
    expect(provisioned.get('embeddings')?.type).toBe('vectorize');
    expect(results.find((result) => result.name === 'api-secret')?.type).toBe('secretRef');
    expect(mocks.cfApi).toHaveBeenCalledTimes(3);
  });

  it('dry-run mode skips actual provisioning', async () => {
    const { provisionResources } = await import('../src/lib/group-deploy/provisioner.js');

    const resources = {
      'main-db': { type: 'd1' },
      assets: { type: 'r2' },
    };

    const { provisioned, results } = await provisionResources(resources, {
      accountId: 'acct',
      apiToken: 'tok',
      groupName: 'app',
      env: 'staging',
      dryRun: true,
    });

    expect(mocks.cfApi).not.toHaveBeenCalled();
    expect(mocks.execCommand).not.toHaveBeenCalled();
    expect(provisioned.size).toBe(2);
    expect(results.every(r => r.status === 'provisioned')).toBe(true);
    expect(results.every(r => r.id?.startsWith('(dry-run)'))).toBe(true);
  });

  it('handles provider errors gracefully', async () => {
    const { provisionResources } = await import('../src/lib/group-deploy/provisioner.js');

    mocks.cfApi.mockRejectedValueOnce(new Error('CF API 503'));

    const resources = {
      'main-db': { type: 'd1' },
    };

    const { results } = await provisionResources(resources, {
      accountId: 'acct',
      apiToken: 'tok',
      groupName: 'app',
      env: 'staging',
    });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toContain('CF API 503');
  });

  it('reports unsupported resource type as failed', async () => {
    const { provisionResources } = await import('../src/lib/group-deploy/provisioner.js');

    const resources = {
      mystery: { type: 'unknown-thing' },
    };

    const { results } = await provisionResources(resources, {
      accountId: 'acct',
      apiToken: 'tok',
      groupName: 'app',
      env: 'staging',
    });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('failed');
    expect(results[0].error).toContain('Unsupported resource type');
  });
});

// ── Non-Cloudflare providers: graceful failure ───────────────────────────────

describe('Non-Cloudflare providers graceful failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // All non-CF providers use execCommand which we can mock to simulate missing CLI
    mocks.execCommand.mockRejectedValue(new Error('ENOENT: command not found'));
  });

  it('AWSProvider handles missing aws CLI', async () => {
    const provider = new AWSProvider();
    const result = await provider.createDatabase('test-db');
    expect(result.status).toBe('failed');
    expect(result.error).toContain('not available');
  });

  it('GCPProvider handles missing gcloud CLI', async () => {
    const provider = new GCPProvider({ project: 'test' });
    const result = await provider.createDatabase('test-db');
    expect(result.status).toBe('failed');
    expect(result.error).toContain('not available');
  });

  it('K8sProvider handles missing kubectl CLI', async () => {
    const provider = new K8sProvider();
    const result = await provider.createDatabase('test-db');
    expect(result.status).toBe('failed');
    expect(result.error).toContain('not available');
  });

  it('DockerProvider handles missing docker CLI', async () => {
    const provider = new DockerProvider();
    const result = await provider.createDatabase('test-db');
    expect(result.status).toBe('failed');
    expect(result.error).toContain('not available');
  });
});
