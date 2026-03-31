// ── Mock cloudflare-utils before any imports ────────────────────────────────

import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  cfApi: ((..._args: any[]) => undefined) as any,
  execCommand: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '../src/lib/group-deploy/cloudflare-utils.ts'
import type { ResourceProvider, ProvisionResult } from '../src/lib/group-deploy/resource-provider.ts';
import { CloudflareProvider } from '../src/lib/group-deploy/providers/cloudflare.ts';
import { AWSProvider } from '../src/lib/group-deploy/providers/aws.ts';
import { GCPProvider } from '../src/lib/group-deploy/providers/gcp.ts';
import { K8sProvider } from '../src/lib/group-deploy/providers/kubernetes.ts';
import { DockerProvider } from '../src/lib/group-deploy/providers/docker.ts';
import { resolveProvider } from '../src/lib/group-deploy/provisioner.ts';

// ── ResourceProvider interface conformance ───────────────────────────────────


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
    Deno.test(`${name} - has a name property`, () => {
      const provider = create();
      assertEquals(typeof provider.name, 'string');
      assert(provider.name.length > 0);
    });

    Deno.test(`${name} - implements all required methods`, () => {
      const provider = create();
      assertEquals(typeof provider.createDatabase, 'function');
      assertEquals(typeof provider.createObjectStorage, 'function');
      assertEquals(typeof provider.createKeyValueStore, 'function');
      assertEquals(typeof provider.createQueue, 'function');
      assertEquals(typeof provider.createVectorIndex, 'function');
      assertEquals(typeof provider.createSecret, 'function');
      assertEquals(typeof provider.skipAutoConfigured, 'function');
    });

    Deno.test(`${name} - skipAutoConfigured returns a skipped result synchronously`, () => {
      const provider = create();
      const result = provider.skipAutoConfigured('test-resource', 'durableObject');
      assertEquals(result.status, 'skipped');
      assertEquals(result.name, 'test-resource');
      assertEquals(result.type, 'durableObject');
    });
  }

// ── CloudflareProvider ───────────────────────────────────────────────────────


  let provider: CloudflareProvider;
  Deno.test('CloudflareProvider - creates a D1 database via CF API', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    provider = new CloudflareProvider({
      accountId: 'acct-123',
      apiToken: 'tok-abc',
      groupName: 'myapp',
      env: 'staging',
    });
  mocks.cfApi = (async () => ({ uuid: 'd1-uuid-001' })) as any;

    const result = await provider.createDatabase('main-db');

    assertSpyCallArgs(mocks.cfApi, 0, ['acct-123', 'tok-abc', 'POST', '/d1/database', { name: 'myapp-staging-main-db' }]);
    assertEquals(result, {
      name: 'myapp-staging-main-db',
      type: 'd1',
      status: 'provisioned',
      id: 'd1-uuid-001',
    });
})
  Deno.test('CloudflareProvider - creates an R2 bucket via CF API', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    provider = new CloudflareProvider({
      accountId: 'acct-123',
      apiToken: 'tok-abc',
      groupName: 'myapp',
      env: 'staging',
    });
  mocks.cfApi = (async () => ({})) as any;

    const result = await provider.createObjectStorage('assets');

    assertSpyCallArgs(mocks.cfApi, 0, ['acct-123', 'tok-abc', 'POST', '/r2/buckets', { name: 'myapp-staging-assets' }]);
    assertEquals(result.status, 'provisioned');
    assertEquals(result.type, 'r2');
})
  Deno.test('CloudflareProvider - creates a KV namespace via CF API', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    provider = new CloudflareProvider({
      accountId: 'acct-123',
      apiToken: 'tok-abc',
      groupName: 'myapp',
      env: 'staging',
    });
  mocks.cfApi = (async () => ({ id: 'kv-id-001' })) as any;

    const result = await provider.createKeyValueStore('cache');

    assertSpyCallArgs(mocks.cfApi, 0, ['acct-123', 'tok-abc', 'POST', '/storage/kv/namespaces', { title: 'myapp-staging-cache' }]);
    assertEquals(result, {
      name: 'myapp-staging-cache',
      type: 'kv',
      status: 'provisioned',
      id: 'kv-id-001',
    });
})
  Deno.test('CloudflareProvider - creates a queue via wrangler CLI', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    provider = new CloudflareProvider({
      accountId: 'acct-123',
      apiToken: 'tok-abc',
      groupName: 'myapp',
      env: 'staging',
    });
  mocks.execCommand = (async () => ({ stdout: '', stderr: '', exitCode: 0 })) as any;

    const result = await provider.createQueue('task-queue');

    assertSpyCallArgs(mocks.execCommand, 0, [
      'npx',
      ['wrangler', 'queues', 'create', 'myapp-staging-task-queue'],
      ({ env: ({ CLOUDFLARE_ACCOUNT_ID: 'acct-123' }) }),
    ]);
    assertEquals(result.status, 'provisioned');
})
  Deno.test('CloudflareProvider - reports queue as exists when wrangler exits non-zero', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    provider = new CloudflareProvider({
      accountId: 'acct-123',
      apiToken: 'tok-abc',
      groupName: 'myapp',
      env: 'staging',
    });
  mocks.execCommand = (async () => ({ stdout: '', stderr: 'already exists', exitCode: 1 })) as any;

    const result = await provider.createQueue('task-queue');
    assertEquals(result.status, 'exists');
})
  Deno.test('CloudflareProvider - creates a vectorize index via wrangler CLI', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    provider = new CloudflareProvider({
      accountId: 'acct-123',
      apiToken: 'tok-abc',
      groupName: 'myapp',
      env: 'staging',
    });
  mocks.execCommand = (async () => ({ stdout: '', stderr: '', exitCode: 0 })) as any;

    const result = await provider.createVectorIndex('embeddings', { dimensions: 768, metric: 'euclidean' });

    assertSpyCallArgs(mocks.execCommand, 0, [
      'npx',
      ['wrangler', 'vectorize', 'create', 'myapp-staging-embeddings', '--dimensions', '768', '--metric', 'euclidean'],
      ({ env: ({ CLOUDFLARE_API_TOKEN: 'tok-abc' }) }),
    ]);
    assertEquals(result.status, 'provisioned');
})
  Deno.test('CloudflareProvider - creates a secret with a random hex value', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    provider = new CloudflareProvider({
      accountId: 'acct-123',
      apiToken: 'tok-abc',
      groupName: 'myapp',
      env: 'staging',
    });
  const result = await provider.createSecret('api-key', 'API_KEY');

    assertEquals(result.status, 'provisioned');
    assertEquals(result.type, 'secretRef');
    // The id should be a 64-character hex string (32 random bytes)
    assert(/^[0-9a-f]{64}$/.test(result.id));
})
  Deno.test('CloudflareProvider - skipAutoConfigured returns skipped with message', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    provider = new CloudflareProvider({
      accountId: 'acct-123',
      apiToken: 'tok-abc',
      groupName: 'myapp',
      env: 'staging',
    });
  const result = provider.skipAutoConfigured('my-do', 'durableObject');

    assertEquals(result.status, 'skipped');
    assertStringIncludes(result.error, 'wrangler deploy');
})
// ── Provider resolution ──────────────────────────────────────────────────────


  const baseOpts = { groupName: 'app', env: 'staging' };
  Deno.test('resolveProvider - returns CloudflareProvider when accountId and apiToken are provided', () => {
  // Clean up env vars that influence provider detection
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.KUBECONFIG;
  const provider = resolveProvider({ ...baseOpts, accountId: 'acct', apiToken: 'tok' });
    assertEquals(provider.name, 'cloudflare');
    assert(provider instanceof CloudflareProvider);
})
  Deno.test('resolveProvider - returns AWSProvider when AWS_ACCESS_KEY_ID is set', () => {
  // Clean up env vars that influence provider detection
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.KUBECONFIG;
  process.env.AWS_ACCESS_KEY_ID = 'AKID123';
    const provider = resolveProvider(baseOpts);
    assertEquals(provider.name, 'aws');
    assert(provider instanceof AWSProvider);
})
  Deno.test('resolveProvider - returns GCPProvider when GOOGLE_APPLICATION_CREDENTIALS is set', () => {
  // Clean up env vars that influence provider detection
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.KUBECONFIG;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/creds.json';
    const provider = resolveProvider(baseOpts);
    assertEquals(provider.name, 'gcp');
    assert(provider instanceof GCPProvider);
})
  Deno.test('resolveProvider - returns K8sProvider when KUBECONFIG is set', () => {
  // Clean up env vars that influence provider detection
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.KUBECONFIG;
  process.env.KUBECONFIG = '/path/to/kubeconfig';
    const provider = resolveProvider(baseOpts);
    assertEquals(provider.name, 'k8s');
    assert(provider instanceof K8sProvider);
})
  Deno.test('resolveProvider - falls back to DockerProvider when no cloud env is detected', () => {
  // Clean up env vars that influence provider detection
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.KUBECONFIG;
  const provider = resolveProvider(baseOpts);
    assertEquals(provider.name, 'docker');
    assert(provider instanceof DockerProvider);
})
  Deno.test('resolveProvider - prefers Cloudflare over AWS when both are available', () => {
  // Clean up env vars that influence provider detection
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.KUBECONFIG;
  process.env.AWS_ACCESS_KEY_ID = 'AKID123';
    const provider = resolveProvider({ ...baseOpts, accountId: 'acct', apiToken: 'tok' });
    assertEquals(provider.name, 'cloudflare');
})
  Deno.test('resolveProvider - prefers AWS over GCP when both env vars are set', () => {
  // Clean up env vars that influence provider detection
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.KUBECONFIG;
  process.env.AWS_ACCESS_KEY_ID = 'AKID123';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/path/to/creds.json';
    const provider = resolveProvider(baseOpts);
    assertEquals(provider.name, 'aws');
})
// ── provisionResources integration with provider ─────────────────────────────


  Deno.test('provisionResources (with CloudflareProvider) - provisions mixed resource types through the provider', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.cfApi;
    mocks.execCommand;
  const { provisionResources } = await import('../src/lib/group-deploy/provisioner.ts');

    mocks.cfApi
       = (async () => ({ uuid: 'd1-id' })) as any     // d1
       = (async () => ({})) as any                      // r2
       = (async () => ({ id: 'kv-id' })) as any;       // kv

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

    assertEquals(provisioned.size, 4);
    assertEquals(results.length, 4);

    // D1
    const d1Result = results.find(r => r.name === 'main-db');
    assertEquals(d1Result?.status, 'provisioned');
    assertEquals(d1Result?.id, 'd1-id');

    // R2
    const r2Result = results.find(r => r.name === 'assets');
    assertEquals(r2Result?.status, 'provisioned');

    // KV
    const kvResult = results.find(r => r.name === 'cache');
    assertEquals(kvResult?.status, 'provisioned');
    assertEquals(kvResult?.id, 'kv-id');

    // DurableObject (auto-configured)
    const doResult = results.find(r => r.name === 'my-do');
    assertEquals(doResult?.status, 'skipped');
})
  Deno.test('provisionResources (with CloudflareProvider) - canonicalizes portable-style resource aliases before provisioning', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.cfApi;
    mocks.execCommand;
  const { provisionResources } = await import('../src/lib/group-deploy/provisioner.ts');

    mocks.cfApi
       = (async () => ({ uuid: 'sql-id' })) as any         // sql -> d1
       = (async () => ({})) as any                          // object_store -> r2
       = (async () => ({ id: 'kv-id' })) as any             // kv
       = (async () => ({ id: 'vector-id' })) as any         // vector_index -> vectorize

    mocks.execCommand = (async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })) as any;

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

    assertEquals(provisioned.size, 5);
    assertEquals(results.length, 5);

    assertEquals(provisioned.get('main-db')?.type, 'd1');
    assertEquals(provisioned.get('assets')?.type, 'r2');
    assertEquals(provisioned.get('embeddings')?.type, 'vectorize');
    assertEquals(results.find((result) => result.name === 'api-secret')?.type, 'secretRef');
    assertSpyCalls(mocks.cfApi, 3);
})
  Deno.test('provisionResources (with CloudflareProvider) - dry-run mode skips actual provisioning', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.cfApi;
    mocks.execCommand;
  const { provisionResources } = await import('../src/lib/group-deploy/provisioner.ts');

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

    assertSpyCalls(mocks.cfApi, 0);
    assertSpyCalls(mocks.execCommand, 0);
    assertEquals(provisioned.size, 2);
    assertEquals(results.every(r => r.status === 'provisioned'), true);
    assertEquals(results.every(r => r.id?.startsWith('(dry-run)')), true);
})
  Deno.test('provisionResources (with CloudflareProvider) - handles provider errors gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.cfApi;
    mocks.execCommand;
  const { provisionResources } = await import('../src/lib/group-deploy/provisioner.ts');

    mocks.cfApi = (async () => { throw new Error('CF API 503'); }) as any;

    const resources = {
      'main-db': { type: 'd1' },
    };

    const { results } = await provisionResources(resources, {
      accountId: 'acct',
      apiToken: 'tok',
      groupName: 'app',
      env: 'staging',
    });

    assertEquals(results.length, 1);
    assertEquals(results[0].status, 'failed');
    assertStringIncludes(results[0].error, 'CF API 503');
})
  Deno.test('provisionResources (with CloudflareProvider) - reports unsupported resource type as failed', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.cfApi;
    mocks.execCommand;
  const { provisionResources } = await import('../src/lib/group-deploy/provisioner.ts');

    const resources = {
      mystery: { type: 'unknown-thing' },
    };

    const { results } = await provisionResources(resources, {
      accountId: 'acct',
      apiToken: 'tok',
      groupName: 'app',
      env: 'staging',
    });

    assertEquals(results.length, 1);
    assertEquals(results[0].status, 'failed');
    assertStringIncludes(results[0].error, 'Unsupported resource type');
})
// ── Non-Cloudflare providers: graceful failure ───────────────────────────────


  Deno.test('Non-Cloudflare providers graceful failure - AWSProvider handles missing aws CLI', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // All non-CF providers use execCommand which we can mock to simulate missing CLI
    mocks.execCommand = (async () => { throw new Error('ENOENT: command not found'); }) as any;
  const provider = new AWSProvider();
    const result = await provider.createDatabase('test-db');
    assertEquals(result.status, 'failed');
    assertStringIncludes(result.error, 'not available');
})
  Deno.test('Non-Cloudflare providers graceful failure - GCPProvider handles missing gcloud CLI', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // All non-CF providers use execCommand which we can mock to simulate missing CLI
    mocks.execCommand = (async () => { throw new Error('ENOENT: command not found'); }) as any;
  const provider = new GCPProvider({ project: 'test' });
    const result = await provider.createDatabase('test-db');
    assertEquals(result.status, 'failed');
    assertStringIncludes(result.error, 'not available');
})
  Deno.test('Non-Cloudflare providers graceful failure - K8sProvider handles missing kubectl CLI', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // All non-CF providers use execCommand which we can mock to simulate missing CLI
    mocks.execCommand = (async () => { throw new Error('ENOENT: command not found'); }) as any;
  const provider = new K8sProvider();
    const result = await provider.createDatabase('test-db');
    assertEquals(result.status, 'failed');
    assertStringIncludes(result.error, 'not available');
})
  Deno.test('Non-Cloudflare providers graceful failure - DockerProvider handles missing docker CLI', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // All non-CF providers use execCommand which we can mock to simulate missing CLI
    mocks.execCommand = (async () => { throw new Error('ENOENT: command not found'); }) as any;
  const provider = new DockerProvider();
    const result = await provider.createDatabase('test-db');
    assertEquals(result.status, 'failed');
    assertStringIncludes(result.error, 'not available');
})