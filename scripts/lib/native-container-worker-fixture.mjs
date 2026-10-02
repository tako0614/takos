import { resolve } from 'node:path';

export function createNativeContainerWorkerFixture({ root, run, controllerToken, observerNonce, diagnosticContainerTransport = false }) {
  const importPath = (path) => JSON.stringify(resolve(root, path));
  return `import webWorker, { SessionDO } from ${importPath('src/worker/web.ts')};
import production from ${importPath('src/worker/index.ts')};
import executorHostHandler${diagnosticContainerTransport ? ', { ExecutorContainerTier1 as ProductionExecutorContainerTier1 }' : ', { ExecutorContainerTier1 }'} from ${importPath('src/worker/runtime/container-hosts/executor-host.ts')};
import { WorkerEntrypoint } from 'cloudflare:workers';
import { FirstProjectorRunNotifier as RunNotifierDO } from ${importPath('scripts/lib/native-first-projector-fixture.mjs')};
import { trackNativeStateWaitUntil } from ${importPath('scripts/lib/native-owned-work-tracker.mjs')};
import { ensureSchemaReady } from ${importPath('src/worker/platform/migrations/schema-gate.ts')};
import { dispatchRunUsageProjectionOutbox } from ${importPath('src/worker/application/services/app-usage/run-projection-outbox.ts')};
import { captureCheckpointWitness, assertCheckpointUnchanged } from ${importPath('scripts/lib/native-recovery-checkpoint-witness.mjs')};
${diagnosticContainerTransport ? `export { SessionDO, RunNotifierDO };
export class ExecutorContainerTier1 extends ProductionExecutorContainerTier1 {
  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = { ...this.envVars, RUST_LOG: 'takos_agent=info,reqwest=debug,hyper_util=debug' };
  }
}` : 'export { SessionDO, ExecutorContainerTier1, RunNotifierDO };'}
const expectedRunId = ${JSON.stringify(run.runId)};
const expectedContainerId = ${JSON.stringify(run.containerId)};
const replacementContainerId = ${JSON.stringify(run.newContainerId)};
const oldServiceId = ${JSON.stringify(run.serviceId)};
const ownerId = ${JSON.stringify(run.ownerId)};
const workspaceId = ${JSON.stringify(run.workspaceId)};
const threadId = ${JSON.stringify(run.threadId)};
const checkpointExpected = { runId: expectedRunId, serviceId: oldServiceId, leaseVersion: 7,
  pendingToolCallId: 'call-recovery-1', usage: { inputTokens: 11, outputTokens: 3, cachedInputTokens: 2 } };
let firstToolSeen = false, capturedOldBearer = null, recoveryState = null;
let replacementServiceId = null;
let replacementDestroyed = false, workerPublicFetchActive = 0, usageArmRequested = false,
  afterArmControlEntries = 0, recoveryHeartbeatAged = false;
const nativeWorkerDeferred = [];
const nativeHostDeferred = [];
const nativeBackgroundDeferred = [];
const emitted = [], hostDispatches = [], acknowledgements = [];
let duplicateRecoverySent = false, backgroundActive = 0, executorHostActive = 0;
const backgroundErrors = [];
function workerProducers() {
  const snapshots = nativeWorkerDeferred.map((entry) => entry.snapshot());
  const backgroundSnapshots = [...nativeHostDeferred, ...nativeBackgroundDeferred].map((entry) => entry.snapshot());
  return { oldContainerStopped: recoveryState?.nativeDestroyAcknowledged === true,
    replacementContainerStopped: replacementDestroyed,
    publicWorkerFetchActive: workerPublicFetchActive,
    publicWorkerWaitUntilActive: snapshots.reduce((sum, value) => sum + value.active, 0),
    publicWorkerWaitUntilRejected: snapshots.reduce((sum, value) => sum + value.rejected, 0),
    publicWorkerWaitUntilSynchronousThrows: snapshots.reduce((sum, value) => sum + value.synchronousThrows, 0),
    backgroundActive, executorHostActive,
    backgroundWaitUntilActive: backgroundSnapshots.reduce((sum, value) => sum + value.active, 0),
    backgroundWaitUntilRejected: backgroundSnapshots.reduce((sum, value) => sum + value.rejected, 0),
    backgroundWaitUntilSynchronousThrows: backgroundSnapshots.reduce((sum, value) => sum + value.synchronousThrows, 0),
    backgroundErrors: backgroundErrors.length,
    backgroundErrorDetails: [...backgroundErrors],
    afterArmControlEntries };
}
async function trackedWebFetch(request, env, ctx) {
  workerPublicFetchActive++;
  try { return await webWorker.fetch(request, env, ctx); }
  finally { workerPublicFetchActive--; }
}
const recoveryToolAttempts = [], replacementCheckpointSaves = [];
function requireValue(value, detail) { if (!value) throw new Error(detail); }
function rejectLateProducerEntry(label) {
  if (!usageArmRequested) return;
  afterArmControlEntries++;
  const error = new Error('late ' + label + ' entry after first-usage arm');
  backgroundErrors.push({ handler: label, error: error.message, stack: error.stack });
  throw error;
}
async function snapshotRun(db) {
  const run = await db.prepare('SELECT * FROM runs WHERE id=?').bind(expectedRunId).first();
  const operations = (await db.prepare('SELECT * FROM tool_operations WHERE run_id=? ORDER BY id').bind(expectedRunId).all()).results;
  const receipts = (await db.prepare("SELECT * FROM run_events WHERE run_id=? AND type='executor_dispatch_receipt' ORDER BY event_key").bind(expectedRunId).all()).results;
  return { run, operations, receipts };
}
function wrappedQueue(env) {
  const original = env.RUN_QUEUE;
  return { ...env, RUN_QUEUE: Object.assign(Object.create(null), { send: async (body, options) => {
    const beforeQueueSend = await snapshotRun(env.DB);
    const item = { body: structuredClone(body), beforeQueueSend, accepted: false };
    emitted.push(item);
    try {
      const receipt = await original.send(body, options);
      item.accepted = true;
      item.acceptedAt = new Date().toISOString();
      if (receipt !== undefined) item.sendReceipt = receipt;
      return receipt;
    } catch (error) {
      item.sendError = String(error);
      throw error;
    }
  } }) };
}
function observeQueueBatch(batch) {
  const messages = batch.messages.map((message) => ({
    get body() { return message.body; },
    get id() { return message.id; },
    get timestamp() { return message.timestamp; },
    get attempts() { return message.attempts; },
    ack() {
      acknowledgements.push({ messageId: message.id, runId: message.body?.runId,
        action: 'ack', attempts: message.attempts ?? 1, options: null });
      return Reflect.apply(message.ack, message, []);
    },
    retry(options) {
      acknowledgements.push({ messageId: message.id, runId: message.body?.runId,
        action: 'retry', attempts: message.attempts ?? 1, options: options ?? null });
      return Reflect.apply(message.retry, message, [options]);
    },
  }));
  return new Proxy(batch, {
    get(target, property) {
      if (property === 'messages') return messages;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
function canonicalEvidence(env) {
  return { emitted, hostDispatches, acknowledgements, state: null,
    backgroundActive, executorHostActive, backgroundErrors: backgroundErrors.length,
    backgroundErrorDetails: [...backgroundErrors] };
}
async function withBackground(label, work) {
  backgroundActive++;
  try { return await work(); }
  catch (error) {
    backgroundErrors.push({ handler: label, error: String(error), stack: error instanceof Error ? error.stack : null });
    throw error;
  } finally { backgroundActive--; }
}
async function withTrackedBackground(label, ctx, work) {
  rejectLateProducerEntry(label);
  requireValue(nativeBackgroundDeferred.length < 512, 'owned background event counter capacity exceeded');
  const deferred = trackNativeStateWaitUntil(ctx);
  nativeBackgroundDeferred.push(deferred);
  return await withBackground(label, () => work(deferred.state));
}
async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function recoveryScalars() {
  if (!recoveryState) return null;
  return { stage: recoveryState.stage, runId: expectedRunId, oldContainerId: expectedContainerId,
    newContainerId: replacementContainerId, checkpoint: recoveryState.capture.witness,
    checkpointUpdatedAt: recoveryState.checkpointUpdatedAt,
    operationKey: recoveryState.operationKey, productionToolStatus: recoveryState.productionToolStatus,
    toolResponseSha256: recoveryState.toolResponseSha256, nativeDestroyAcknowledged: recoveryState.nativeDestroyAcknowledged,
    successResponseForwarded: false, modelCallsAtDeath: recoveryState.modelCallsAtDeath,
    replacementServiceId,
    reclaimed: recoveryState.reclaimed === true, leaseClaim: recoveryState.leaseClaim ?? null,
    replacementCheckpointLoad: recoveryState.replacementCheckpointLoad ?? null,
    toolAttempts: recoveryToolAttempts, replacementCheckpointSaves };
}
const controllerToken = ${JSON.stringify(controllerToken)};
const expectedObserverNonce = ${JSON.stringify(observerNonce)};
let controlObservation = null;
const controlTrace = [];
const controlIngress = [];
const controlErrors = [];
const modelInputs = [];
let toolCatalog = null;
function controller(request) { return request.headers.get('X-Probe-Controller-Token') === controllerToken; }
export class NativeRecoveryExecutorHost extends WorkerEntrypoint {
  async fetch(request) {
    rejectLateProducerEntry('executor host');
    executorHostActive++;
    try {
      const deferred = trackNativeStateWaitUntil(this.ctx);
      requireValue(nativeHostDeferred.length < 512, 'owned executor-host invocation counter capacity exceeded');
      nativeHostDeferred.push(deferred);
      requireValue(request.method === 'POST' && new URL(request.url).pathname === '/dispatch' &&
        request.headers.get('Content-Type') === 'application/json' &&
        request.headers.get('Authorization') === null &&
        request.headers.get('X-Takos-Executor-Tier') === null &&
        request.headers.get('X-Takos-Executor-Container-Id') === null,
      'canonical host request method, path, or headers were changed by the fixture');
      const payload = await request.clone().json();
      requireValue(payload && Object.keys(payload).sort().join(',') === 'leaseVersion,model,runId,serviceId,workerId' &&
        payload.runId === expectedRunId && payload.workerId === payload.serviceId &&
        typeof payload.serviceId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(payload.serviceId) &&
        payload.leaseVersion === 8 && payload.model === 'gpt-local',
      'canonical executor host request changed or contains fixture-only fields');
      const beforeHost = await snapshotRun(this.env.DB);
      beforeHost.artifacts = (await this.env.DB.prepare('SELECT * FROM artifacts WHERE run_id=? ORDER BY id').bind(expectedRunId).all()).results;
      const row = beforeHost.run;
      const authority = {
        owner: await this.env.DB.prepare('SELECT id,type,status,owner_account_id FROM accounts WHERE id=?').bind(ownerId).first(),
        workspace: await this.env.DB.prepare('SELECT id,type,status,owner_account_id FROM accounts WHERE id=?').bind(workspaceId).first(),
        privateSettings: await this.env.DB.prepare('SELECT account_id,private_account FROM account_settings WHERE account_id=?').bind(workspaceId).first(),
        thread: await this.env.DB.prepare('SELECT id,account_id FROM threads WHERE id=?').bind(threadId).first(),
      };
      beforeHost.authority = authority;
      requireValue(row?.status === 'running' && row.service_id === payload.serviceId && row.lease_version === 8 &&
        row.account_id === workspaceId && row.requester_account_id === ownerId && row.thread_id === threadId &&
        row.engine_checkpoint === recoveryState?.stored && authority.owner?.id === ownerId &&
        authority.workspace?.id === workspaceId && authority.workspace.owner_account_id === ownerId &&
        authority.privateSettings?.private_account === 1 && authority.thread?.account_id === workspaceId,
      'canonical host dispatch did not observe the actual claimed replacement Run');
      await assertCheckpointUnchanged({ beforeStored: recoveryState.stored, beforeCapture: recoveryState.capture,
        afterStored: row.engine_checkpoint, expected: checkpointExpected,
        readObject: (key) => this.env.TAKOS_OFFLOAD.get(key) });
      requireValue(beforeHost.operations.length === 1 && beforeHost.operations[0].status === 'completed' &&
        beforeHost.operations[0].operation_key === recoveryState.operationKey &&
        beforeHost.operations[0].tool_name === 'create_artifact' &&
        JSON.stringify(beforeHost.operations[0]) === JSON.stringify(recoveryState.completedOperation) &&
        JSON.stringify(beforeHost.operations[0].result_output) === JSON.stringify(recoveryState.completedOperation.result_output) &&
        beforeHost.artifacts.length === 1 &&
        JSON.stringify(beforeHost.artifacts[0]) === JSON.stringify(recoveryState.cachedArtifact),
      'canonical host dispatch lost the completed cached create_artifact operation');
      requireValue(replacementServiceId === null && recoveryState.reclaimed !== true,
        'a replacement service identity was observed before the actual canonical Run claim');
      replacementServiceId = payload.serviceId;
      recoveryState.reclaimed = true;
      recoveryState.leaseClaim = { fromLease: 7, toLease: 8, oldServiceId,
        newServiceId: replacementServiceId, origin: 'canonical scheduled and Queue' };
      const response = await executorHostHandler.fetch(request, this.env, deferred.state);
      const responseBodyText = await response.clone().text();
      let responseBody;
      try { responseBody = JSON.parse(responseBodyText); }
      catch { responseBody = null; }
      const item = { request: payload, beforeHost,
        response: { status: response.status, body: responseBody, bodyText: responseBodyText,
          containerReceipt: response.headers.get('X-Takos-Executor-Container-Id') } };
      hostDispatches.push(item);
      requireValue(response.ok && item.response.containerReceipt === replacementContainerId,
        'actual canonical host did not choose the exact isolated warm-pool Container');
      return response;
    } catch (error) {
      if (!backgroundErrors.some((entry) => entry.error === String(error) && entry.handler === 'executor host'))
        backgroundErrors.push({ handler: 'executor host', error: String(error), stack: error instanceof Error ? error.stack : null });
      throw error;
    } finally { executorHostActive--; }
  }
}
export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    const deferred = trackNativeStateWaitUntil(ctx);
    requireValue(nativeWorkerDeferred.length < 512, 'owned Worker request counter capacity exceeded');
    nativeWorkerDeferred.push(deferred); ctx = deferred.state;
    if (path.startsWith('/__probe/')) {
      if (!controller(request)) return new Response('Forbidden', { status: 403 });
      if (path === '/__probe/schema') {
        const status = await ensureSchemaReady(env.DB);
        let ledger = [];
        if (status.ledgerTable) ledger = (await env.DB.prepare('SELECT name, checksum, applied_at FROM _takos_opentofu_migrations ORDER BY rowid').all()).results;
        return Response.json({ status, ledger });
      }
      if (path === '/__probe/dispatch' && request.method === 'POST') {
        const body = await request.text();
        const parsed = JSON.parse(body);
        requireValue(parsed.runId === expectedRunId && parsed.executorContainerId === expectedContainerId &&
          parsed.serviceId === oldServiceId && parsed.leaseVersion === 7,
        'manual dispatch probe is reserved for the first old Container only');
        return await executorHostHandler.fetch(new Request('https://internal/dispatch', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        }), env, ctx);
      }
      if (path === '/__probe/observation') return Response.json({ observation: controlObservation,
        controlTrace, controlIngress, controlErrors, modelInputs, toolCatalog, recovery: recoveryScalars(),
        canonical: { ...canonicalEvidence(env), state: await snapshotRun(env.DB) } });
      if (path === '/__probe/canonical-recovery') return Response.json({
        ...canonicalEvidence(env), state: await snapshotRun(env.DB) });
      if (path === '/__probe/run-status') {
        // Fixture-only readback of this exact Run. Production control callbacks
        // and completion still pass through the real public Worker unchanged.
        const row = await env.DB.prepare('SELECT id,status,usage,service_id,lease_version,account_id,requester_account_id,engine_checkpoint,completion_key,transcript_sequence_start FROM runs WHERE id=?').bind(expectedRunId).first();
        return Response.json({ row });
      }
      if (path === '/__probe/worker-producers') return Response.json({ producer: workerProducers() });
      if (path === '/__probe/notifier-drain' || path === '/__probe/notifier-snapshot') {
        const proofPath = path.endsWith('-drain') ? 'drain' : 'snapshot';
        return await env.RUN_NOTIFIER.getByName(expectedRunId).fetch(new Request('http://internal/__first-proof/' + proofPath, {
          headers: { 'X-First-Proof-Token': controllerToken },
        }));
      }
      if (path === '/__probe/notifier-arm' && request.method === 'POST') {
        const producer = workerProducers();
        requireValue(producer.oldContainerStopped && producer.replacementContainerStopped &&
          producer.publicWorkerFetchActive === 0 && producer.publicWorkerWaitUntilActive === 0 &&
          producer.publicWorkerWaitUntilRejected === 0 && producer.publicWorkerWaitUntilSynchronousThrows === 0 &&
          producer.backgroundActive === 0 && producer.executorHostActive === 0 &&
          producer.backgroundWaitUntilActive === 0 && producer.backgroundWaitUntilRejected === 0 &&
          producer.backgroundWaitUntilSynchronousThrows === 0 && producer.backgroundErrors === 0 &&
          producer.afterArmControlEntries === 0 && !usageArmRequested, 'actual Worker producer quiescence not proven');
        usageArmRequested = true;
        try { return await env.RUN_NOTIFIER.getByName(expectedRunId).fetch(new Request('http://internal/__first-proof/arm', {
          method: 'POST', headers: { 'X-First-Proof-Token': controllerToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ producer }),
        })); }
        catch (error) { return Response.json({ nativeStubRejected: true, runId: expectedRunId,
          nonce: expectedObserverNonce, message: String(error) }, { status: 590 }); }
      }
      if (path === '/__probe/usage-dispatch' && request.method === 'POST') {
        const completed = await dispatchRunUsageProjectionOutbox(env, { limit: 1 });
        return Response.json({ completed });
      }
      if (path === '/__probe/old-token-probe' && request.method === 'POST') {
        requireValue(recoveryState?.nativeDestroyAcknowledged && capturedOldBearer, 'old token unavailable before native death');
        const response = await trackedWebFetch(new Request(new URL('/api/internal/v1/agent-control/run-status', request.url), {
          method: 'POST', headers: { Authorization: capturedOldBearer,
            'X-Takos-Run-Id': expectedRunId, 'X-Takos-Executor-Tier': '1',
            'X-Takos-Executor-Container-Id': expectedContainerId, 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: expectedRunId }),
        }), env, ctx);
        const text = await response.text();
        return Response.json({ status: response.status, leaseLost: text.includes('Lease lost') });
      }
      if (path === '/__probe/age-recovery' && request.method === 'POST') {
        requireValue(recoveryState?.nativeDestroyAcknowledged && !recoveryState.reclaimed &&
          !recoveryHeartbeatAged && modelInputs.length === 1,
          'heartbeat aging requires the verified old Container death and cannot run twice');
        const before = await env.DB.prepare('SELECT * FROM runs WHERE id=?').bind(expectedRunId).first();
        requireValue(before?.status === 'running' && before.service_id === oldServiceId && before.lease_version === 7 &&
          before.account_id === workspaceId && before.requester_account_id === ownerId && before.thread_id === threadId &&
          before.completion_key === null, 'old lease identity changed before fixture reclaim');
        await assertCheckpointUnchanged({ beforeStored: recoveryState.stored, beforeCapture: recoveryState.capture,
          afterStored: before.engine_checkpoint, expected: checkpointExpected,
          readObject: (key) => env.TAKOS_OFFLOAD.get(key) });
        const staleHeartbeat = new Date(Date.now() - 6 * 60 * 1000).toISOString();
        const updated = await env.DB.prepare('UPDATE runs SET service_heartbeat=? WHERE id=? AND status=? AND service_id=? AND lease_version=7 AND account_id=? AND requester_account_id=? AND thread_id=? AND engine_checkpoint=?')
          .bind(staleHeartbeat, expectedRunId, 'running', oldServiceId, workspaceId, ownerId, threadId, recoveryState.stored).run();
        requireValue(updated.meta?.changes === 1, 'exact fixture heartbeat aging did not affect one row');
        const after = await env.DB.prepare('SELECT * FROM runs WHERE id=?').bind(expectedRunId).first();
        requireValue(after?.service_id === oldServiceId && after.lease_version === 7 && after.service_heartbeat === staleHeartbeat,
          'heartbeat aging changed the Run owner or lease');
        for (const key of Object.keys(before)) if (key !== 'service_heartbeat')
          requireValue(JSON.stringify(before[key]) === JSON.stringify(after[key]), 'fixture CAS altered an unrelated persisted Run field');
        await assertCheckpointUnchanged({ beforeStored: recoveryState.stored, beforeCapture: recoveryState.capture,
          afterStored: after.engine_checkpoint, expected: checkpointExpected,
          readObject: (key) => env.TAKOS_OFFLOAD.get(key) });
        recoveryHeartbeatAged = true;
        return Response.json({ aged: true, checkpoint: recoveryState.capture.witness,
          before, after,
          staleEligibility: 'accelerated fixture heartbeat aging: six minutes old for canonical scheduled and Queue stale-recovery gates' });
      }
      if (path === '/__probe/duplicate-recovery' && request.method === 'POST') {
        requireValue(!duplicateRecoverySent && emitted.length > 0 && emitted[0].body?.runId === expectedRunId,
          'duplicate recovery requires one recorded original canonical scheduled message and is one-shot');
        duplicateRecoverySent = true;
        await wrappedQueue(env).RUN_QUEUE.send(structuredClone(emitted[0].body));
        return Response.json({ accepted: true, runId: expectedRunId, duplicateCount: 1 });
      }
      if (path === '/__probe/identity-new') return Response.json({
        runId: expectedRunId, containerId: replacementContainerId,
        durableObjectId: env.EXECUTOR_CONTAINER.getByName(replacementContainerId).id.toString(),
      });
      if (path === '/__probe/destroy-new' && request.method === 'POST') {
        await env.EXECUTOR_CONTAINER.getByName(replacementContainerId).destroy();
        replacementDestroyed = true;
        return Response.json({ destroyed: true, containerId: replacementContainerId });
      }
      if (path === '/__probe/identity') return Response.json({
        runId: expectedRunId, containerId: expectedContainerId,
        durableObjectId: env.EXECUTOR_CONTAINER.getByName(expectedContainerId).id.toString(),
      });
      if (path === '/__probe/destroy' && request.method === 'POST') {
        // Only this fixture's baked-in identity is addressable by the controller.
        await env.EXECUTOR_CONTAINER.getByName(expectedContainerId).destroy();
        return Response.json({ destroyed: true, containerId: expectedContainerId });
      }
      return new Response('Unknown probe route', { status: 404 });
    }
    // Only the deterministic local model is synthetic. The agent receives its
    // synthetic key and endpoint from production token-guarded /api-keys.
    if (path === '/v1/chat/completions' && request.method === 'POST') {
      if (request.headers.get('Authorization') !== 'Bearer ' + env.LOCAL_PROOF_MODEL_KEY)
        return Response.json({ error: 'fixture model unauthorized' }, { status: 401 });
      const input = await request.json();
      const index = modelInputs.length + 1;
      if (!input || typeof input !== 'object' || !Array.isArray(input.messages) || index > 2)
        return Response.json({ error: 'fixture model call outside expected transcript' }, { status: 409 });
      requireValue(index !== 2 || recoveryState?.reclaimed === true, 'old executor made a second model call before replacement');
      modelInputs.push({ index, model: input.model,
        messages: input.messages.map((message) => ({ role: message.role,
          toolCallId: message.tool_call_id ?? null,
          toolCalls: Array.isArray(message.tool_calls)
            ? message.tool_calls.map((call) => ({ id: call.id, name: call.function?.name })) : [] })),
        tools: Array.isArray(input.tools) ? input.tools.map((tool) => tool.function?.name) : null });
      return Response.json({ id: 'chatcmpl-native-proof-' + index, object: 'chat.completion',
        created: Math.floor(Date.now() / 1000), model: 'gpt-local',
        choices: [{ index: 0, message: index === 1
          ? { role: 'assistant', content: null, tool_calls: [{ id: 'call-recovery-1',
            type: 'function', function: { name: 'create_artifact', arguments: JSON.stringify({
              type: 'doc', title: 'recovery-proof', content: 'local fixture',
            }) } }] }
          : { role: 'assistant', content: 'recovered answer', tool_calls: [] },
          finish_reason: index === 1 ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: index === 1 ? 11 : 13,
          completion_tokens: index === 1 ? 3 : 5,
          prompt_tokens_details: { cached_tokens: index === 1 ? 2 : 1 } },
      });
    }
    // The compiled container calls this public Worker URL. No fixture bearer map,
    // direct handler call, or token-store mutation sits on this request path.
    const isOwnedControl = path.startsWith('/api/internal/v1/agent-control/') &&
      request.headers.get('X-Takos-Run-Id') === expectedRunId;
    if (isOwnedControl) {
      if (usageArmRequested) {
        afterArmControlEntries++;
        throw new Error('late public control entry after first-usage arm');
      }
      const entry = { path, method: request.method, at: new Date().toISOString(),
        containerId: request.headers.get('X-Takos-Executor-Container-Id'),
        tokenPresented: request.headers.get('Authorization')?.startsWith('Bearer ') === true };
      controlIngress.push(entry);
      console.log(JSON.stringify({ nativeControlIngress: entry }));
    }
    const requestContainerId = request.headers.get('X-Takos-Executor-Container-Id');
    requireValue(!(isOwnedControl && requestContainerId === expectedContainerId && firstToolSeen && path.endsWith('/engine-checkpoint-save')),
      'old executor tried a post-tool checkpoint before ACK loss completed');
    const checkpointSaveRequest = isOwnedControl && requestContainerId === replacementContainerId &&
      path.endsWith('/engine-checkpoint-save') ? await request.clone().json() : null;
    let toolRequest = null;
    if (isOwnedControl && path.endsWith('/tool-execute')) {
      toolRequest = await request.clone().json();
      requireValue(request.method === 'POST' && toolRequest.runId === expectedRunId &&
        toolRequest.toolCall?.id === 'call-recovery-1' && toolRequest.toolCall?.name === 'create_artifact' &&
        toolRequest.toolCall?.arguments?.type === 'doc' && toolRequest.toolCall?.arguments?.title === 'recovery-proof' &&
        toolRequest.toolCall?.arguments?.content === 'local fixture' &&
        typeof toolRequest.idempotencyKey === 'string' && toolRequest.idempotencyKey.length > 0 &&
        new TextEncoder().encode(toolRequest.idempotencyKey).byteLength <= 512,
        'tool request does not match the exact engine-supplied operation');
      if (requestContainerId === expectedContainerId) {
        requireValue(!firstToolSeen && modelInputs.length === 1, 'old executor retried before physical death');
        firstToolSeen = true;
        capturedOldBearer = request.headers.get('Authorization'); // Volatile actual minted bearer only; never returned/logged.
      } else {
        requireValue(requestContainerId === replacementContainerId && recoveryState?.reclaimed &&
          toolRequest.idempotencyKey === recoveryState.operationKey, 'replacement tool request changed operation identity');
      }
    }
    let response;
    try { response = await trackedWebFetch(request, env, ctx); }
    catch (error) {
      if (isOwnedControl) {
        const entry = { path, at: new Date().toISOString(), error: String(error),
          stack: error instanceof Error ? error.stack : null };
        controlErrors.push(entry);
        console.error(JSON.stringify({ nativeControlError: entry }));
      }
      throw error;
    }
    if (isOwnedControl && requestContainerId === replacementContainerId && response.status === 200 && path.endsWith('/engine-checkpoint-load')) {
      const loaded = await response.clone().json();
      const original = JSON.parse(new TextDecoder().decode(recoveryState.capture.rawSerialized));
      requireValue(loaded.fatalError === null && JSON.stringify(loaded.checkpoint) === JSON.stringify(original.checkpoint) &&
        JSON.stringify(loaded.usage) === JSON.stringify(original.usage), 'replacement public checkpoint-load did not preserve pending state');
      recoveryState.replacementCheckpointLoad = { status: 200, fatalError: null,
        checkpointSha256: await digest(JSON.stringify(loaded.checkpoint)), usage: loaded.usage,
        node: loaded.checkpoint.current_node, loopId: loaded.checkpoint.loop_id,
        pendingToolCallIds: loaded.checkpoint.state_json.pending_tool_calls.map((call) => call.id) };
    }
    if (isOwnedControl && requestContainerId === replacementContainerId && response.status === 200 && path.endsWith('/engine-checkpoint-save')) {
      const saved = checkpointSaveRequest;
      requireValue(saved.checkpoint?.loop_id === recoveryState.capture.witness.loopId, 'replacement checkpoint changed loop identity');
      replacementCheckpointSaves.push({ loopId: saved.checkpoint.loop_id, status: 200 });
    }
    if (toolRequest) {
      requireValue(response.status === 200, 'production tool request did not genuinely succeed');
      const result = await response.clone().json();
      const resultSha = await digest(JSON.stringify(result));
      recoveryToolAttempts.push({ containerId: requestContainerId, operationKey: toolRequest.idempotencyKey,
        status: response.status, responseSha256: resultSha, callId: toolRequest.toolCall.id });
      if (requestContainerId === expectedContainerId) {
        // Register the same request-local work before its first microtask. It
        // survives native destruction closing the old HTTP client's socket.
        // No Promise from another controller request is created or resolved.
        const withheldAckWork = Promise.resolve().then(async () => {
        const row = await env.DB.prepare('SELECT * FROM runs WHERE id=?').bind(expectedRunId).first();
        const ops = (await env.DB.prepare('SELECT run_id,operation_key,tool_name,status FROM tool_operations WHERE run_id=?').bind(expectedRunId).all()).results;
        const effects = (await env.DB.prepare('SELECT * FROM artifacts WHERE run_id=? ORDER BY id').bind(expectedRunId).all()).results;
        requireValue(row?.status === 'running' && row.service_id === oldServiceId && row.lease_version === 7 &&
          row.account_id === workspaceId && row.requester_account_id === ownerId && row.thread_id === threadId &&
          row.completion_key === null && ops.length === 1 && ops[0].status === 'completed' &&
          ops[0].operation_key === toolRequest.idempotencyKey && ops[0].tool_name === 'create_artifact' &&
          effects.length === 1 && effects[0].account_id === workspaceId && effects[0].title === 'recovery-proof' && effects[0].content === 'local fixture',
          'first genuine tool response lacks the one durable private operation/effect');
        const capture = await captureCheckpointWitness({ stored: row.engine_checkpoint, expected: checkpointExpected,
          readObject: (key) => env.TAKOS_OFFLOAD.get(key) });
        recoveryState = { stage: 'tool-committed-before-ACK', stored: row.engine_checkpoint, capture,
          checkpointUpdatedAt: row.engine_checkpoint_updated_at,
          operationKey: toolRequest.idempotencyKey, productionToolStatus: response.status,
          completedOperation: (await env.DB.prepare('SELECT * FROM tool_operations WHERE run_id=?').bind(expectedRunId).first()),
          cachedArtifact: effects[0],
          toolResponseSha256: resultSha, nativeDestroyAcknowledged: false };
        // Request-local native destruction happens before any successful Response
        // can be returned to the compiled old executor. No cross-request barrier.
        await env.EXECUTOR_CONTAINER.getByName(expectedContainerId).destroy();
        requireValue(modelInputs.length === 1 && recoveryToolAttempts.length === 1,
          'old executor progressed before native destruction completed');
        recoveryState.nativeDestroyAcknowledged = true;
        recoveryState.modelCallsAtDeath = modelInputs.length;
        recoveryState.stage = 'old-container-destroyed-before-tool-ack';
        console.log(JSON.stringify({ nativeRecoveryStage: { stage: recoveryState.stage,
          runId: expectedRunId, containerId: expectedContainerId, observerNonce: expectedObserverNonce,
          at: new Date().toISOString(), productionToolStatus: 200,
          nativeDestroyAcknowledged: true, successResponseForwarded: false } }));
        controlTrace.push({ path, status: response.status, containerId: expectedContainerId,
          tokenPresented: true, successResponseForwarded: false });
        return Response.json({ error: 'fixture withheld old tool acknowledgement after native death' }, { status: 410 });
        });
        ctx.waitUntil(withheldAckWork.then(() => undefined));
        return await withheldAckWork;
      }
      requireValue(resultSha === recoveryState.toolResponseSha256, 'cached replacement tool outcome changed');
    }
    if (isOwnedControl) console.log(JSON.stringify({ nativeControlResponse: {
      path, status: response.status, at: new Date().toISOString(),
      runId: expectedRunId, containerId: request.headers.get('X-Takos-Executor-Container-Id'),
      observerNonce: expectedObserverNonce,
    } }));
    if (path.startsWith('/api/internal/v1/agent-control/') &&
        request.headers.get('X-Takos-Run-Id') === expectedRunId) {
      controlTrace.push({ path, status: response.status,
        containerId: request.headers.get('X-Takos-Executor-Container-Id'),
        tokenPresented: request.headers.get('Authorization')?.startsWith('Bearer ') === true });
      if (path.endsWith('/tool-catalog') && response.ok) {
        const catalog = await response.clone().json();
        toolCatalog = { tools: Array.isArray(catalog.tools)
          ? catalog.tools.map((tool) => ({ name: tool.name, side_effects: tool.side_effects,
            durable_idempotency: tool.durable_idempotency })) : null };
      }
    }
    if (path === '/api/internal/v1/agent-control/run-bootstrap' &&
        request.headers.get('X-Takos-Run-Id') === expectedRunId &&
        request.headers.get('X-Takos-Executor-Container-Id') === expectedContainerId) {
      controlObservation = {
        path, method: request.method, status: response.status,
        runId: expectedRunId, containerId: expectedContainerId,
        tokenPresented: request.headers.get('Authorization')?.startsWith('Bearer ') === true,
        at: new Date().toISOString(),
      };
    }
    return response;
  },
  async queue(batch, env, ctx) {
    return await withTrackedBackground('queue', ctx,
      (trackedCtx) => production.queue(observeQueueBatch(batch), wrappedQueue(env), trackedCtx));
  },
  async scheduled(controller, env, ctx) {
    return await withTrackedBackground('scheduled', ctx,
      (trackedCtx) => production.scheduled(controller, wrappedQueue(env), trackedCtx));
  },
};
`;
}
