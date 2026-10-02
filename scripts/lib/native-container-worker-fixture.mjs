// Staged native proof Worker source factory; install at scripts/lib only after review.
import { resolve } from 'node:path';

export function createNativeContainerWorkerFixture({ root, run, controllerToken, observerNonce }) {
  const importPath = (path) => JSON.stringify(resolve(root, path));
  return `import webWorker, { SessionDO } from ${importPath('src/worker/web.ts')};
import executorHostHandler, { ExecutorContainerTier1 } from ${importPath('src/worker/runtime/container-hosts/executor-host.ts')};
import { FirstProjectorRunNotifier as RunNotifierDO } from ${importPath('scripts/lib/native-first-projector-fixture.mjs')};
import { trackNativeStateWaitUntil } from ${importPath('scripts/lib/native-owned-work-tracker.mjs')};
import { ensureSchemaReady } from ${importPath('src/worker/platform/migrations/schema-gate.ts')};
import { dispatchRunUsageProjectionOutbox } from ${importPath('src/worker/application/services/app-usage/run-projection-outbox.ts')};
import { captureCheckpointWitness, assertCheckpointUnchanged } from ${importPath('scripts/lib/native-recovery-checkpoint-witness.mjs')};
export { SessionDO, ExecutorContainerTier1, RunNotifierDO };
const expectedRunId = ${JSON.stringify(run.runId)};
const expectedContainerId = ${JSON.stringify(run.containerId)};
const replacementContainerId = ${JSON.stringify(run.newContainerId)};
const oldServiceId = ${JSON.stringify(run.serviceId)};
const replacementServiceId = ${JSON.stringify(run.newServiceId)};
const ownerId = ${JSON.stringify(run.ownerId)};
const workspaceId = ${JSON.stringify(run.workspaceId)};
const threadId = ${JSON.stringify(run.threadId)};
const checkpointExpected = { runId: expectedRunId, serviceId: oldServiceId, leaseVersion: 7,
  pendingToolCallId: 'call-recovery-1', usage: { inputTokens: 11, outputTokens: 3, cachedInputTokens: 2 } };
let firstToolSeen = false, capturedOldBearer = null, recoveryState = null;
let replacementDestroyed = false, workerPublicFetchActive = 0, usageArmRequested = false, afterArmControlEntries = 0;
const nativeWorkerDeferred = [];
function workerProducers() {
  const snapshots = nativeWorkerDeferred.map((entry) => entry.snapshot());
  return { oldContainerStopped: recoveryState?.nativeDestroyAcknowledged === true,
    replacementContainerStopped: replacementDestroyed,
    publicWorkerFetchActive: workerPublicFetchActive,
    publicWorkerWaitUntilActive: snapshots.reduce((sum, value) => sum + value.active, 0),
    publicWorkerWaitUntilRejected: snapshots.reduce((sum, value) => sum + value.rejected, 0),
    publicWorkerWaitUntilSynchronousThrows: snapshots.reduce((sum, value) => sum + value.synchronousThrows, 0),
    afterArmControlEntries };
}
async function trackedWebFetch(request, env, ctx) {
  workerPublicFetchActive++;
  try { return await webWorker.fetch(request, env, ctx); }
  finally { workerPublicFetchActive--; }
}
const recoveryToolAttempts = [], replacementCheckpointSaves = [];
function requireValue(value, detail) { if (!value) throw new Error(detail); }
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
    reclaimed: recoveryState.reclaimed === true, leaseCas: recoveryState.leaseCas ?? null,
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
        return await executorHostHandler.fetch(new Request('https://internal/dispatch', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        }), env, ctx);
      }
      if (path === '/__probe/observation') return Response.json({ observation: controlObservation,
        controlTrace, controlIngress, controlErrors, modelInputs, toolCatalog, recovery: recoveryScalars() });
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
      if (path === '/__probe/reclaim' && request.method === 'POST') {
        requireValue(recoveryState?.nativeDestroyAcknowledged && !recoveryState.reclaimed && modelInputs.length === 1,
          'fixture reclaim cannot run before old Container death or twice');
        const before = await env.DB.prepare('SELECT * FROM runs WHERE id=?').bind(expectedRunId).first();
        requireValue(before?.status === 'running' && before.service_id === oldServiceId && before.lease_version === 7 &&
          before.account_id === workspaceId && before.requester_account_id === ownerId && before.thread_id === threadId &&
          before.completion_key === null, 'old lease identity changed before fixture reclaim');
        await assertCheckpointUnchanged({ beforeStored: recoveryState.stored, beforeCapture: recoveryState.capture,
          afterStored: before.engine_checkpoint, expected: checkpointExpected,
          readObject: (key) => env.TAKOS_OFFLOAD.get(key) });
        const now = new Date().toISOString();
        const updated = await env.DB.prepare('UPDATE runs SET service_id=?,lease_version=8,service_heartbeat=? WHERE id=? AND status=? AND service_id=? AND lease_version=7 AND account_id=? AND requester_account_id=? AND thread_id=? AND engine_checkpoint=?')
          .bind(replacementServiceId, now, expectedRunId, 'running', oldServiceId, workspaceId, ownerId, threadId, recoveryState.stored).run();
        requireValue(updated.meta?.changes === 1, 'exact fixture lease CAS did not affect one row');
        const after = await env.DB.prepare('SELECT * FROM runs WHERE id=?').bind(expectedRunId).first();
        requireValue(after?.service_id === replacementServiceId && after.lease_version === 8 && after.service_heartbeat === now,
          'fixture replacement lease readback failed');
        for (const key of Object.keys(before)) if (!['service_id','lease_version','service_heartbeat'].includes(key))
          requireValue(JSON.stringify(before[key]) === JSON.stringify(after[key]), 'fixture CAS altered an unrelated persisted Run field');
        await assertCheckpointUnchanged({ beforeStored: recoveryState.stored, beforeCapture: recoveryState.capture,
          afterStored: after.engine_checkpoint, expected: checkpointExpected,
          readObject: (key) => env.TAKOS_OFFLOAD.get(key) });
        recoveryState.reclaimed = true;
        recoveryState.leaseCas = { changedRows: 1, fromLease: 7, toLease: 8, oldServiceId,
          newServiceId: replacementServiceId, origin: 'fixture CAS; production cron/Queue reclaim unqualified' };
        return Response.json({ reclaimed: true, checkpoint: recoveryState.capture.witness, leaseCas: recoveryState.leaseCas });
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
      if (usageArmRequested) afterArmControlEntries++;
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
        const effects = (await env.DB.prepare('SELECT run_id,account_id,title,content FROM artifacts WHERE run_id=?').bind(expectedRunId).all()).results;
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
};
`;
}
