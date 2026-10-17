// These are the production checkpoint-save limits in executor-control-rpc.ts.
export const MAX_CHECKPOINT_BYTES = 16 * 1024 * 1024;
export const MAX_INLINE_CHECKPOINT_BYTES = 512 * 1024;

const R2_PREFIX = 'r2:';
const CHECKPOINT_KEY_SUFFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/;

function fail(reason) {
  // Keep serialized checkpoint text, object keys, and caller errors out of logs.
  throw new Error(`Native checkpoint witness: ${reason}`);
}

async function sha256(bytes) {
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}

function validateExpected(expected) {
  if (!plainObject(expected) ||
      !requiredId(expected.runId) ||
      !requiredId(expected.serviceId) ||
      !Number.isSafeInteger(expected.leaseVersion) || expected.leaseVersion < 0 ||
      !requiredId(expected.pendingToolCallId) ||
      !plainObject(expected.usage)) fail('invalid expected identity or usage');
  for (const name of ['inputTokens', 'outputTokens', 'cachedInputTokens']) {
    if (!Number.isSafeInteger(expected.usage[name]) || expected.usage[name] < 0) {
      fail('invalid expected identity or usage');
    }
  }
  if (expected.usage.cachedInputTokens > expected.usage.inputTokens) {
    fail('invalid expected identity or usage');
  }
}

function exactR2Key(stored, expected) {
  const key = stored.slice(R2_PREFIX.length);
  const prefix = `agent-checkpoints/${encodeURIComponent(expected.runId)}/${encodeURIComponent(expected.serviceId)}/${expected.leaseVersion}/`;
  if (!key.startsWith(prefix) || !CHECKPOINT_KEY_SUFFIX.test(key.slice(prefix.length))) {
    fail('checkpoint pointer does not match expected Run and lease');
  }
  return key;
}

async function boundedObjectBytes(key, readObject) {
  if (typeof readObject !== 'function') fail('native object reader is required');
  let object;
  try {
    // The reader must return native object metadata and an unconsumed body stream.
    // It must not call arrayBuffer()/text() before this size check.
    object = await readObject(key);
  } catch {
    fail('native checkpoint object lookup failed');
  }
  if (!object || !Number.isSafeInteger(object.size) ||
      object.size <= MAX_INLINE_CHECKPOINT_BYTES || object.size > MAX_CHECKPOINT_BYTES) {
    fail('native checkpoint object size is invalid');
  }
  if (!object.body || typeof object.body.getReader !== 'function') {
    fail('native checkpoint object body stream is missing');
  }

  const reader = object.body.getReader();
  const chunks = [];
  let total = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      if (!(value instanceof Uint8Array)) fail('native checkpoint object stream is invalid');
      total += value.byteLength;
      if (total > object.size || total > MAX_CHECKPOINT_BYTES) {
        fail('native checkpoint object exceeded declared size or limit');
      }
      chunks.push(value.slice());
    }
  } catch {
    fail('native checkpoint object stream failed or exceeded limit');
  } finally {
    if (!complete) {
      try { await reader.cancel(); } catch { /* best effort */ }
    }
    try { reader.releaseLock(); } catch { /* best effort */ }
  }
  if (total !== object.size) fail('native checkpoint object size changed');
  const serialized = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    serialized.set(chunk, offset);
    offset += chunk.length;
  }
  return serialized;
}

function validateCheckpoint(serialized, expected) {
  let stored;
  try {
    stored = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(serialized));
  } catch {
    fail('checkpoint JSON is invalid');
  }
  if (!plainObject(stored) || !plainObject(stored.checkpoint) || !plainObject(stored.usage)) {
    fail('checkpoint envelope is invalid');
  }
  const { checkpoint, usage } = stored;
  const state = checkpoint.state_json;
  if (!plainObject(state) ||
      checkpoint.graph_id !== 'external-context-v1' ||
      checkpoint.current_node !== 'execute_tools' ||
      checkpoint.status !== 'running' ||
      !requiredId(checkpoint.loop_id) || !requiredId(checkpoint.session_id) ||
      checkpoint.loop_id !== state.loop_id ||
      checkpoint.session_id !== state.session_id ||
      state.execution_profile !== 'external_context') {
    fail('checkpoint is not the pending external-context execute_tools state');
  }
  const pending = state.pending_tool_calls;
  if (!Array.isArray(pending) || pending.length !== 1 ||
      !plainObject(pending[0]) || pending[0].id !== expected.pendingToolCallId) {
    fail('checkpoint pending tool call does not match');
  }
  for (const name of ['inputTokens', 'outputTokens', 'cachedInputTokens']) {
    if (usage[name] !== expected.usage[name]) fail('checkpoint usage does not match');
  }
  return {
    graphId: checkpoint.graph_id,
    node: checkpoint.current_node,
    status: checkpoint.status,
    loopId: checkpoint.loop_id,
    sessionId: checkpoint.session_id,
    pendingToolCallIds: [pending[0].id],
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
    },
  };
}

/**
 * Read the exact D1 engine_checkpoint string from the caller's native Run row.
 * readObject(key) must return an R2-style { size, body: ReadableStream } without
 * pre-reading the body. Only witness is safe to log. rawSerialized stays in
 * caller memory for exact before/after comparison; never serialize or log it.
 */
export async function captureCheckpointWitness({ stored, expected, readObject } = {}) {
  validateExpected(expected);
  if (typeof stored !== 'string' || stored.length === 0) fail('stored checkpoint is missing');

  let serialized;
  let storage;
  if (stored.startsWith(R2_PREFIX)) {
    storage = 'r2';
    serialized = await boundedObjectBytes(exactR2Key(stored, expected), readObject);
  } else {
    storage = 'inline';
    serialized = new TextEncoder().encode(stored);
    if (serialized.length > MAX_INLINE_CHECKPOINT_BYTES) {
      fail('inline checkpoint exceeds production limit');
    }
  }
  if (serialized.length === 0 || serialized.length > MAX_CHECKPOINT_BYTES) {
    fail('checkpoint serialized size is invalid');
  }

  const selectors = validateCheckpoint(serialized, expected);
  const witness = Object.freeze({
    storage,
    storedSha256: await sha256(new TextEncoder().encode(stored)),
    serializedSha256: await sha256(serialized),
    serializedBytes: serialized.length,
    ...selectors,
    pendingToolCallIds: Object.freeze(selectors.pendingToolCallIds),
    usage: Object.freeze(selectors.usage),
  });
  // Keep raw comparison bytes available to the caller but out of ordinary
  // object serialization. The caller must still log only capture.witness.
  return Object.freeze(Object.defineProperty({ witness }, 'rawSerialized', {
    value: serialized,
    enumerable: false,
  }));
}

/**
 * The caller retains both raw D1 strings and beforeCapture.rawSerialized in
 * memory. Re-read the native object after CAS: a stable r2: pointer alone
 * cannot prove unchanged object bytes. expected remains the checkpoint's
 * origin service/lease (7) even after the Run lease changes to 8.
 */
export async function assertCheckpointUnchanged({
  beforeStored, beforeCapture, afterStored, expected, readObject,
} = {}) {
  if (typeof beforeStored !== 'string' || beforeStored !== afterStored) {
    fail('stored D1 checkpoint changed across lease CAS');
  }
  if (!plainObject(beforeCapture) || !plainObject(beforeCapture.witness) ||
      !(beforeCapture.rawSerialized instanceof Uint8Array) ||
      !/^[0-9a-f]{64}$/.test(beforeCapture.witness.storedSha256) ||
      !/^[0-9a-f]{64}$/.test(beforeCapture.witness.serializedSha256)) {
    fail('prior checkpoint witness is invalid');
  }
  if (beforeCapture.witness.storedSha256 !== await sha256(new TextEncoder().encode(beforeStored)) ||
      beforeCapture.witness.serializedSha256 !== await sha256(beforeCapture.rawSerialized) ||
      beforeCapture.witness.serializedBytes !== beforeCapture.rawSerialized.length) {
    fail('prior checkpoint witness does not match caller bytes');
  }
  const afterCapture = await captureCheckpointWitness({ stored: afterStored, expected, readObject });
  const beforeWitness = beforeCapture.witness;
  const afterWitness = afterCapture.witness;
  if (beforeWitness.storedSha256 !== afterWitness.storedSha256 ||
      beforeWitness.serializedSha256 !== afterWitness.serializedSha256 ||
      beforeWitness.serializedBytes !== afterWitness.serializedBytes ||
      beforeWitness.storage !== afterWitness.storage ||
      beforeWitness.loopId !== afterWitness.loopId ||
      beforeWitness.sessionId !== afterWitness.sessionId ||
      beforeCapture.rawSerialized.some((byte, index) => byte !== afterCapture.rawSerialized[index])) {
    fail('resolved checkpoint changed across lease CAS');
  }
  return afterCapture;
}
