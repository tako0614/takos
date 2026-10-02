// Ignored development candidate. Native execution requires a separate reviewed supervisor.
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const execFile = promisify(execFileCallback);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
function assert(value, message) { if (!value) throw new Error(message); }
function exact(left, right, label) { assert(JSON.stringify(left) === JSON.stringify(right), `${label} changed`); }
async function bounded(work, ms, label) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
  })]); } finally { clearTimeout(timer); }
}

export async function proveFirstProjector({ mf, db, run, controllerToken, observerNonce,
  options, stages, containerWitness, replacementContainerWitness, completed, queuedWitness, projectorObserver }) {
  const record = { scope: 'same local two-Container recovery; executor-stopped first usage projection, lost successful usage ACK and real-due cold notifier retry', stages: [] };
  const mark = (stage, details = {}) => {
    const value = { stage, at: new Date().toISOString(), ...details };
    record.stages.push(value); stages.push(value);
  };
  const get = async (path, method = 'GET') => {
    const response = await bounded(mf.dispatchFetch(options.callbackUrl + path, {
      method, headers: { 'X-Probe-Controller-Token': controllerToken },
    }), 20_000, path);
    return { response, value: await bounded(response.json(), 5_000, `${path} body`) };
  };
  const ok = async (path, method = 'GET') => {
    const result = await get(path, method);
    assert(result.response.ok, `${path} rejected (${result.response.status})`);
    return result.value;
  };
  const canonical = async () => ({
    meters: (await db.prepare(`SELECT idempotency_key,owner_account_id,scope_type,
      space_id,meter_type,units,reference_id,reference_type,created_at
      FROM app_usage_events WHERE reference_id=? ORDER BY meter_type`).bind(run.runId).all()).results,
    rollups: (await db.prepare(`SELECT owner_account_id,scope_type,scope_id,space_id,
      meter_type,period_start,units,updated_at FROM app_usage_rollups
      WHERE owner_account_id=? AND space_id=? ORDER BY meter_type`).bind(run.ownerId, run.workspaceId).all()).results,
    // Assertion table has id/valid only. This is a fresh fixture-owned DB.
    assertions: (await db.prepare('SELECT * FROM run_usage_projection_assertions').all()).results,
  });
  const outbox = () => db.prepare('SELECT * FROM run_usage_projection_outbox WHERE run_id=?').bind(run.runId).first();
  const terminal = () => db.prepare(`SELECT id,status,usage,service_id,lease_version,
    account_id,requester_account_id,engine_checkpoint,completion_key,
    transcript_sequence_start FROM runs WHERE id=?`).bind(run.runId).first();
  const invariantWitness = (row) => ({ id: row.id, run_id: row.run_id, completion_key: row.completion_key,
    run_status: row.run_status, workspace_id: row.workspace_id, owner_account_id: row.owner_account_id });
  const producerZero = (producer) => producer?.oldContainerStopped === true &&
    producer.replacementContainerStopped === true && producer.publicWorkerFetchActive === 0 &&
    producer.publicWorkerWaitUntilActive === 0 && producer.publicWorkerWaitUntilRejected === 0 &&
    producer.publicWorkerWaitUntilSynchronousThrows === 0 && producer.afterArmControlEntries === 0;
  try {
    const destroyed = await ok('/__probe/destroy-new', 'POST');
    assert(destroyed.destroyed === true && destroyed.containerId === run.newContainerId,
      'replacement native Container destruction was not acknowledged');
    const physicalIds = (await execFile('docker', ['container', 'ls', '-aq', '--no-trunc'], {
      encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024,
    })).stdout.trim().split('\n').filter(Boolean);
    const agents = [containerWitness, replacementContainerWitness].map((witness) => {
      assert(witness.runId === run.runId && witness.dockerContainers.length === 1,
        'exact physical-agent witness absent');
      return witness.dockerContainers[0].id;
    });
    assert(agents[0] !== agents[1] && agents.every((id) => !physicalIds.includes(id)),
      'both exact physical agents must be absent before first usage delivery');
    record.physicalAgentsAbsentBeforeFirstProjector = { agentIds: agents, checkedAt: new Date().toISOString() };
    mark('both-actual-agents-absent-before-first-usage', record.physicalAgentsAbsentBeforeFirstProjector);
    const zero = await canonical();
    assert(zero.meters.length === 0 && zero.rollups.length === 0 && zero.assertions.length === 0,
      'eager producer escaped the native first-writer fence');
    const fence = await db.prepare('SELECT name,sql FROM sqlite_master WHERE type=? AND name=?').bind('trigger', run.usageTrigger).first();
    assert(fence?.name === run.usageTrigger, 'native first-writer fence missing');
    const before = await outbox();
    exact(invariantWitness(before), invariantWitness(queuedWitness), 'original completion witness');
    assert(before.delivery_status === 'queued' && before.attempts === 0 && before.projected_revision === null &&
      before.claim_token === null && before.claimed_at === null, 'native outbox already attempted');
    exact(await terminal(), completed, 'terminal Run before first projector');
    let drain;
    const drainDeadline = Date.now() + 20_000;
    do {
      const producers = await ok('/__probe/worker-producers');
      drain = await ok('/__probe/notifier-drain');
      record.drain = drain; record.producer = producers.producer;
      if (producerZero(producers.producer) && drain.quiescent === true) break;
      await pause(100);
    } while (Date.now() < drainDeadline);
    assert(producerZero(record.producer) && drain?.quiescent === true,
      'old actual producer/native notifier work did not drain under the fence');
    record.before = { zero, fence, outbox: before, terminal: completed, drain, producer: record.producer };
    mark('old-native-work-drained-under-usage-fence', { instanceId: drain.instanceId, doId: drain.doId });
    const armed = await get('/__probe/notifier-arm', 'POST');
    assert(armed.response.status === 590 && armed.value.nativeStubRejected === true &&
      armed.value.runId === run.runId && armed.value.nonce === observerNonce &&
      armed.value.message.includes(`GA_FIRST_PROJECTOR_ABORT_${observerNonce}`),
      'actual old input-gate abort and stub rejection not proven');
    record.oldRequestAbort = { status: armed.response.status, ...armed.value };
    mark('old-native-projection-actor-aborted', record.oldRequestAbort);
    // No notifier marker/instance request is sent here. Its first cold domain
    // request must come from the real immutable-witness outbox dispatcher.
    const first = await get('/__probe/usage-dispatch', 'POST');
    assert(first.response.ok && first.value.completed === 0,
      'lost successful first usage ACK incorrectly completed the outbox');
    const fault = await ok('/__probe/notifier-snapshot');
    record.firstActor = fault;
    const pending = await outbox(), firstRows = await canonical();
    exact(invariantWitness(pending), invariantWitness(before), 'failed-delivery completion witness');
    assert(pending.delivery_status === 'queued' && pending.attempts === 1 && pending.projected_revision === null &&
      pending.claim_token === null && pending.claimed_at === null &&
      typeof pending.next_attempt_at === 'string' && Date.parse(pending.next_attempt_at) > Date.now() &&
      pending.last_error?.includes(`GA_FIRST_USAGE_ACK_LOST_${observerNonce}`),
      'real lost-ACK failure did not persist one retryable native outbox attempt');
    assert(fault.instanceId !== drain.instanceId && fault.doId === drain.doId &&
      fault.arm?.instanceId === drain.instanceId && fault.arm.nonce === observerNonce &&
      fault.fault?.instanceId === fault.instanceId && fault.fault.nonce === observerNonce &&
      fault.fault.ack?.success === true && fault.fault.ack.runId === run.runId &&
      Number.isSafeInteger(fault.fault.ack.revision) && fault.fault.ack.revision > 0,
      'first native cold actor/arm/real successful ACK/fault marker not proven');
    const firstRevision = fault.fault.ack.revision;
    assert(fault.usageLedger?.revision === firstRevision && fault.usageLedger.projectedRevision === firstRevision,
      'lost successful ACK lacks current persisted projection revision');
    assert(firstRows.meters.length === 2 && firstRows.rollups.length === 2 && firstRows.assertions.length === 0,
      'first native projector did not atomically create exactly two canonical meters');
    record.firstDelivery = { response: first.value, pending, rows: firstRows, revision: firstRevision, actor: fault };
    exact(await terminal(), completed, 'terminal Run after lost successful usage ACK');
    mark('first-native-witness-projected-and-successful-ack-lost', { instanceId: fault.instanceId, revision: firstRevision });
    // The actor was just observed alive after the outside-gate thrown fault.
    // Explicit idle eviction must succeed; "not currently running" is red.
    await bounded(mf.unsafeEvictDurableObject(`canonical-container-${run.runId}`, 'RunNotifierDO', { name: run.runId }),
      8_000, 'idle first projection actor eviction');
    const cold = await ok('/__probe/notifier-snapshot');
    assert(cold.instanceId !== fault.instanceId && cold.instanceId !== drain.instanceId && cold.doId === fault.doId,
      'third real native notifier instance not proven');
    exact(cold.fault, fault.fault, 'durable one-shot ACK fault marker after native eviction');
    assert(cold.usageLedger?.revision === firstRevision && cold.usageLedger.projectedRevision === firstRevision,
      'cold persisted first projection revision changed');
    record.coldActor = cold;
    mark('native-notifier-cold-retry-actor-observed', { instanceId: cold.instanceId, revision: firstRevision });
    const retryAt = Date.parse(pending.next_attempt_at);
    assert(Number.isFinite(retryAt) && retryAt - Date.now() <= 65_000, 'unexpected actual persisted outbox retry delay');
    // Honor the real due time. Do not mutate next_attempt_at or inject a future clock.
    while (Date.now() <= retryAt) await pause(Math.min(500, retryAt + 1 - Date.now()));
    record.retryWait = { originalNextAttemptAt: pending.next_attempt_at, dispatchedAt: new Date().toISOString() };
    const second = await get('/__probe/usage-dispatch', 'POST');
    assert(second.response.ok && second.value.completed === 1, 'actual-due native cold retry did not complete one witness');
    const done = await outbox(), retryRows = await canonical(), retryActor = await ok('/__probe/notifier-snapshot');
    // Preserve the actual retry readbacks before any assertion can fail.
    record.secondDelivery = { response: second.value, done, rows: retryRows, actor: retryActor };
    const nativeRetryResponse = await projectorObserver.response(done.projected_revision);
    record.secondDelivery.nativeResponse = nativeRetryResponse;
    record.nativeResponseMarkers = projectorObserver.snapshot();
    exact(invariantWitness(done), invariantWitness(before), 'cold-retry completion witness');
    assert(done.delivery_status === 'done' && done.attempts === 2 && done.projected_revision === firstRevision + 1 &&
      done.claim_token === null && done.claimed_at === null && done.next_attempt_at === null && done.last_error === null,
      'actual cold retry lacks exact durable done/second-revision ACK');
    exact(retryRows.meters, firstRows.meters, 'canonical event rows after actual-due retry');
    const rollupSemantics = (rows) => rows.map(({ updated_at: _updatedAt, ...value }) => value);
    exact(rollupSemantics(retryRows.rollups), rollupSemantics(firstRows.rollups), 'canonical rollup semantics after retry');
    // A DO may retire naturally during the real sixty-second due wait.
    // Bind the snapshot to the actor of the genuine retry response instead of
    // assuming the pre-wait observation kept that prior instance resident.
    assert(nativeRetryResponse.runId === run.runId && nativeRetryResponse.nonce === observerNonce &&
      nativeRetryResponse.doId === cold.doId && nativeRetryResponse.instanceId === retryActor.instanceId &&
      nativeRetryResponse.instanceId !== fault.instanceId && nativeRetryResponse.instanceId !== drain.instanceId &&
      nativeRetryResponse.revision === done.projected_revision,
      'actual native retry response actor does not match retry snapshot');
    record.secondDelivery.naturalActorReplacementDuringDueWait = retryActor.instanceId !== cold.instanceId;
    assert(retryRows.assertions.length === 0, 'native retry left assertion rows');
    assert(retryActor.usageLedger?.revision === done.projected_revision &&
      retryActor.usageLedger.projectedRevision === done.projected_revision,
      'actual native retry head revision disagrees with durable ACK');
    exact(retryActor.fault, fault.fault, 'one-shot ACK fault after successful retry');
    exact(await terminal(), completed, 'terminal Run after cold usage retry');

    const idle = await get('/__probe/usage-dispatch', 'POST'), idleActor = await ok('/__probe/notifier-snapshot');
    record.idleDelivery = { response: idle.value, actor: idleActor, nativeResponseMarkers: projectorObserver.snapshot() };
    assert(idle.response.ok && idle.value.completed === 0, 'third native dispatch was not idle');
    assert(projectorObserver.snapshot().length === 1, 'idle third dispatch unexpectedly issued native projection');
    exact(await outbox(), done, 'done outbox after idle dispatch');
    exact(await canonical(), retryRows, 'canonical rows after idle dispatch');
    exact(idleActor.head, retryActor.head, 'native durable head after idle dispatch');
    assert(idleActor.instanceId === retryActor.instanceId && idleActor.usageLedger.revision === done.projected_revision,
      'idle native dispatch entered a new projection revision');
    const finalProducers = await ok('/__probe/worker-producers');
    assert(producerZero(finalProducers.producer), 'actual public producer resumed after usage arm');
    const remainingFence = await db.prepare('SELECT name FROM sqlite_master WHERE type=? AND name=?').bind('trigger', run.usageTrigger).first();
    assert(remainingFence === null, 'one exact fixture fence remains after first-witness projection');
    record.idleDelivery = { response: idle.value, actor: idleActor, producer: finalProducers.producer };
    record.qualified = true;
    mark('native-first-projector-lost-ack-cold-retry-and-idle-completed', { revision: done.projected_revision });
    return { record, projectionResponse: second.response, projectionBody: second.value,
      doneWitness: done, meters: retryRows.meters, rollups: retryRows.rollups };
  } catch (error) {
    record.qualified = false;
    record.error = { name: error.name, message: error.message, stack: error.stack };
    throw error;
  } finally {
    await writeFile(join(options.outputDir, 'first-projector-composition.json'), JSON.stringify(record, null, 2) + '\n');
  }
}
