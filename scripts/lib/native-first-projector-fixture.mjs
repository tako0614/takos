// Ignored, local native-composition fixture. Never bind this class in a product Worker.
import { RunNotifierDO } from '../../src/worker/runtime/durable-objects/run-notifier.ts';
import { loadNotifierSnapshot } from '../../src/worker/runtime/durable-objects/notifier-journal.ts';
import { parseRunNotifierJournalState } from '../../src/worker/runtime/durable-objects/run-notifier-journal-state.ts';
import { trackNativeD1Work, trackNativeStateWaitUntil } from './native-owned-work-tracker.mjs';

const ARM_KEY = '__ga_first_projector_arm_v1';
const FAULT_KEY = '__ga_first_projector_fault_v1';
const PROOF_PREFIX = '/__first-proof/';
const METER_UNITS = { llm_tokens_input: 0.024, llm_tokens_output: 0.008 };
const WITNESS_FIELDS = ['id', 'runId', 'completionKey', 'runStatus', 'workspaceId', 'ownerAccountId'];

function requireProof(ok, code) {
  if (!ok) throw new Error(`GA_FIRST_PROJECTOR_RED_${code}`);
}

function safeString(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function exactObject(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function digest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (part) => part.toString(16).padStart(2, '0')).join('');
}

function count() { return { entries: 0, active: 0, settled: 0, rejected: 0 }; }

async function counted(counter, work) {
  counter.entries++;
  counter.active++;
  try { return await work(); }
  catch (error) { counter.rejected++; throw error; }
  finally { counter.active--; counter.settled++; }
}

function witnessFromRow(row) {
  if (!row) return null;
  return { id: row.id, runId: row.run_id, completionKey: row.completion_key,
    runStatus: row.run_status, workspaceId: row.workspace_id, ownerAccountId: row.owner_account_id };
}

function normalizedSql(value) { return value.replace(/\s+/gu, '').replace(/;+$/u, ''); }

/** An injectable superclass permits only offline boundary tests; the production export uses RunNotifierDO. */
export function createFirstProjectorRunNotifier(productionClass) {
  requireProof(typeof productionClass === 'function', 'MISSING_PRODUCTION_CLASS');
  return class FirstProjectorRunNotifierFixture extends productionClass {
    constructor(state, env) {
      // Both native wrappers must exist before NotifierBase starts constructor initialization.
      const d1 = trackNativeD1Work(env.DB);
      const waited = trackNativeStateWaitUntil(state);
      super(waited.state, { ...env, DB: d1.binding });
      this.firstProof = {
        rawDb: d1.binding, d1Snapshot: d1.snapshot, waitSnapshot: waited.snapshot,
        env: {
          runId: env.FIRST_PROOF_RUN_ID, workspaceId: env.FIRST_PROOF_WORKSPACE_ID,
          ownerId: env.FIRST_PROOF_OWNER_ID, nonce: env.FIRST_PROOF_NONCE,
          trigger: env.FIRST_PROOF_TRIGGER, token: env.FIRST_PROOF_TOKEN,
        },
        instanceId: crypto.randomUUID(), domain: count(), alarm: count(), special: count(),
        projection: count(), deadline: false, constructorEntries: 1,
      };
      const proof = this.firstProof;
      requireProof(/^[A-Za-z0-9_-]{1,64}$/u.test(proof.env.runId ?? ''), 'RUN_BINDING');
      requireProof(safeString(proof.env.workspaceId) && safeString(proof.env.ownerId) &&
        safeString(proof.env.nonce) && safeString(proof.env.token), 'IDENTITY_BINDING');
      requireProof(/^ga_run_usage_fence_[a-f0-9]{32}$/u.test(proof.env.trigger ?? ''), 'TRIGGER_BINDING');
      requireProof(typeof state.abort === 'function' &&
        typeof state.blockConcurrencyWhile === 'function', 'NATIVE_STATE_REQUIRED');
      const expectedId = env.RUN_NOTIFIER.idFromName(proof.env.runId);
      proof.doId = String(state.id);
      requireProof(proof.doId.length > 0 && proof.doId === String(expectedId), 'DO_IDENTITY');
      // TS private is an ordinary JS method in this pinned production source.
      const originalProjectUsage = this.projectUsage;
      requireProof(typeof originalProjectUsage === 'function', 'PROJECTOR_METHOD');
      this.projectUsage = (...args) => {
        const counter = proof.projection;
        counter.entries++;
        counter.active++;
        let work;
        try { work = Reflect.apply(originalProjectUsage, this, args); }
        catch (error) {
          counter.active--; counter.settled++; counter.rejected++;
          if (String(error?.message ?? '').includes('deadline exceeded')) proof.deadline = true;
          throw error;
        }
        requireProof(work && typeof work.then === 'function', 'PROJECTOR_PROMISE');
        // Observe the original production promise without replacing its identity.
        void work.then(() => { counter.active--; counter.settled++; }, (error) => {
          counter.active--; counter.settled++; counter.rejected++;
          if (String(error?.message ?? '').includes('deadline exceeded')) proof.deadline = true;
        });
        return work;
      };
    }

    proofCounters() {
      const p = this.firstProof;
      const nativeD1 = p.d1Snapshot();
      const nativeWaitUntil = p.waitSnapshot();
      return { constructorEntries: p.constructorEntries, domain: { ...p.domain },
        alarm: { ...p.alarm }, special: { ...p.special },
        projection: { ...p.projection }, nativeD1, nativeWaitUntil,
        deadline: p.deadline,
        projectionPromise: this.projectionPromise !== null,
        archiveWorkPromise: this.archiveWorkPromise !== null,
        baselinePromise: this.baselinePromise !== null,
        pumpPromise: this.pumpPromise !== null };
    }

    assertIdle({ domainSelf = 0, specialSelf = 0, fresh = false } = {}) {
      const c = this.proofCounters();
      requireProof(c.domain.active === domainSelf && c.alarm.active === 0 &&
        c.special.active === specialSelf && c.projection.active === 0 &&
        c.nativeD1.active === 0 && c.nativeWaitUntil.active === 0 &&
        !c.projectionPromise && !c.archiveWorkPromise && !c.baselinePromise &&
        !c.pumpPromise && !c.deadline &&
        c.nativeD1.synchronousThrows === 0 && c.nativeWaitUntil.synchronousThrows === 0,
      'NOTIFIER_NOT_QUIESCENT');
      if (fresh) requireProof(c.domain.entries === 1 && c.alarm.entries === 0 &&
        c.special.entries === 0 && c.projection.entries === 0, 'COLD_INSTANCE_ALREADY_ENTERED');
      return c;
    }

    async readHead() {
      const raw = await this.state.storage.get('bufferState');
      const parsed = parseRunNotifierJournalState(
        await loadNotifierSnapshot(this.state.storage, 'run'));
      requireProof(parsed && parsed.runId === this.firstProof.env.runId &&
        parsed.usageLedger?.phase === 'ready' &&
        Number.isSafeInteger(parsed.usageLedger.revision) &&
        parsed.usageLedger.revision > 0, 'JOURNAL_NOT_READY');
      return { digest: await digest(raw), runId: parsed.runId,
        usageLedger: { phase: parsed.usageLedger.phase, totals: parsed.usageLedger.totals,
          revision: parsed.usageLedger.revision,
          projectedRevision: parsed.usageLedger.projectedRevision },
        usageReceiptCount: parsed.usageReceipts.length,
        usagePendingCount: parsed.usageSegmentBuffer.length,
        usageLastFlushedSegmentIndex: parsed.usageLastFlushedSegmentIndex };
    }

    async readSql() {
      const { rawDb: db, env: p } = this.firstProof;
      const one = async (sql, arg) => db.prepare(sql).bind(arg).first();
      const all = async (sql, arg) => (await db.prepare(sql).bind(arg).all()).results;
      const run = await one(`SELECT id,status,usage,service_id,lease_version,account_id,
        requester_account_id,engine_checkpoint,completion_key,transcript_sequence_start
        FROM runs WHERE id=?`, p.runId);
      const witnessRows = await all(`SELECT id,run_id,completion_key,run_status,workspace_id,
        owner_account_id,delivery_status,attempts,projected_revision,claim_token,
        claimed_at,next_attempt_at,last_error FROM run_usage_projection_outbox
        WHERE run_id=?`, p.runId);
      const meters = await all(`SELECT idempotency_key,owner_account_id,scope_type,space_id,
        meter_type,units,reference_id,reference_type,metadata,created_at
        FROM app_usage_events WHERE reference_id=? ORDER BY meter_type`, p.runId);
      const rollups = await all(`SELECT owner_account_id,scope_type,scope_id,space_id,
        meter_type,period_start,units,updated_at FROM app_usage_rollups
        WHERE scope_id=? ORDER BY meter_type`, p.workspaceId);
      const assertions = await db.prepare('SELECT COUNT(*) AS n FROM run_usage_projection_assertions').first();
      const space = await one('SELECT id,owner_account_id FROM accounts WHERE id=?', p.workspaceId);
      const trigger = await one(`SELECT name,sql FROM sqlite_master
        WHERE type='trigger' AND name=?`, p.trigger);
      return { run, witnessRows, meters, rollups, assertions: Number(assertions?.n),
        space, trigger };
    }

    assertAuthority(sql, expectedRun = null, expectedWitness = null) {
      const p = this.firstProof.env;
      const r = sql.run;
      requireProof(r?.id === p.runId && r.status === 'completed' &&
        r.account_id === p.workspaceId && r.requester_account_id === p.ownerId &&
        r.lease_version === 8 && r.engine_checkpoint === null &&
        safeString(r.completion_key) && safeString(r.service_id) &&
        r.transcript_sequence_start === 1 && sql.space?.id === p.workspaceId &&
        (sql.space.owner_account_id || sql.space.id) === p.ownerId,
      'RUN_AUTHORITY');
      let usage;
      try { usage = JSON.parse(r.usage); } catch { requireProof(false, 'RUN_USAGE_JSON'); }
      requireProof(usage.inputTokens === 24 && usage.outputTokens === 8 &&
        usage.cacheReadTokens === 3, 'RUN_USAGE');
      requireProof(sql.witnessRows.length === 1, 'WITNESS_CARDINALITY');
      const w = sql.witnessRows[0];
      requireProof(w.id === `run-usage-projection:${r.completion_key}` &&
        w.run_id === p.runId && w.completion_key === r.completion_key &&
        w.run_status === 'completed' && w.workspace_id === p.workspaceId &&
        w.owner_account_id === p.ownerId, 'WITNESS_AUTHORITY');
      if (expectedRun) requireProof(exactObject(r, expectedRun), 'RUN_CHANGED');
      if (expectedWitness) requireProof(exactObject(witnessFromRow(w), expectedWitness), 'WITNESS_CHANGED');
      return w;
    }

    assertTrigger(sql) {
      const p = this.firstProof.env;
      const expected = `CREATE TRIGGER ${p.trigger} BEFORE INSERT ON app_usage_events ` +
        `WHEN NEW.reference_id='${p.runId}' AND NEW.reference_type='run' ` +
        `BEGIN SELECT RAISE(ABORT, 'GA_FIRST_USAGE_FENCED'); END`;
      requireProof(sql.trigger?.name === p.trigger &&
        normalizedSql(sql.trigger.sql) === normalizedSql(expected), 'TRIGGER_MISSING_OR_CHANGED');
    }

    assertZero(sql) {
      requireProof(sql.meters.length === 0 && sql.rollups.length === 0 &&
        sql.assertions === 0, 'CANONICAL_ROWS_PREEXIST');
    }

    assertCanonical(sql) {
      const p = this.firstProof.env;
      requireProof(sql.meters.length === 2 && sql.rollups.length === 2 &&
        sql.assertions === 0 && sql.trigger === null, 'CANONICAL_CARDINALITY');
      for (const meter of sql.meters) {
        const expected = METER_UNITS[meter.meter_type];
        requireProof(expected !== undefined && meter.units === expected &&
          meter.idempotency_key === `run:${p.runId}:${meter.meter_type}` &&
          meter.owner_account_id === p.ownerId && meter.scope_type === 'space' &&
          meter.space_id === p.workspaceId && meter.reference_id === p.runId &&
          meter.reference_type === 'run' && meter.metadata === '{}' &&
          Number.isFinite(Date.parse(meter.created_at)), 'CANONICAL_METER');
        const matching = sql.rollups.filter((row) => row.meter_type === meter.meter_type);
        requireProof(matching.length === 1 && matching[0].owner_account_id === p.ownerId &&
          matching[0].scope_type === 'space' && matching[0].scope_id === p.workspaceId &&
          matching[0].space_id === p.workspaceId && matching[0].units === expected &&
          matching[0].period_start === `${meter.created_at.slice(0, 7)}-01` &&
          Number.isFinite(Date.parse(matching[0].updated_at)), 'CANONICAL_ROLLUP');
      }
    }

    async readMarker(key) { return await this.state.storage.get(key) ?? null; }

    async putMarker(key, value) {
      await this.state.storage.put(key, value);
      requireProof(exactObject(await this.readMarker(key), value), 'MARKER_READBACK');
    }

    async proofSnapshot() {
      await this.awaitInitialized();
      const [arm, fault, head, sql] = await Promise.all([
        this.readMarker(ARM_KEY), this.readMarker(FAULT_KEY), this.readHead(), this.readSql(),
      ]);
      return { instanceId: this.firstProof.instanceId, doId: this.firstProof.doId,
        nonce: this.firstProof.env.nonce, quiescent: this.isQuiescent(),
        counts: this.proofCounters(), arm, fault, head,
        usageLedger: head.usageLedger, run: sql.run,
        witness: sql.witnessRows[0] ?? null, meters: sql.meters,
        rollups: sql.rollups, assertions: sql.assertions,
        trigger: sql.trigger };
    }

    isQuiescent() {
      const c = this.proofCounters();
      return c.domain.active === 0 && c.alarm.active === 0 &&
        c.special.active <= 1 &&
        c.projection.active === 0 && c.nativeD1.active === 0 &&
        c.nativeWaitUntil.active === 0 && !c.projectionPromise &&
        !c.archiveWorkPromise && !c.baselinePromise && !c.pumpPromise && !c.deadline;
    }

    async proofDrain() {
      // Observe prior-request work only. The controller polls the scalar result;
      // a promise created by another input cannot cross the pinned request boundary.
      return this.proofSnapshot();
    }

    async proofArm(request) {
      const p = this.firstProof.env;
      requireProof(request.method === 'POST', 'ARM_METHOD');
      return this.state.blockConcurrencyWhile(async () => {
        await this.awaitInitialized();
        const payload = await request.json();
        const producer = payload?.producer;
        requireProof(producer?.oldContainerStopped === true &&
          producer?.replacementContainerStopped === true &&
          producer?.publicWorkerFetchActive === 0 &&
          producer?.publicWorkerWaitUntilActive === 0 &&
          producer?.publicWorkerWaitUntilRejected === 0 &&
          producer?.publicWorkerWaitUntilSynchronousThrows === 0 &&
          producer?.afterArmControlEntries === 0, 'PRODUCER_NOT_STOPPED');
        this.assertIdle({ specialSelf: 1 });
        requireProof(await this.readMarker(ARM_KEY) === null &&
          await this.readMarker(FAULT_KEY) === null, 'ALREADY_ARMED');
        const sql = await this.readSql();
        const head = await this.readHead();
        this.assertTrigger(sql);
        this.assertZero(sql);
        const witness = this.assertAuthority(sql);
        requireProof(witness.delivery_status === 'queued' && witness.attempts === 0 &&
          witness.projected_revision === null && witness.claim_token === null &&
          witness.claimed_at === null && witness.next_attempt_at === null &&
          witness.last_error === null, 'WITNESS_NOT_QUEUED');
        requireProof(head.usageLedger.projectedRevision < head.usageLedger.revision &&
          this.runId === p.runId && this.usageLedger?.phase === 'ready' &&
          this.usageLedger.revision === head.usageLedger.revision &&
          this.usageLedger.projectedRevision === head.usageLedger.projectedRevision &&
          exactObject(this.usageLedger.totals, head.usageLedger.totals), 'LEDGER_NOT_DIRTY');
        this.assertIdle({ specialSelf: 1 });
        const marker = { kind: 'native-first-projector-arm-v1', nonce: p.nonce,
          doId: this.firstProof.doId, instanceId: this.firstProof.instanceId,
          oldInstanceId: this.firstProof.instanceId,
          runId: p.runId, workspaceId: p.workspaceId, ownerId: p.ownerId,
          trigger: p.trigger, triggerSqlDigest: await digest(sql.trigger.sql),
          producer, run: sql.run,
          witness: witnessFromRow(witness), preHead: head,
          zeroRows: { meters: 0, rollups: 0, assertions: 0 },
          quiescence: this.proofCounters() };
        await this.putMarker(ARM_KEY, marker);
        // Final readback under the same gate; any failure retains the trigger.
        const finalSql = await this.readSql();
        this.assertTrigger(finalSql);
        this.assertZero(finalSql);
        this.assertAuthority(finalSql, marker.run, marker.witness);
        this.assertIdle({ specialSelf: 1 });
        console.log(`GA_FIRST_PROJECTOR_ARM_READY_${p.nonce}`);
        this.state.abort(`GA_FIRST_PROJECTOR_ABORT_${p.nonce}`);
        throw new Error('GA_FIRST_PROJECTOR_RED_ABORT_RETURNED');
      });
    }

    async proofFirstProject(request) {
      const p = this.firstProof.env;
      let lostAck = false;
      const result = await this.state.blockConcurrencyWhile(async () => {
        await this.awaitInitialized();
        const arm = await this.readMarker(ARM_KEY);
        const fault = await this.readMarker(FAULT_KEY);
        if (!arm) return { passthrough: true };
        requireProof(arm.kind === 'native-first-projector-arm-v1' &&
          arm.nonce === p.nonce && arm.doId === this.firstProof.doId &&
          arm.runId === p.runId && arm.workspaceId === p.workspaceId &&
          arm.ownerId === p.ownerId && arm.trigger === p.trigger &&
          arm.oldInstanceId !== this.firstProof.instanceId, 'ARM_IDENTITY');
        if (fault) {
          requireProof(fault.kind === 'native-first-projector-fault-v1' &&
            fault.nonce === p.nonce && fault.doId === this.firstProof.doId &&
            fault.firstInstanceId !== this.firstProof.instanceId &&
            fault.witnessId === arm.witness.id &&
            Number.isSafeInteger(fault.firstAckRevision) && fault.firstAckRevision > 0 &&
            fault.ack?.success === true && fault.ack.runId === p.runId &&
            fault.ack.revision === fault.firstAckRevision &&
            fault.triggerDropAcknowledged === true &&
            /^[a-f0-9]{64}$/u.test(fault.rowsDigest ?? '') &&
            /^[a-f0-9]{64}$/u.test(fault.headDigest ?? ''),
          'FAULT_IDENTITY');
          return { passthrough: true, faultConsumed: true };
        }
        requireProof(this.firstProof.domain.entries === 1 &&
          this.firstProof.alarm.entries === 0 && this.firstProof.special.entries === 0,
        'FIRST_DOMAIN_NOT_WITNESS');
        requireProof(request.method === 'POST' &&
          new URL(request.url).pathname === '/usage-project' &&
          new URL(request.url).searchParams.get('runId') === p.runId &&
          request.headers.get('content-type')?.includes('application/json'),
        'FIRST_DOMAIN_NOT_PROJECT');
        // The outer native gate is held before parsing the witness body.
        const parsed = await request.clone().json();
        requireProof(parsed && typeof parsed === 'object' &&
          !Array.isArray(parsed) && parsed.witness &&
          WITNESS_FIELDS.every((field) =>
            parsed.witness[field] === arm.witness[field]) &&
          Object.keys(parsed.witness).length === WITNESS_FIELDS.length,
        'REQUEST_WITNESS');
        this.assertIdle({ domainSelf: 1, fresh: true });
        const before = await this.readSql();
        const head = await this.readHead();
        this.assertTrigger(before);
        this.assertZero(before);
        requireProof(await digest(before.trigger.sql) === arm.triggerSqlDigest,
          'ARM_FENCE_CHANGED');
        const witness = this.assertAuthority(before, arm.run, arm.witness);
        requireProof(witness.delivery_status === 'dispatching' &&
          witness.attempts === 1 && witness.projected_revision === null &&
          safeString(witness.claim_token) && safeString(witness.claimed_at),
        'FIRST_CLAIM');
        requireProof(head.digest === arm.preHead.digest &&
          head.usageLedger.revision === arm.preHead.usageLedger.revision &&
          head.usageLedger.projectedRevision === arm.preHead.usageLedger.projectedRevision &&
          this.runId === p.runId && this.usageLedger?.phase === 'ready' &&
          this.usageLedger.revision === head.usageLedger.revision &&
          this.usageLedger.projectedRevision === head.usageLedger.projectedRevision,
        'HEAD_CHANGED_BEFORE_DROP');
        this.assertIdle({ domainSelf: 1, fresh: true });
        await this.firstProof.rawDb.exec(`DROP TRIGGER ${p.trigger}`);
        const dropped = await this.readSql();
        requireProof(dropped.trigger === null, 'TRIGGER_DROP_UNACKNOWLEDGED');
        this.assertZero(dropped);
        this.assertAuthority(dropped, arm.run, arm.witness);
        // This is the unmodified production endpoint; its own nested gates and D1 batch run here.
        const response = await super.fetch(request);
        requireProof(response.status >= 200 && response.status < 300, 'PRODUCTION_ACK_STATUS');
        const ack = await response.clone().json();
        requireProof(ack?.success === true && ack.runId === p.runId &&
          Number.isSafeInteger(ack.revision) && ack.revision > 0,
        'PRODUCTION_ACK_BODY');
        const after = await this.readSql();
        const projected = await this.readHead();
        this.assertAuthority(after, arm.run, arm.witness);
        this.assertCanonical(after);
        requireProof(projected.usageLedger.revision === ack.revision &&
          projected.usageLedger.projectedRevision === ack.revision &&
          this.proofCounters().nativeD1.active === 0 &&
          this.proofCounters().nativeWaitUntil.active === 0 &&
          !this.firstProof.deadline, 'PROJECTION_NOT_DURABLE');
        const rowsDigest = await digest({ meters: after.meters, rollups: after.rollups });
        const marker = { kind: 'native-first-projector-fault-v1', nonce: p.nonce,
          doId: this.firstProof.doId, instanceId: this.firstProof.instanceId,
          firstInstanceId: this.firstProof.instanceId,
          witnessId: arm.witness.id, firstAckRevision: ack.revision,
          ack: { success: ack.success, runId: ack.runId, revision: ack.revision },
          firstAck: { success: ack.success, runId: ack.runId, revision: ack.revision },
          rowsDigest, headDigest: projected.digest,
          projectedLedger: projected.usageLedger, triggerDropAcknowledged: true,
          meterCount: after.meters.length, rollupCount: after.rollups.length,
          assertionCount: after.assertions };
        await this.putMarker(FAULT_KEY, marker);
        lostAck = true;
        return { response };
      });
      if (result.passthrough) {
        const response = await super.fetch(request);
        if (result.faultConsumed && request.method === 'POST' &&
          new URL(request.url).pathname === '/usage-project' &&
          new URL(request.url).searchParams.get('runId') === p.runId) {
          // The persisted one-shot fault was read in this incoming request's gate.
          // Observe only this same request's genuine production response.
          const ack = await response.clone().json();
          requireProof(response.status >= 200 && response.status < 300 &&
            ack?.success === true && ack.runId === p.runId &&
            Number.isSafeInteger(ack.revision) && ack.revision > 0,
          'RETRY_PRODUCTION_ACK');
          console.log(JSON.stringify({ nativeFirstProjectorProbe: true,
            nonce: p.nonce, runId: p.runId, doId: this.firstProof.doId,
            instanceId: this.firstProof.instanceId, stage: 'usage-project-response',
            status: response.status, success: ack.success, revision: ack.revision,
            faultConsumed: true, domainEntries: this.firstProof.domain.entries }));
        }
        return response;
      }
      requireProof(lostAck, 'FAULT_NOT_PERSISTED');
      // Outside blockConcurrencyWhile so the successful production state survives this rejection.
      throw new Error(`GA_FIRST_USAGE_ACK_LOST_${p.nonce}`);
    }

    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.startsWith(PROOF_PREFIX)) {
        return counted(this.firstProof.special, async () => {
          requireProof(request.headers.get('X-First-Proof-Token') ===
            this.firstProof.env.token, 'PROOF_TOKEN');
          if (path === '/__first-proof/snapshot' && request.method === 'GET') {
            return Response.json(await this.proofSnapshot());
          }
          if (path === '/__first-proof/drain' && request.method === 'GET') {
            return Response.json(await this.proofDrain());
          }
          if (path === '/__first-proof/arm') return this.proofArm(request);
          throw new Error('GA_FIRST_PROJECTOR_RED_UNKNOWN_PROOF_ROUTE');
        });
      }
      return counted(this.firstProof.domain, () => this.proofFirstProject(request));
    }

    async alarm() {
      return counted(this.firstProof.alarm, () => super.alarm());
    }
  };
}

export const FirstProjectorRunNotifier = createFirstProjectorRunNotifier(RunNotifierDO);
