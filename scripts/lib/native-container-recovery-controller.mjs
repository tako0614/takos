#!/usr/bin/env node
// Native local proof over explicitly selected, preloaded images. The child owns
// exact DO destruction and Miniflare disposal; the supervisor owns the process group.
import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { Miniflare } from 'miniflare';
import { createRuntimeRecoveryObserver } from './native-runtime-recovery-observer.mjs';
import { createNativeContainerWorkerFixture } from './native-container-worker-fixture.mjs';
import { proveFirstProjector } from './native-first-projector-steps.mjs';
import { createFirstProjectorObserver } from './native-first-projector-observer.mjs';
import { assertDockerImageIdentity } from './oci-image-identity.ts';
import { nativeRecoveryPoolContainerId } from './native-container-proof-ownership.ts';
import { captureNativeContainerTransportLogs } from './native-container-transport-logs.mjs';

const execFile = promisify(execFileCallback);
const miniflareRequire = createRequire(import.meta.resolve('miniflare'));
const actualWorkerdModule = miniflareRequire.resolve('workerd');
const migrationManifest = 'src/worker/platform/migrations/migration-set.generated.json';
const wranglerConfig = 'deploy/cloudflare/wrangler.toml';
const overallMs = 320_000; // Child watchdog; the public supervisor has its own 350-second bound.
const phaseMs = 45_000; // Admission and old tool-ACK loss each have a separate phase budget.
const completionPhaseMs = 90_000; // Replacement replay and terminal RPC budget.

function assert(value, message) { if (!value) throw new Error(message); }
function record(value, label) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} is not an object`);
  return value;
}
async function fileSha(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
function makeCommand(root) {
  return async (executable, args, timeout = 10_000, maxBuffer = 64 * 1024 * 1024) =>
    execFile(executable, args, { cwd: root, encoding: 'utf8', timeout, maxBuffer });
}
function validateOptions(value) {
  const options = record(value, 'native child options');
  assert(typeof options.diagnosticContainerTransport === 'boolean', 'diagnostic Container transport option must be boolean');
  assert(Array.isArray(options.containersBefore) && options.containersBefore.every((id) => /^[a-f0-9]{64}$/u.test(id)),
    'parent physical Container baseline is required');
  for (const path of ['root', 'bun', 'outputDir', 'layout'])
    assert(typeof options[path] === 'string' && isAbsolute(options[path]), `${path} must be absolute`);
  for (const name of ['reference', 'sourceCommit', 'expectedManifestDigest', 'image',
    'sidecarImage', 'dockerImageId', 'sidecarImageId', 'callbackHost', 'listenHost', 'callbackUrl'])
    assert(typeof options[name] === 'string' && options[name].length > 0, `missing ${name}`);
  assert(/^sha256:[a-f0-9]{64}$/u.test(options.expectedManifestDigest) &&
    /^sha256:[a-f0-9]{64}$/u.test(options.dockerImageId) &&
    /^sha256:[a-f0-9]{64}$/u.test(options.sidecarImageId), 'invalid image digest');
  assert(/^[a-f0-9]{40}$/u.test(options.sourceCommit), 'sourceCommit must be a Git commit');
  assert(Number.isSafeInteger(options.port) && options.port >= 1024 && options.port <= 65535,
    'invalid native callback port');
  assert(!/[/:\s]/u.test(options.callbackHost) && !/[/:\s]/u.test(options.listenHost) &&
    options.callbackHost !== 'localhost' && options.callbackHost !== '127.0.0.1',
    'callback hosts must be bare and Docker-reachable');
  assert(options.callbackUrl === `http://${options.callbackHost}:${options.port}`,
    'callbackUrl differs from configured listener');
  const relativeOutput = relative(options.root, options.outputDir);
  assert(relativeOutput && relativeOutput !== '..' &&
    !relativeOutput.startsWith(`..${String.fromCharCode(47)}`) && !isAbsolute(relativeOutput),
    'native outputDir must be inside the selected repository worktree');
  const identity = record(options.imageIdentity, 'verified OCI image identity');
  assert(identity.sourceCommit === options.sourceCommit &&
    identity.manifestDigest === options.expectedManifestDigest &&
    /^sha256:[a-f0-9]{64}$/u.test(identity.configDigest) &&
    [identity.configDigest, identity.manifestDigest].includes(options.dockerImageId) &&
    identity.imageUser === 'takos' && identity.imageWorkdir === '/app' &&
    JSON.stringify(identity.imageCmd) === JSON.stringify(['/usr/local/bin/takos-agent']) &&
    identity.platform === 'linux/amd64' && Array.isArray(identity.layerDigests) &&
    Array.isArray(identity.rootfsDiffIds) &&
    identity.rootfsDiffIds.length > 0 &&
    identity.layerDigests.length === identity.rootfsDiffIds.length &&
    identity.layerDigests.every((item) => /^sha256:[a-f0-9]{64}$/u.test(item)) &&
    identity.rootfsDiffIds.every((item) => /^sha256:[a-f0-9]{64}$/u.test(item)),
  'supplied OCI identity is incomplete or differs from explicit options');
  assert(/@sha256:[a-f0-9]{64}$/u.test(options.sidecarImage),
    'sidecar image must be pinned by digest');
  assert(Object.keys(record(options.sourceHashesBefore, 'parent source hashes')).length > 0,
    'parent source hash map is required and must not be empty');
  return options;
}
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function verifyParentSourceSnapshot(root, hashes) {
  const physicalRoot = await realpath(root);
  const entries = Object.entries(hashes).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0);
  assert(entries.length > 0, 'parent source hash map is empty');
  for (const [path, expected] of entries) {
    assert(typeof path === 'string' && path.length > 0 && !isAbsolute(path) &&
      !path.includes('\\') && !path.includes('\0') &&
      typeof expected === 'string' && /^[a-f0-9]{64}$/u.test(expected),
    'parent source hash entry has an invalid path or digest');
    const absolute = resolve(root, path);
    const lexical = relative(root, absolute);
    assert(lexical === path && lexical !== '..' &&
      !lexical.startsWith(`..${String.fromCharCode(47)}`),
    `parent source path escapes or aliases the checkout: ${path}`);
    const physical = relative(physicalRoot, await realpath(absolute));
    assert(physical && physical !== '..' &&
      !physical.startsWith(`..${String.fromCharCode(47)}`) && !isAbsolute(physical),
    `parent source path resolves outside the checkout: ${path}`);
    assert(await fileSha(absolute) === expected, `parent source hash differs at ${path}`);
  }
  return { fileCount: entries.length,
    sha256: createHash('sha256').update(JSON.stringify(entries)).digest('hex') };
}
async function snapshot(root, paths) {
  const result = {};
  for (const path of [...new Set(paths)].sort()) result[path] = await fileSha(resolve(root, path));
  return result;
}
async function preflight(options, stages) {
  const root = options.root;
  const command = makeCommand(root);
  stages.push({ stage: 'preflight-start', at: new Date().toISOString() });
  const parentSourceSnapshot = await verifyParentSourceSnapshot(root, options.sourceHashesBefore);
  const identity = options.imageIdentity;
  const headCommit = (await command('git', ['rev-parse', 'HEAD'])).stdout.trim();
  assert(/^[a-f0-9]{40}$/u.test(headCommit), 'cannot read actual source HEAD');
  const dirtyStatus = (await command('git', ['status', '--porcelain=v1', '--untracked-files=all'])).stdout;
  const sourceState = { headCommit, imageSourceCommit: options.sourceCommit,
    dirty: dirtyStatus.length > 0, dirtyStatus,
    dirtyStatusSha256: createHash('sha256').update(dirtyStatus).digest('hex'),
    headMatchesImageSource: headCommit === options.sourceCommit,
    generatedFixtureIsRuntimeOnly: true,
    diagnosticContainerTransport: options.diagnosticContainerTransport,
    diagnosticTransportLimitation: options.diagnosticContainerTransport
      ? 'RUST_LOG debug and bounded read-only Docker log snapshots alter timing; success does not establish the earlier config transport failure cause or uninstrumented behavior'
      : null,
    provenanceClaim: 'current worktree and generated local fixture bytes; no reviewed commit artifact claim' };
  const imageInputs = [
    'containers/agent/Dockerfile', 'containers/agent/Cargo.toml',
    'containers/agent/Cargo.lock', 'containers/agent/engine-source.json',
    ...(await command('git', ['ls-files', 'containers/agent/src'])).stdout.split('\n').filter(Boolean),
  ];
  await command('git', ['diff', '--exit-code', options.sourceCommit, 'HEAD', '--', ...imageInputs]);
  await command('git', ['diff', '--exit-code', 'HEAD', '--', ...imageInputs]);
  const imageSourceStatus = (await command('git', ['status', '--porcelain=v1', '--untracked-files=all',
    '--', 'containers/agent'])).stdout;
  assert(imageSourceStatus.length === 0, 'agent image source is dirty relative to verified OCI source commit');
  const generated = record(await readJson(resolve(root, migrationManifest)), 'generated migration manifest');
  assert(Array.isArray(generated.entries) && generated.entries.length > 0,
    'generated migration manifest has no entries');
  const migrations = generated.entries.map((entry) => ({ name: entry.name, sha256: entry.sha256 }));
  assert(migrations.every((entry) => typeof entry.name === 'string' &&
    /^[A-Za-z0-9_.-]+\.sql$/u.test(entry.name) &&
    /^sha256:[a-f0-9]{64}$/u.test(entry.sha256)) &&
    new Set(migrations.map((entry) => entry.name)).size === migrations.length,
  'generated migration names/checksums are invalid');
  const paths = [wranglerConfig, migrationManifest, 'scripts/lib/build-native-proof-fixture.ts',
    'scripts/lib/native-container-recovery-controller.mjs',
    'scripts/lib/native-container-worker-fixture.mjs',
    'scripts/lib/native-first-projector-fixture.mjs',
    'scripts/lib/native-owned-work-tracker.mjs',
    'scripts/lib/native-first-projector-steps.mjs',
    'scripts/lib/native-runtime-recovery-observer.mjs',
    'scripts/lib/native-recovery-checkpoint-witness.mjs',
    'scripts/lib/native-first-projector-observer.mjs',
    'scripts/lib/oci-image-identity.ts',
    'scripts/lib/native-container-proof-ownership.ts',
    'scripts/lib/native-container-transport-logs.mjs',
    'src/worker/index.ts', 'src/worker/runtime/runner/cron-handler.ts',
    'src/worker/runtime/runner/queue-handler.ts',
    'src/worker/web.ts', 'src/worker/runtime/container-hosts/executor-host.ts',
    'src/worker/runtime/container-hosts/container-runtime.ts',
    ...imageInputs, ...migrations.map((entry) => `db/migrations-control/migrations/${entry.name}`)];
  const sourcesBefore = await snapshot(root, paths);
  for (const [path, hash] of Object.entries(sourcesBefore))
    assert(Object.hasOwn(options.sourceHashesBefore, path) &&
      options.sourceHashesBefore[path] === hash,
    `proof source is absent or differs from parent snapshot: ${path}`);
  for (const entry of migrations)
    assert(sourcesBefore[`db/migrations-control/migrations/${entry.name}`] === entry.sha256.slice(7),
      `generated migration checksum differs from source: ${entry.name}`);
  const docker = await command('docker', ['info', '--format', '{{.ServerVersion}}']);
  assert(docker.stdout.trim(), 'Docker daemon health preflight returned no server version');
  let inspected;
  try {
    inspected = JSON.parse((await command('docker', ['image', 'inspect', options.image, '--format', '{{json .}}'])).stdout);
  } catch (error) {
    throw new Error('agent image is not locally inspectable; this child never loads, pulls, tags, or builds', { cause: error });
  }
  const image = record(inspected, 'Docker image inspect');
  assertDockerImageIdentity(image, identity, options.dockerImageId);
  let sidecar;
  try {
    sidecar = record(JSON.parse((await command('docker', ['image', 'inspect', options.sidecarImage,
      '--format', '{{json .}}'])).stdout), 'Docker sidecar inspect');
  } catch (error) {
    throw new Error('pinned Miniflare egress sidecar is not locally inspectable', { cause: error });
  }
  const sidecarDigest = options.sidecarImage.slice(options.sidecarImage.lastIndexOf('@') + 1);
  assert(sidecar.Id === options.sidecarImageId &&
    (sidecar.Descriptor?.digest === sidecarDigest ||
      sidecar.RepoDigests?.some((entry) => String(entry).endsWith(`@${sidecarDigest}`))),
  'local sidecar does not match pinned egress image digest');
  stages.push({ stage: 'preflight-ready', at: new Date().toISOString(),
    image: options.image, imageId: image.Id, manifestDigest: identity.manifestDigest,
    sidecarImageId: sidecar.Id });
  return { identity: {
    layout: options.layout, reference: options.reference,
    manifestDigest: identity.manifestDigest, configDigest: identity.configDigest,
    layerDigests: identity.layerDigests, rootfsDiffIds: identity.rootfsDiffIds,
    platform: identity.platform, imageUser: identity.imageUser,
    imageCmd: identity.imageCmd, imageWorkdir: identity.imageWorkdir,
    dockerImageId: image.Id, dockerDescriptorDigest: image.Descriptor?.digest ?? null,
    imageTag: options.image, imageSourceCommit: options.sourceCommit,
    sourceCommitEvidence: identity.sourceCommitEvidence,
    dockerServerVersion: docker.stdout.trim(), sidecarRef: options.sidecarImage,
    sidecarImageId: sidecar.Id,
  }, migrations, paths, sourcesBefore, sourceState, parentSourceSnapshot };
}

async function buildFixture(options, fixturePath, bundleDir) {
  const root = options.root;
  const command = makeCommand(root);
  const helper = resolve(root, 'scripts/lib/build-native-proof-fixture.ts');
  const output = await command(options.bun,
    [helper, fixturePath, bundleDir, resolve(root, wranglerConfig)], 40_000);
  const built = record(JSON.parse(output.stdout), 'native fixture build result');
  assert(built.success === true && built.outputs?.length === 1,
    `fixture build failed: ${JSON.stringify(built.logs)}`);
  assert(typeof built.compatibilityDate === 'string' &&
    Array.isArray(built.compatibilityFlags) &&
    built.compatibilityFlags.every((flag) => typeof flag === 'string') &&
    built.compatibilityFlags.includes('no_handle_cross_request_promise_resolution'),
  'Bun helper did not return required Wrangler compatibility metadata');
  const meta = typeof built.metafile === 'string' ? JSON.parse(built.metafile) : built.metafile;
  assert(meta?.inputs && Object.keys(meta.inputs).length > 0, 'fixture bundle has no input provenance');
  const inputHashes = {};
  for (const path of Object.keys(meta.inputs).sort()) {
    const resolvedPath = resolve(root, path);
    inputHashes[path] = { resolvedPath, sha256: await fileSha(resolvedPath) };
  }
  const bundlePath = built.outputs[0].path;
  return { script: await readFile(bundlePath, 'utf8'), bundlePath,
    bundleSha256: await fileSha(bundlePath), inputHashes, bunVersion: built.bunVersion,
    compatibility: { date: built.compatibilityDate, flags: built.compatibilityFlags } };
}

async function schemaReady(mf, request, expected) {
  let previous = [];
  for (let admission = 1; admission <= 2; admission++) {
    const response = await mf.dispatchFetch(...request('/__probe/schema'));
    const body = record(await response.json(), 'schema result');
    assert(response.ok && body.status, `schema admission ${admission} failed: HTTP ${response.status}`);
    const status = body.status;
    const rows = body.ledger;
    assert(Array.isArray(rows) && rows.length <= expected.length, 'invalid native migration ledger');
    for (let i = 0; i < rows.length; i++)
      assert(rows[i].name === expected[i].name && rows[i].checksum === expected[i].sha256 &&
        Number.isFinite(Date.parse(rows[i].applied_at)), `migration ledger mismatch at ${i}`);
    assert(JSON.stringify(rows.slice(0, previous.length)) === JSON.stringify(previous),
      'migration continuation changed committed ledger prefix');
    if (status.state === 'ready') {
      assert(rows.length === expected.length && status.total === expected.length &&
        status.applied === expected.length && status.pending?.length === 0,
      'native migration gate did not converge the full generated manifest');
      return rows;
    }
    assert(admission === 1 && status.state === 'pending' && status.retryAfterSeconds === 5,
      `schema did not converge within two default admissions: ${JSON.stringify(status)}`);
    previous = rows;
    await new Promise((resolveWait) => setTimeout(resolveWait, 5_000));
  }
  throw new Error('unreachable schema state');
}

async function seed(db, run, now) {
  await db.prepare(`INSERT INTO accounts (id,type,status,name,slug,owner_account_id,created_at,updated_at)
    VALUES (?,'user','active','Probe Owner',?,?,?,?)`)
    .bind(run.ownerId, run.ownerId, run.ownerId, now, now).run();
  await db.prepare(`INSERT INTO auth_identities (id,user_id,provider,provider_sub,linked_at,last_login_at)
    VALUES (?,?,'oidc',?,?,?)`)
    .bind(`${run.runId}-identity`, run.ownerId, 'https://issuer.example.test#probe-owner', now, now).run();
  await db.prepare(`INSERT INTO accounts (id,type,status,name,slug,owner_account_id,created_at,updated_at)
    VALUES (?,'team','active','Probe Private Workspace',?,?,?,?)`)
    .bind(run.workspaceId, run.workspaceId, run.ownerId, now, now).run();
  await db.prepare(`INSERT INTO account_memberships (id,account_id,member_id,role,status,created_at,updated_at)
    VALUES (?,?,?,'owner','active',?,?)`)
    .bind(`${run.runId}-membership`, run.workspaceId, run.ownerId, now, now).run();
  await db.prepare(`INSERT INTO account_settings (account_id,private_account,created_at,updated_at)
    VALUES (?,1,?,?)`).bind(run.workspaceId, now, now).run();
  await db.prepare(`INSERT INTO threads (id,account_id,title,next_message_sequence,created_at,updated_at)
    VALUES (?,?,'Canonical Container admission probe',1,?,?)`)
    .bind(run.threadId, run.workspaceId, now, now).run();
  await db.prepare(`INSERT INTO runs
    (id,thread_id,account_id,requester_account_id,agent_type,model,status,input,usage,service_id,lease_version,created_at)
    VALUES (?,?,?,?,'default','gpt-local','running',?,'{}',?,7,?)`)
    .bind(run.runId, run.threadId, run.workspaceId, run.ownerId,
      JSON.stringify({ message: 'Probe only the canonical Container admission path' }),
      run.serviceId, now).run();
  await db.prepare(`INSERT INTO messages (id,thread_id,role,content,sequence,created_at)
    VALUES (?,?,'user','Probe only canonical admission',0,?)`)
    .bind(`${run.runId}-user-message`, run.threadId, now).run();
  const owner = await db.prepare(`SELECT a.id, a.status, i.provider_sub FROM accounts a
    JOIN auth_identities i ON i.user_id=a.id WHERE a.id=?`).bind(run.ownerId).first();
  const workspace = await db.prepare(`SELECT a.id, a.owner_account_id, s.private_account,
    m.member_id, m.role, m.status FROM accounts a
    JOIN account_settings s ON s.account_id=a.id
    JOIN account_memberships m ON m.account_id=a.id WHERE a.id=?`).bind(run.workspaceId).first();
  assert(owner?.status === 'active' && owner.provider_sub === 'https://issuer.example.test#probe-owner' &&
    workspace?.owner_account_id === run.ownerId && workspace.private_account === 1 &&
    workspace.member_id === run.ownerId && workspace.role === 'owner' && workspace.status === 'active',
  'fresh D1 seed did not establish exact active owner/private Workspace authority');
  const thread = await db.prepare('SELECT next_message_sequence FROM threads WHERE id=?')
    .bind(run.threadId).first();
  assert(thread?.next_message_sequence === 1,
    'fresh thread allocator must follow its existing sequence-0 user message');
  return { owner, workspace, thread };
}

async function waitForObservation(mf, request, deadline) {
  const attempts = [];
  while (Date.now() < deadline) {
    const response = await mf.dispatchFetch(...request('/__probe/observation'));
    assert(response.ok, `observation route failed: HTTP ${response.status}`);
    const body = record(await response.json(), 'observation response');
    if (body.observation) return { observation: body.observation, attempts };
    attempts.push({ at: new Date().toISOString(), observed: false });
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`compiled Container made no canonical run-bootstrap callback before the 45-second phase deadline (${attempts.length} observations)`);
}

export async function runNativeContainerRecovery(inputOptions) {
  const options = validateOptions(inputOptions);
  const command = makeCommand(options.root);
  const logCommand = (executable, args, timeout, maxBuffer) =>
    execFile(executable, args, { cwd: options.root, encoding: 'buffer', timeout, maxBuffer });
  await mkdir(options.outputDir, { mode: 0o700 }); // EEXIST is intentional; never reuse native proof state.
  const stages = [];
  const started = Date.now();
  let mf, successResult, failure, destroyOwnedContainer, diagnosticControllerToken, runtimeObserver, projectorObserver;
  const completionObservationAttempts = [];
  const transportLogCaptures = [];
  let activeContainerWitness;
  const reportPath = join(options.outputDir, 'result.json');
  const watchdog = setTimeout(() => {
    void writeFile(join(options.outputDir, 'failure.json'), JSON.stringify({
      error: `owned Container admission probe exceeded ${overallMs}ms`, stages,
      at: new Date().toISOString(), outputDir: options.outputDir,
    }, null, 2)).catch(() => undefined);
    void Promise.resolve(mf?.dispose()).finally(() => process.exit(124));
    setTimeout(() => process.exit(124), 2_000).unref();
  }, overallMs);
  try {
    const before = await preflight(options, stages); // Docker health/inspect only. No load, pull or start here.
    const run = {
      runId: `run_${randomUUID()}`, serviceId: `service_${randomUUID()}`,
      ownerId: `owner_${randomUUID()}`, workspaceId: `workspace_${randomUUID()}`,
      threadId: `thread_${randomUUID()}`, containerId: `container_${randomUUID()}`,
      usageTrigger: `ga_run_usage_fence_${randomUUID().replaceAll("-", "")}`,
    };
    run.newContainerId = nativeRecoveryPoolContainerId(run.runId);
    const controllerToken = randomUUID();
    diagnosticControllerToken = controllerToken;
    const observerNonce = randomUUID(); // Correlation only; never an auth credential.
    runtimeObserver = createRuntimeRecoveryObserver({ runId: run.runId,
      containerIds: [run.containerId, run.newContainerId], nonce: observerNonce });
    projectorObserver = createFirstProjectorObserver({ runId: run.runId, nonce: observerNonce });
    const modelKey = `local-model-${randomUUID()}`;
    const fixturePath = join(options.outputDir, 'fixture-worker.ts');
    const bundleDir = join(options.outputDir, 'bundle');
    const stateDir = join(options.outputDir, 'native-state');
    await mkdir(bundleDir);
    await writeFile(fixturePath, createNativeContainerWorkerFixture({ root: options.root, run, controllerToken, observerNonce,
      diagnosticContainerTransport: options.diagnosticContainerTransport }));
    const built = await buildFixture(options, fixturePath, bundleDir);
    stages.push({ stage: 'fixture-built', at: new Date().toISOString(), sha256: built.bundleSha256 });
    const bindings = {
      OIDC_ISSUER_URL: 'https://issuer.example.test', OIDC_OWNER_SUBJECT: 'probe-owner',
      OIDC_CLIENT_ID: 'canonical-container-probe', ADMIN_DOMAIN: options.callbackHost,
      TENANT_BASE_DOMAIN: 'tenant.example.test',
      PLATFORM_PRIVATE_KEY: 'local-probe-private-placeholder',
      PLATFORM_PUBLIC_KEY: 'local-probe-public-placeholder',
      ENCRYPTION_KEY: 'local-probe-encryption-placeholder',
      TAKOS_AGENT_START_TOKEN: randomUUID(),
      TAKOS_AGENT_CONTROL_RPC_BASE_URL: options.callbackUrl,
      PROXY_BASE_URL: options.callbackUrl, AUTH_PUBLIC_BASE_URL: options.callbackUrl,
      FIRST_PROOF_RUN_ID: run.runId, FIRST_PROOF_WORKSPACE_ID: run.workspaceId,
      FIRST_PROOF_OWNER_ID: run.ownerId, FIRST_PROOF_NONCE: observerNonce,
      FIRST_PROOF_TRIGGER: run.usageTrigger, FIRST_PROOF_TOKEN: controllerToken,
      ENVIRONMENT: 'development', OPENAI_API_KEY: modelKey,
      OPENAI_BASE_URL: `${options.callbackUrl}/v1`, LOCAL_PROOF_MODEL_KEY: modelKey,
      EXECUTOR_TIER1_WARM_POOL_SIZE: '1', EXECUTOR_POOL_REVISION: run.runId.slice(4),
    };
    const nativeFlags = [...new Set([...built.compatibility.flags, 'service_binding_extra_handlers'])];
    const workerName = `canonical-container-${run.runId}`;
    const queueName = `canonical-container-${run.runId}-runs`;
    mf = new Miniflare({
      name: workerName, modules: true,
      script: built.script, scriptPath: built.bundlePath,
      compatibilityDate: built.compatibility.date,
      compatibilityFlags: nativeFlags,
      serviceBindings: { EXECUTOR_HOST: { name: workerName, entrypoint: 'NativeRecoveryExecutorHost' } },
      handleRuntimeStdio(stdout, stderr) {
        // Public Miniflare hook; preserve raw diagnostics while reading only
        // this child's own response marker. Never close parent stdio on exit.
        stdout.on('data', (chunk) => { runtimeObserver.feed(chunk); projectorObserver.feed(chunk); });
        stdout.on('end', () => runtimeObserver.end());
        stdout.pipe(process.stdout, { end: false });
        stderr.pipe(process.stderr, { end: false });
      },
      bindings,
      host: options.listenHost, port: options.port,
      containerEngine: { localDocker: { socketPath: 'unix:///var/run/docker.sock',
        containerEgressInterceptorImage: options.sidecarImage } },
      durableObjects: {
        EXECUTOR_CONTAINER: { className: 'ExecutorContainerTier1', useSQLite: true,
          container: { imageName: options.image } },
        SESSION_DO: { className: 'SessionDO', useSQLite: false },
        RUN_NOTIFIER: { className: 'RunNotifierDO', useSQLite: false },
      },
      durableObjectsPersist: join(stateDir, 'do'),
      d1Databases: { DB: `canonical-container-db-${run.runId}` },
      d1Persist: join(stateDir, 'd1'),
      r2Buckets: { TAKOS_OFFLOAD: `canonical-container-r2-${run.runId}` },
      r2Persist: join(stateDir, 'r2'),
      kvNamespaces: { HOSTNAME_ROUTING: `canonical-container-kv-${run.runId}` },
      kvPersist: join(stateDir, 'kv'),
      queueProducers: { RUN_QUEUE: queueName },
      queueConsumers: { [queueName]: { maxBatchSize: 1, maxBatchTimeout: 1 } },
      queuePersist: join(stateDir, 'queue'),
    });
    destroyOwnedContainer = async () => {
      const acknowledgements = [];
      for (const [path, containerId] of [['/__probe/destroy', run.containerId], ['/__probe/destroy-new', run.newContainerId]]) {
      const response = await mf.dispatchFetch(`${options.callbackUrl}${path}`, {
        method: 'POST', headers: { 'X-Probe-Controller-Token': controllerToken },
      });
      const body = await response.json();
      assert(response.ok && body.destroyed === true && body.containerId === containerId,
        'fixture-owned native Container destroy was not acknowledged');
      acknowledgements.push({ status: response.status, containerId: body.containerId });
      }
      return { status: 200, acknowledgements };
    };
    const ready = await mf.ready;
    // For a non-loopback bind, Miniflare.ready identifies its separate local
    // dispatch socket. Verify the configured public fixture socket directly.
    const listenerCheck = await fetch(`${options.callbackUrl}/__probe/identity`, {
      headers: { 'X-Probe-Controller-Token': controllerToken }, signal: AbortSignal.timeout(5_000),
    });
    assert(listenerCheck.ok, 'configured Docker callback listener is not reachable');
    const listenerIdentity = await listenerCheck.json();
    assert(listenerIdentity.runId === run.runId && listenerIdentity.containerId === run.containerId,
      'configured callback socket belongs to another fixture');
    stages.push({ stage: 'fixture-listener-verified', at: new Date().toISOString(),
      callbackUrl: options.callbackUrl, internalDispatchUrl: ready.toString() });
    const request = (path) => [`${options.callbackUrl}${path}`, {
      headers: { 'X-Probe-Controller-Token': controllerToken },
    }];
    const ledger = await schemaReady(mf, request, before.migrations);
    stages.push({ stage: 'native-full-schema-ready', at: new Date().toISOString(), applied: ledger.length });
    const db = await mf.getD1Database('DB');
    const authority = await seed(db, run, new Date().toISOString());
    assert(/^ga_run_usage_fence_[a-f0-9]{32}$/u.test(run.usageTrigger) && /^run_[a-f0-9-]{36}$/u.test(run.runId), 'invalid own fixture trigger identity');
    await db.prepare(`CREATE TRIGGER ${run.usageTrigger} BEFORE INSERT ON app_usage_events
      WHEN NEW.reference_id='${run.runId}' AND NEW.reference_type='run' BEGIN SELECT RAISE(ABORT, 'GA_FIRST_USAGE_FENCED'); END`).run();
    const fence = await db.prepare('SELECT name,sql FROM sqlite_master WHERE type=? AND name=?').bind('trigger', run.usageTrigger).first();
    assert(fence?.name === run.usageTrigger && fence.sql.includes(run.runId), 'run-scoped native usage fence not installed');
    stages.push({ stage: 'exact-owner-seeded-and-native-first-writer-fence-installed', at: new Date().toISOString(), trigger: run.usageTrigger });
    const identityResponse = await mf.dispatchFetch(...request('/__probe/identity'));
    assert(identityResponse.ok, 'owned Container identity readback failed');
    const containerWitness = await identityResponse.json();
    assert(containerWitness.runId === run.runId && containerWitness.containerId === run.containerId &&
      /^[a-f0-9]{64}$/u.test(containerWitness.durableObjectId), 'invalid native DO identity witness');
    await writeFile(join(options.outputDir, 'container-witness.json'), JSON.stringify({
      ...containerWitness, imageTag: options.image, dockerImageId: before.identity.dockerImageId,
    }, null, 2));
    const dispatchPayload = {
      runId: run.runId, serviceId: run.serviceId, workerId: run.serviceId,
      leaseVersion: 7, executorTier: 1, executorContainerId: run.containerId,
      model: 'gpt-local', checkpointProtocolVersion: 2,
    };
    const dispatch = await mf.dispatchFetch(`${options.callbackUrl}/__probe/dispatch`, {
      method: 'POST', headers: { 'X-Probe-Controller-Token': controllerToken,
        'Content-Type': 'application/json' }, body: JSON.stringify(dispatchPayload),
    });
    const dispatchBody = await dispatch.text();
    assert(dispatch.ok, `production /dispatch did not accept Container /start: HTTP ${dispatch.status}; body omitted to avoid logging a credential`);
    assert(dispatch.headers.get('X-Takos-Executor-Container-Id') === run.containerId,
      'production dispatch receipt differs from the intended Container identity');
    const accepted = record(JSON.parse(dispatchBody), 'compiled Container /start acknowledgement');
    assert(accepted.accepted === true && accepted.runId === run.runId &&
      accepted.runtimeProtocolVersion === 2, 'Container /start response is not accepted protocol v2');
    const dockerIds = (await command('docker', ['container', 'ls', '-aq', '--no-trunc',
      '--filter', `ancestor=${options.image}`, '--filter', 'status=running'])).stdout.trim().split('\n').filter(Boolean);
    assert(dockerIds.length === 1, 'first admission did not leave exactly one owned-image Container');
    const actualContainers = JSON.parse((await command('docker', ['container', 'inspect', ...dockerIds])).stdout);
    containerWitness.dockerContainers = actualContainers.map((item) => ({
      id: item.Id, name: item.Name, imageId: item.Image, imageReference: item.Config.Image,
      running: item.State.Running, labels: item.Config.Labels,
    }));
    await writeFile(join(options.outputDir, 'container-witness.json'), JSON.stringify({
      ...containerWitness, imageTag: options.image, dockerImageId: before.identity.dockerImageId,
    }, null, 2));
    const admissionDeadline = Date.now() + phaseMs;
    activeContainerWitness = { ...containerWitness, imageTag: options.image, dockerImageId: before.identity.dockerImageId };
    if (options.diagnosticContainerTransport) transportLogCaptures.push(await captureNativeContainerTransportLogs({
      witness: activeContainerWitness, beforeIds: new Set(options.containersBefore), agentImage: options.image,
      agentImageId: before.identity.dockerImageId, outputDir: options.outputDir, phase: 'initial-admission',
      since: new Date(started).toISOString(), command: logCommand,
    }));
    const observationResult = await waitForObservation(mf, request, admissionDeadline);
    const observation = record(observationResult.observation, 'canonical callback observation');
    assert(observation.path === '/api/internal/v1/agent-control/run-bootstrap' &&
      observation.method === 'POST' && observation.status === 200 &&
      observation.runId === run.runId && observation.containerId === run.containerId &&
      observation.tokenPresented === true,
    `compiled agent did not receive successful public Worker token-guarded bootstrap: ${JSON.stringify(observation)}`);
    // A snapshot may precede the first DEBUG line. Observe the existing
    // bootstrap response first, then allow one causal same-ID snapshot.
    if (options.diagnosticContainerTransport && transportLogCaptures[0].debugLines === 0) {
      assert(Date.now() < admissionDeadline, 'bootstrap log follow-up exceeded admission deadline');
      transportLogCaptures.push(await captureNativeContainerTransportLogs({
        witness: activeContainerWitness, beforeIds: new Set(options.containersBefore), agentImage: options.image,
        agentImageId: before.identity.dockerImageId, outputDir: options.outputDir, phase: 'initial-bootstrap',
        since: new Date(started).toISOString(), command: logCommand, requireDebug: true,
      }));
      assert(Date.now() < admissionDeadline, 'bootstrap log follow-up exceeded admission deadline');
    }
    const wrongToken = await mf.dispatchFetch(`${options.callbackUrl}/api/internal/v1/agent-control/run-bootstrap`, {
      method: 'POST', headers: { Authorization: `Bearer ${randomUUID()}`,
        'X-Takos-Run-Id': run.runId, 'X-Takos-Executor-Tier': '1',
        'X-Takos-Executor-Container-Id': run.containerId,
        'Content-Type': 'application/json' }, body: JSON.stringify({ runId: run.runId }),
    });
    assert(wrongToken.status === 401, `public Worker route accepted an unissued bearer: HTTP ${wrongToken.status}`);
    const runReadback = await db.prepare(`SELECT id,status,service_id,lease_version,account_id,requester_account_id
      FROM runs WHERE id=?`).bind(run.runId).first();
    assert(runReadback?.id === run.runId && runReadback.service_id === run.serviceId &&
      runReadback.lease_version === 7 && runReadback.account_id === run.workspaceId &&
      runReadback.requester_account_id === run.ownerId,
    'native D1 Run identity or lease changed before admission readback');
    stages.push({ stage: 'old-tool-ACK-loss-wait-start', at: new Date().toISOString(), budgetMs: phaseMs });
    const oldDeathMarker = await runtimeObserver.waitFor({ kind: 'stage', containerId: run.containerId,
      stage: 'old-container-destroyed-before-tool-ack' }, Date.now() + phaseMs);
    const allAfterDeath = (await command('docker', ['container', 'ls', '-aq', '--no-trunc'])).stdout.trim().split('\n');
    assert(containerWitness.dockerContainers.every((item) => !allAfterDeath.includes(item.id)),
      'native destroy marker did not physically remove the exact old agent before canonical stale recovery');
    const oldPhysicalDeath = { acknowledged: true, agentIdsAbsent: containerWitness.dockerContainers.map((item) => item.id),
      at: new Date().toISOString(), marker: oldDeathMarker };
    await writeFile(join(options.outputDir, 'old-container-pre-ACK-death.json'), JSON.stringify(oldPhysicalDeath, null, 2));
    const claimDeadline = Date.now() + phaseMs;
    stages.push({ stage: 'canonical-stale-recovery-wait-start', at: new Date().toISOString(), budgetMs: phaseMs });
    const agedResponse = await mf.dispatchFetch(`${options.callbackUrl}/__probe/age-recovery`, {
      method: 'POST', headers: { 'X-Probe-Controller-Token': controllerToken }, signal: AbortSignal.timeout(10_000),
    });
    assert(agedResponse.ok, 'exact fixture heartbeat ageing failed');
    const aged = record(await agedResponse.json(), 'stale eligibility fixture');
    assert(aged.before?.status === 'running' && aged.before.service_id === run.serviceId &&
      aged.before.lease_version === 7 && aged.after?.status === 'running' &&
      aged.after.service_id === run.serviceId && aged.after.lease_version === 7 &&
      Date.parse(aged.after.service_heartbeat) < Date.now() - 5 * 60 * 1000,
      'heartbeat fixture changed lease ownership or did not establish stale eligibility');
    for (const key of Object.keys(aged.before)) if (key !== 'service_heartbeat')
      assert(JSON.stringify(aged.before[key]) === JSON.stringify(aged.after[key]),
        `heartbeat fixture changed unrelated Run field ${key}`);
    const nativeWorker = await mf.getWorker();
    assert(Date.now() < claimDeadline, 'canonical recovery phase expired before scheduled entry');
    let scheduledTimer;
    let scheduledOutcome;
    try {
      scheduledOutcome = await Promise.race([
        nativeWorker.scheduled({ cron: '* * * * *', scheduledTime: new Date() }),
        new Promise((_, reject) => {
          scheduledTimer = setTimeout(() => reject(new Error('canonical scheduled recovery phase deadline expired')),
            Math.max(1, claimDeadline - Date.now()));
        }),
      ]);
    } finally { clearTimeout(scheduledTimer); }
    assert(scheduledOutcome?.outcome === 'ok', 'actual canonical scheduled invocation failed');
    const readCanonical = async () => {
      const response = await mf.dispatchFetch(...request('/__probe/canonical-recovery'));
      assert(response.ok, 'canonical recovery readback failed');
      return record(await response.json(), 'canonical recovery evidence');
    };
    let canonical;
    do {
      canonical = await readCanonical();
      assert(canonical.backgroundErrors === 0, 'canonical background invocation failed');
      if (canonical.hostDispatches?.[0]?.response && canonical.acknowledgements?.some((item) =>
        item.runId === run.runId && item.action === 'ack')) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    } while (Date.now() < claimDeadline);
    assert(Date.now() < claimDeadline, 'canonical Queue recovery exceeded its original phase deadline');
    assert(canonical.hostDispatches?.length === 1 && canonical.emitted?.length === 1 &&
      canonical.acknowledgements?.length === 1 && canonical.acknowledgements[0].action === 'ack',
      'native Queue did not acknowledge one canonical Host dispatch within its phase budget');
    const canonicalDispatch = canonical.hostDispatches[0];
    const claimed = canonicalDispatch.beforeHost?.run;
    const queueMessage = canonical.emitted[0];
    run.newServiceId = canonicalDispatch.request?.serviceId;
    assert(typeof run.newServiceId === 'string' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(run.newServiceId) &&
      run.newServiceId !== run.serviceId && canonicalDispatch.request.workerId === run.newServiceId &&
      canonicalDispatch.request.runId === run.runId && canonicalDispatch.request.leaseVersion === 8 &&
      canonicalDispatch.request.model === 'gpt-local' &&
      Object.keys(canonicalDispatch.request).sort().join(',') === 'leaseVersion,model,runId,serviceId,workerId',
      'replacement identity was not the unchanged canonical Queue payload');
    assert(queueMessage.accepted === true && queueMessage.body.version === 2 && queueMessage.body.runId === run.runId &&
      queueMessage.body.model === 'gpt-local' && queueMessage.beforeQueueSend.run.status === 'queued' &&
      queueMessage.beforeQueueSend.run.service_id === null && queueMessage.beforeQueueSend.run.lease_version === 7 &&
      claimed?.status === 'running' && claimed.service_id === run.newServiceId && claimed.lease_version === 8 &&
      claimed.account_id === run.workspaceId && claimed.requester_account_id === run.ownerId &&
      claimed.thread_id === run.threadId && claimed.engine_checkpoint === aged.before.engine_checkpoint,
      'scheduled reset and Queue claim do not preserve the original private checkpoint/authority');
    const replacementDispatch = canonicalDispatch.response;
    const newAccepted = record(replacementDispatch?.body, 'canonical Host replacement acceptance');
    assert(replacementDispatch.status >= 200 && replacementDispatch.status < 300 &&
      replacementDispatch.containerReceipt === run.newContainerId && newAccepted.accepted === true &&
      newAccepted.runId === run.runId && newAccepted.runtimeProtocolVersion === 2,
      'native Queue replacement lacks actual Host receipt and protocol2 acceptance');
    assert(canonical.state.receipts.length === 1, 'canonical Queue did not persist its dispatch receipt');
    const receipt = canonical.state.receipts[0];
    const receiptData = JSON.parse(receipt.data);
    assert(receipt.type === 'executor_dispatch_receipt' &&
      receipt.event_key === `executor-dispatch:${run.runId}:lease:8:service:${run.newServiceId}` &&
      receiptData.service_id === run.newServiceId && receiptData.lease_version === 8 &&
      receiptData.executor_container_id === run.newContainerId,
      'native SQL dispatch receipt does not join the canonical lease and actual Host slot');
    await writeFile(join(options.outputDir, 'canonical-recovery.json'),
      JSON.stringify({ aged, scheduledOutcome, canonical }, null, 2));
    const staleStatuses = [];
    for (let index = 0; index < 2; index++) {
      const stale = await mf.dispatchFetch(`${options.callbackUrl}/__probe/old-token-probe`, {
        method: 'POST', headers: { 'X-Probe-Controller-Token': controllerToken }, signal: AbortSignal.timeout(10_000),
      });
      assert(stale.ok, 'fixed old bearer public-route probe failed');
      staleStatuses.push(await stale.json());
    }
    assert((staleStatuses[0].status === 409 && staleStatuses[0].leaseLost === true || staleStatuses[0].status === 401) &&
      staleStatuses[1].status === 401, 'native old minted token was not fenced/revoked after canonical Queue claim');
    const newIdentityResponse = await mf.dispatchFetch(...request('/__probe/identity-new'));
    assert(newIdentityResponse.ok, 'replacement native identity readback failed');
    const replacementContainerWitness = await newIdentityResponse.json();
    assert(replacementContainerWitness.runId === run.runId && replacementContainerWitness.containerId === run.newContainerId &&
      /^[a-f0-9]{64}$/u.test(replacementContainerWitness.durableObjectId) &&
      replacementContainerWitness.durableObjectId !== containerWitness.durableObjectId, 'replacement DO is not distinct and exact');
    await writeFile(join(options.outputDir, 'replacement-container-witness.json'), JSON.stringify({
      ...replacementContainerWitness, imageTag: options.image, dockerImageId: before.identity.dockerImageId,
    }, null, 2));
    const newDockerIds = (await command('docker', ['container','ls','-aq','--no-trunc',
      '--filter', `ancestor=${options.image}`, '--filter', 'status=running'])).stdout.trim().split('\n').filter(Boolean);
    assert(newDockerIds.length === 1, 'replacement left an unexpected number of running image Containers');
    const newDocker = JSON.parse((await command('docker', ['container','inspect', ...newDockerIds])).stdout);
    replacementContainerWitness.dockerContainers = newDocker.map((item) => ({ id: item.Id, name: item.Name,
      imageId: item.Image, imageReference: item.Config.Image, running: item.State.Running, labels: item.Config.Labels }));
    const expectedDockerName = '/workerd-canonical-container-' + run.runId + '-ExecutorContainerTier1-';
    for (const witness of [containerWitness, replacementContainerWitness]) assert(witness.dockerContainers.length === 1 &&
      witness.dockerContainers.every((item) => item.name === expectedDockerName + witness.durableObjectId &&
        item.imageId === before.identity.dockerImageId && item.imageReference === options.image),
      'a native DO does not match its exact physical Docker name/image/reference');
    assert(newDockerIds[0] !== containerWitness.dockerContainers[0].id, 'replacement reused the old physical agent');
    await writeFile(join(options.outputDir, 'replacement-container-witness.json'), JSON.stringify({
      ...replacementContainerWitness, imageTag: options.image, dockerImageId: before.identity.dockerImageId,
    }, null, 2));
    const terminalDeadline = Date.now() + completionPhaseMs;
    activeContainerWitness = { ...replacementContainerWitness, imageTag: options.image, dockerImageId: before.identity.dockerImageId };
    if (options.diagnosticContainerTransport) transportLogCaptures.push(await captureNativeContainerTransportLogs({
      witness: activeContainerWitness, beforeIds: new Set(options.containersBefore), agentImage: options.image,
      agentImageId: before.identity.dockerImageId, outputDir: options.outputDir, phase: 'replacement-admission',
      since: new Date(started).toISOString(), command: logCommand,
    }));
    stages.push({ stage: 'replacement-checkpoint-terminal-wait-start', at: new Date().toISOString(), budgetMs: completionPhaseMs });
    const nativeTerminalResponse = await runtimeObserver.waitFor({ kind: 'control', containerId: run.newContainerId,
      path: '/api/internal/v1/agent-control/complete-run', status: 200 }, terminalDeadline);
    assert(nativeTerminalResponse.runId === run.runId, 'replacement terminal belongs to another Run');
    if (options.diagnosticContainerTransport &&
      transportLogCaptures.find((value) => value.phase === 'replacement-admission').debugLines === 0)
      transportLogCaptures.push(await captureNativeContainerTransportLogs({
        witness: activeContainerWitness, beforeIds: new Set(options.containersBefore), agentImage: options.image,
        agentImageId: before.identity.dockerImageId, outputDir: options.outputDir, phase: 'replacement-terminal',
        since: new Date(started).toISOString(), command: logCommand, requireDebug: true,
      }));

    // One authenticated read after the real response. Logs are a wake-up only;
    // this full trace and authoritative SQL retain every original assertion.
    const observationResponse = await mf.dispatchFetch(...request('/__probe/observation'));
    assert(observationResponse.ok, 'post-terminal production trace readback failed');
    const observed = record(await observationResponse.json(), 'post-terminal production trace');
    await writeFile(join(options.outputDir, 'completion-runtime-responses.json'),
      JSON.stringify(runtimeObserver.snapshot(), null, 2));
    await writeFile(join(options.outputDir, 'completion-observation-attempts.json'),
      JSON.stringify(completionObservationAttempts, null, 2));
    // The ACK is only a wait condition. Actual native SQL must independently
    // prove terminal status, lease, transcript, operation and usage witness.
    const completed = await db.prepare(`SELECT id,status,usage,service_id,lease_version,
      account_id,requester_account_id,engine_checkpoint,completion_key,
      transcript_sequence_start FROM runs WHERE id=?`).bind(run.runId).first();
    assert(completed?.id === run.runId && completed.status === 'completed',
      `public complete-run ACK did not commit this Run as completed: ${completed?.status ?? 'missing'}`);
    stages.push({ stage: 'native-terminal-ack-and-SQL-confirmed', at: new Date().toISOString(),
      budgetMs: completionPhaseMs });
    const trace = observed.controlTrace;
    const modelInputs = observed.modelInputs;
    assert(Array.isArray(trace) && Array.isArray(modelInputs) && modelInputs.length === 2,
      'compiled Container did not make exactly two deterministic model calls');
    const acceptedPath = (name) => trace.some((entry) =>
      entry.path === `/api/internal/v1/agent-control/${name}` &&
      entry.status === 200 && entry.containerId === run.newContainerId &&
      entry.tokenPresented === true);
    for (const name of ['run-bootstrap', 'run-config', 'tool-catalog', 'api-keys',
      'engine-checkpoint-load', 'engine-checkpoint-save', 'tool-execute', 'complete-run'])
      assert(acceptedPath(name), `compiled Container never completed token-guarded ${name}`);
    assert(Array.isArray(observed.toolCatalog?.tools) && observed.toolCatalog.tools.some((tool) =>
      tool.name === 'create_artifact' && tool.side_effects === true &&
      tool.durable_idempotency === true),
    'production ToolExecutor catalog did not attest durable create_artifact');
    assert(modelInputs[0]?.model === 'gpt-local' && modelInputs[1]?.model === 'gpt-local' &&
      Array.isArray(modelInputs[0]?.tools) && modelInputs[0].tools.includes('create_artifact') &&
      modelInputs[1].messages.some((message) => message.role === 'assistant' &&
        message.toolCalls.some((call) => call.id === 'call-recovery-1')) &&
      modelInputs[1].messages.some((message) => message.role === 'tool' &&
        message.toolCallId === 'call-recovery-1'),
    'second native model request did not preserve the correlated tool transcript');
    const recovery = record(observed.recovery, 'actual native recovery trace');
    assert(recovery.stage === 'old-container-destroyed-before-tool-ack' && recovery.nativeDestroyAcknowledged === true &&
      recovery.successResponseForwarded === false && recovery.modelCallsAtDeath === 1 && recovery.reclaimed === true &&
      recovery.replacementCheckpointLoad?.status === 200 && recovery.replacementCheckpointLoad.fatalError === null &&
      recovery.replacementCheckpointLoad.node === 'execute_tools' &&
      recovery.replacementCheckpointLoad.loopId === recovery.checkpoint.loopId &&
      recovery.replacementCheckpointLoad.pendingToolCallIds.length === 1 &&
      recovery.replacementCheckpointLoad.pendingToolCallIds[0] === 'call-recovery-1' &&
      recovery.replacementCheckpointSaves.length > 0 && recovery.replacementCheckpointSaves.every((item) => item.loopId === recovery.checkpoint.loopId) &&
      recovery.toolAttempts.length === 2 && recovery.toolAttempts[0].containerId === run.containerId &&
      recovery.toolAttempts[1].containerId === run.newContainerId && recovery.toolAttempts.every((item) =>
        item.status === 200 && item.operationKey === recovery.operationKey && item.responseSha256 === recovery.toolResponseSha256),
      'native replacement did not resume the pending checkpoint and exact original cached operation');
    const usage = record(JSON.parse(completed.usage), 'native terminal usage');
    assert(usage.inputTokens === 24 && usage.outputTokens === 8 &&
      usage.cacheReadTokens === 3 && completed.service_id === run.newServiceId &&
      completed.lease_version === 8 && completed.account_id === run.workspaceId &&
      completed.requester_account_id === run.ownerId &&
      completed.engine_checkpoint === null &&
      typeof completed.completion_key === 'string' && completed.completion_key.length > 0 &&
      completed.transcript_sequence_start === 1,
    'atomic native terminal Run did not preserve owner, lease, usage and transcript reservation');
    const beforeDuplicate = await readCanonical();
    const duplicateResponse = await mf.dispatchFetch(`${options.callbackUrl}/__probe/duplicate-recovery`, {
      method: 'POST', headers: { 'X-Probe-Controller-Token': controllerToken }, signal: AbortSignal.timeout(10_000),
    });
    const duplicateAccepted = await duplicateResponse.json();
    assert(duplicateResponse.ok && duplicateAccepted.accepted === true && duplicateAccepted.runId === run.runId,
      'native duplicate delivery was not enqueued for the exact terminal Run');
    const duplicateDeadline = Date.now() + 10_000;
    let afterDuplicate;
    do {
      afterDuplicate = await readCanonical();
      assert(afterDuplicate.backgroundErrors === 0, 'duplicate native Queue invocation failed');
      if (afterDuplicate.acknowledgements?.length === 2 && afterDuplicate.backgroundActive === 0) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    } while (Date.now() < duplicateDeadline);
    assert(afterDuplicate.acknowledgements?.length === 2 &&
      afterDuplicate.acknowledgements.every((item) => item.runId === run.runId && item.action === 'ack' && item.attempts === 1) &&
      new Set(afterDuplicate.acknowledgements.map((item) => item.messageId)).size === 2 &&
      afterDuplicate.emitted.length === 2 &&
      afterDuplicate.emitted.every((item) => item.accepted === true) &&
      JSON.stringify(afterDuplicate.emitted[0].body) === JSON.stringify(afterDuplicate.emitted[1].body) &&
      afterDuplicate.hostDispatches.length === 1 && afterDuplicate.executorHostActive === 0 &&
      afterDuplicate.backgroundActive === 0 &&
      JSON.stringify(afterDuplicate.state) === JSON.stringify(beforeDuplicate.state),
      'duplicate native Queue mutated terminal state, receipt or original operation');
    const duplicateRecovery = { accepted: duplicateAccepted, before: beforeDuplicate, after: afterDuplicate };
    await writeFile(join(options.outputDir, 'canonical-duplicate-recovery.json'), JSON.stringify(duplicateRecovery, null, 2));
    const artifacts = (await db.prepare(`SELECT id,run_id,account_id,type,title,content
      FROM artifacts WHERE run_id=?`).bind(run.runId).all()).results;
    const operations = (await db.prepare(`SELECT id,run_id,operation_key,tool_name,status
      FROM tool_operations WHERE run_id=?`).bind(run.runId).all()).results;
    const messages = (await db.prepare(`SELECT id,thread_id,role,content,tool_call_id,
      tool_calls,sequence FROM messages WHERE thread_id=? ORDER BY sequence`)
      .bind(run.threadId).all()).results;
    const events = (await db.prepare(`SELECT id,run_id,type,event_key
      FROM run_events WHERE run_id=? ORDER BY id`).bind(run.runId).all()).results;
    const thread = await db.prepare(`SELECT next_message_sequence FROM threads WHERE id=?`)
      .bind(run.threadId).first();
    const queuedWitnesses = (await db.prepare(`SELECT id,run_id,completion_key,run_status,
      workspace_id,owner_account_id,delivery_status,attempts,projected_revision
      FROM run_usage_projection_outbox WHERE run_id=?`).bind(run.runId).all()).results;
    assert(artifacts.length === 1 && artifacts[0].run_id === run.runId &&
      artifacts[0].account_id === run.workspaceId && artifacts[0].title === 'recovery-proof' &&
      artifacts[0].content === 'local fixture' &&
      operations.length === 1 && operations[0].run_id === run.runId &&
      operations[0].tool_name === 'create_artifact' && operations[0].status === 'completed' &&
      typeof operations[0].operation_key === 'string' && operations[0].operation_key.length > 0 && operations[0].operation_key === recovery.operationKey,
    'native ToolExecutor did not commit exactly one artifact and durable operation');
    assert(messages.length === 4 && messages.every((message, index) =>
      message.sequence === index && message.thread_id === run.threadId) &&
      messages[0].role === 'user' &&
      messages.some((message) => message.role === 'tool' &&
        message.tool_call_id === 'call-recovery-1') &&
      messages.some((message) => message.role === 'assistant' &&
        message.content === 'recovered answer') &&
      thread?.next_message_sequence === 4 &&
      events.filter((event) => event.type === 'completed').length === 1,
    'native complete-run transcript, event or thread sequence allocation is incomplete');
    assert(queuedWitnesses.length === 1 &&
      queuedWitnesses[0].id === `run-usage-projection:${completed.completion_key}` &&
      queuedWitnesses[0].completion_key === completed.completion_key &&
      queuedWitnesses[0].run_id === run.runId &&
      queuedWitnesses[0].run_status === 'completed' &&
      queuedWitnesses[0].workspace_id === run.workspaceId &&
      queuedWitnesses[0].owner_account_id === run.ownerId &&
      queuedWitnesses[0].delivery_status === 'queued' &&
      queuedWitnesses[0].attempts === 0 &&
      queuedWitnesses[0].projected_revision === null,
    'atomic native completion did not leave exactly one immutable owner-bound usage witness');
    const firstUsage = await proveFirstProjector({ mf, db, run, controllerToken, observerNonce,
      options, stages, containerWitness, replacementContainerWitness, completed,
      queuedWitness: queuedWitnesses[0], projectorObserver });
    const { projectionBody, doneWitness, meters, rollups } = firstUsage;
    const expectedMeters = { llm_tokens_input: 0.024, llm_tokens_output: 0.008 };
    assert(doneWitness?.id === queuedWitnesses[0].id &&
      doneWitness.completion_key === completed.completion_key &&
      doneWitness.run_status === 'completed' &&
      doneWitness.workspace_id === run.workspaceId &&
      doneWitness.owner_account_id === run.ownerId &&
      doneWitness.delivery_status === 'done' && doneWitness.attempts === 2 &&
      Number.isSafeInteger(doneWitness.projected_revision) &&
      doneWitness.projected_revision > 0 && meters.length === 2 && rollups.length === 2,
    'native usage dispatch did not project exactly two owner-bound canonical meters');
    for (const meter of meters) {
      assert(expectedMeters[meter.meter_type] === meter.units &&
        meter.idempotency_key === `run:${run.runId}:${meter.meter_type}` &&
        meter.owner_account_id === run.ownerId && meter.scope_type === 'space' &&
        meter.space_id === run.workspaceId && meter.reference_id === run.runId &&
        meter.reference_type === 'run' && Number.isFinite(Date.parse(meter.created_at)),
      `malformed native canonical meter ${meter.meter_type}`);
      const rollup = rollups.find((row) => row.meter_type === meter.meter_type);
      assert(rollup && rollup.owner_account_id === run.ownerId &&
        rollup.scope_type === 'space' && rollup.scope_id === run.workspaceId &&
        rollup.space_id === run.workspaceId && rollup.units === meter.units &&
        rollup.period_start === `${meter.created_at.slice(0, 7)}-01` &&
        Number.isFinite(Date.parse(rollup.updated_at)),
      `malformed native canonical rollup ${meter.meter_type}`);
    }
    stages.push({ stage: 'normal-native-run-and-usage-completed', at: new Date().toISOString(),
      modelCalls: modelInputs.length, controlRpcs: trace.length,
      usageRevision: doneWitness.projected_revision });
    const after = await snapshot(options.root, before.paths);
    assert(JSON.stringify(after) === JSON.stringify(before.sourcesBefore),
      'production source or migration bytes changed during probe');
    for (const [path, hash] of Object.entries(after))
      assert(Object.hasOwn(options.sourceHashesBefore, path) &&
        options.sourceHashesBefore[path] === hash,
      `final proof source differs from parent snapshot: ${path}`);
    const parentSourceSnapshotAfter = await verifyParentSourceSnapshot(
      options.root, options.sourceHashesBefore);
    assert(parentSourceSnapshotAfter.sha256 === before.parentSourceSnapshot.sha256 &&
      parentSourceSnapshotAfter.fileCount === before.parentSourceSnapshot.fileCount,
    'full parent source snapshot changed during proof');
    const finalHeadCommit = (await command('git', ['rev-parse', 'HEAD'])).stdout.trim();
    const finalDirtyStatus = (await command('git', ['status', '--porcelain=v1', '--untracked-files=all'])).stdout;
    assert(finalHeadCommit === before.sourceState.headCommit &&
      finalDirtyStatus === before.sourceState.dirtyStatus,
    'actual source commit or dirty work changed during probe');
    const inputAfter = {};
    for (const [path, value] of Object.entries(built.inputHashes))
      inputAfter[path] = { ...value, sha256: await fileSha(value.resolvedPath) };
    assert(JSON.stringify(inputAfter) === JSON.stringify(built.inputHashes),
      'bundle input bytes changed during probe');
    const bundleSha256After = await fileSha(built.bundlePath);
    assert(bundleSha256After === built.bundleSha256,
      'generated Worker bundle bytes changed during probe');
    const result = {
      status: 'passed', result: 'LOCAL_CANONICAL_QUEUE_CONTAINER_FIRST_PROJECTOR_LOST_ACK_COLD_RETRY_PROBE_OK',
      limitation: 'Local native D1/DO/R2, canonical scheduled/native Queue and real executor Host Service Binding with two actual compiled Containers and a deterministic local model. The fixture ages only the destroyed old executor heartbeat; no actual five-minute outage, whole workerd restart, hosted lifecycle, real Accounts/model or deployed image identity claim.',
      startedAt: new Date(started).toISOString(), elapsedMs: Date.now() - started,
      sourceCommit: finalHeadCommit,
      diagnosticContainerTransport: options.diagnosticContainerTransport, transportLogCaptures,
      sourceState: before.sourceState, sourceHashesBefore: before.sourcesBefore,
      sourceHashesAfter: after,
      parentSourceSnapshot: { before: before.parentSourceSnapshot,
        after: parentSourceSnapshotAfter },
      image: before.identity, compatibility: { ...built.compatibility, flags: nativeFlags, configuredFlags: built.compatibility.flags },
      miniflareVersion: (await readJson(resolve(options.root, 'node_modules/miniflare/package.json'))).version,
      workerdVersion: (await readJson(resolve(dirname(actualWorkerdModule), '../package.json'))).version,
      workerdModulePath: actualWorkerdModule,
      bundle: { path: built.bundlePath, sha256Before: built.bundleSha256,
        sha256After: bundleSha256After, sha256: built.bundleSha256,
        bunVersion: built.bunVersion, inputsBefore: built.inputHashes,
        inputsAfter: inputAfter },
      migrationLedger: ledger, authority, run: completed,
      dispatch: { status: dispatch.status, body: accepted,
        containerReceipt: dispatch.headers.get('X-Takos-Executor-Container-Id') },
      publicCallback: observation, rejectedWrongBearerStatus: wrongToken.status,
      modelInputs, controlTrace: trace, toolCatalog: observed.toolCatalog,
      artifacts, operations, messages, events, thread,
      usageProjection: { firstWitness: queuedWitnesses[0], dispatchCompleted: projectionBody.completed,
        doneWitness, meters, rollups, firstProjector: firstUsage.record },
      containerWitness, replacementContainerWitness,
      recovery: { ...recovery, oldPhysicalDeath, staleStatuses, aged, scheduledOutcome, canonical, duplicateRecovery,
        replacementDispatch },
      stages,
    };
    successResult = result;
  } catch (error) {
    failure = error;
    if (runtimeObserver) await writeFile(join(options.outputDir, 'completion-runtime-responses.json'),
      JSON.stringify(runtimeObserver.snapshot(), null, 2));
    await writeFile(join(options.outputDir, 'completion-observation-attempts.json'),
      JSON.stringify(completionObservationAttempts, null, 2));
    // Diagnostic observations happen before native destruction and do not
    // replace the failed assertion or alter the Run/lease/schema/model paths.
    if (mf) {
      try {
        // Snapshot only the most recently witnessed live agent, before cleanup.
        // The old executor is intentionally removed during the recovery scenario.
        const witness = activeContainerWitness ?? await readJson(join(options.outputDir, 'container-witness.json'));
        transportLogCaptures.push(await captureNativeContainerTransportLogs({
          witness, beforeIds: new Set(options.containersBefore), agentImage: options.image,
          agentImageId: options.dockerImageId, outputDir: options.outputDir, phase: 'failure',
          since: new Date(started).toISOString(), command: logCommand,
        }));
      } catch (diagnosticError) {
        await writeFile(join(options.outputDir, 'failure-agent-logs-error.json'),
          JSON.stringify({ error: String(diagnosticError), transportLogCaptures }, null, 2), { flag: 'wx', mode: 0o600 });
      }
      try {
        const observed = await mf.dispatchFetch(`${options.callbackUrl}/__probe/observation`, {
          headers: { 'X-Probe-Controller-Token': diagnosticControllerToken },
          signal: AbortSignal.timeout(5_000),
        });
        await writeFile(join(options.outputDir, 'failure-observation.json'), JSON.stringify({
          status: observed.status, body: await observed.json(),
        }, null, 2));
      } catch (diagnosticError) {
        await writeFile(join(options.outputDir, 'failure-observation-error.json'),
          JSON.stringify({ error: String(diagnosticError) }, null, 2));
      }
    }
    await writeFile(join(options.outputDir, 'failure.json'), `${JSON.stringify({
      status: 'failed', at: new Date().toISOString(), elapsedMs: Date.now() - started,
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack,
        cause: error.cause instanceof Error ? error.cause.message : String(error.cause ?? '') } : String(error),
      diagnosticContainerTransport: options.diagnosticContainerTransport, transportLogCaptures,
      stages, outputDir: options.outputDir,
    }, null, 2)}\n`);
  } finally {
    if (mf) {
      if (destroyOwnedContainer) {
        let cleanupTimer;
        try {
          const ack = await Promise.race([destroyOwnedContainer(), new Promise((_, reject) => {
            cleanupTimer = setTimeout(() => reject(new Error('owned native two-Container destruction exceeded 30s')), 30_000);
          })]);
          await writeFile(join(options.outputDir, 'native-container-cleanup.json'), JSON.stringify({
            status: 'acknowledged', at: new Date().toISOString(),
            httpStatus: ack.status, acknowledgements: ack.acknowledgements,
          }, null, 2));
        } catch (error) {
          failure ??= new Error(`owned native Container destroy failed: ${String(error)}`);
          await writeFile(join(options.outputDir, 'native-container-cleanup.json'), JSON.stringify({
            status: 'failed', at: new Date().toISOString(), error: String(error),
          }, null, 2));
        } finally {
          if (cleanupTimer) clearTimeout(cleanupTimer);
        }
      }
      try { await mf.dispose(); }
      catch (error) { failure ??= new Error(`owned Miniflare/Container disposal failed: ${String(error)}`); }
    }
    clearTimeout(watchdog);
  }
  if (failure && !(await readFile(join(options.outputDir, 'failure.json')).catch(() => null))) {
    await writeFile(join(options.outputDir, 'failure.json'), `${JSON.stringify({
      status: 'failed', at: new Date().toISOString(), error: String(failure), stages,
      outputDir: options.outputDir,
    }, null, 2)}\n`);
  }
  if (failure) throw failure;
  assert(successResult, 'probe ended without a success result');
  await writeFile(reportPath, `${JSON.stringify(successResult, null, 2)}\n`);
  // Preserve fresh native state and bundle for independent raw-result review.
  return { reportPath, result: successResult };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configPath = process.argv[2];
  if (process.argv.length !== 3 || !configPath || !isAbsolute(configPath)) {
    process.stderr.write('usage: node native-container-recovery-controller.mjs <absolute-config-json-path>\n');
    process.exitCode = 2;
  } else {
    readJson(configPath).then(runNativeContainerRecovery).then(({ reportPath, result }) => {
      process.stdout.write(`${JSON.stringify({ status: result.status,
        result: result.result, reportPath, imageId: result.image.dockerImageId,
        bundleSha256: result.bundle.sha256 })}\n`);
    }).catch((error) => {
      process.stderr.write(`native Container recovery proof failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
