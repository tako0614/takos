import { StringDecoder } from 'node:string_decoder';

// Runtime output is a wake-up only. Callers separately verify native SQL,
// production callback bodies and exact physical Container destruction.
export function createRuntimeRecoveryObserver({ runId, containerIds, nonce,
  maxLineBytes = 1_048_576, maxRecords = 256 }) {
  if (typeof runId !== 'string' || !runId || typeof nonce !== 'string' || !nonce ||
      !Array.isArray(containerIds) || containerIds.length !== 2 ||
      containerIds.some((id) => typeof id !== 'string' || !id) ||
      new Set(containerIds).size !== 2 || !Number.isSafeInteger(maxRecords) || maxRecords < 1 ||
      !Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1)
    throw new Error('invalid bounded native recovery observer identity');
  const decoder = new StringDecoder('utf8');
  const records = [], waiters = new Set();
  let buffer = '', failure = null, ended = false;
  function fail(message) {
    failure ??= new Error(message);
    for (const waiter of waiters) waiter.reject(failure);
  }
  function matches(record, expected) {
    return record.kind === expected.kind && record.containerId === expected.containerId &&
      (expected.kind === 'control'
        ? record.path === expected.path && record.status === expected.status
        : record.stage === expected.stage);
  }
  function receive(value) {
    const kind = value.startsWith('{"nativeControlResponse":') ? 'control'
      : value.startsWith('{"nativeRecoveryStage":') ? 'stage' : null;
    if (!kind) return;
    let record;
    try { record = JSON.parse(value)[kind === 'control' ? 'nativeControlResponse' : 'nativeRecoveryStage']; }
    catch { fail('native recovery runtime marker is malformed'); return; }
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      fail('native recovery runtime marker is not a record'); return;
    }
    if (record.runId !== runId || record.observerNonce !== nonce ||
        !containerIds.includes(record.containerId)) return;
    if (typeof record.at !== 'string' || !Number.isFinite(Date.parse(record.at))) {
      fail('owned native recovery marker has invalid time'); return;
    }
    if (kind === 'control' && (typeof record.path !== 'string' ||
        !record.path.startsWith('/api/internal/v1/agent-control/') ||
        !Number.isInteger(record.status) || record.status < 100 || record.status > 599)) {
      fail('owned native control response has invalid fields'); return;
    }
    if (kind === 'stage' && (record.stage !== 'old-container-destroyed-before-tool-ack' ||
        record.containerId !== containerIds[0] || record.productionToolStatus !== 200 ||
        record.nativeDestroyAcknowledged !== true || record.successResponseForwarded !== false)) {
      fail('owned native ACK-loss stage lacks a genuine withheld-response witness'); return;
    }
    if (records.length >= maxRecords) { fail('native recovery record count exceeded finite bound'); return; }
    // Whitelist metadata; raw tool/checkpoint/body/token data never leaves here.
    const accepted = { kind, runId, containerId: record.containerId,
      at: record.at, receivedAt: new Date().toISOString(),
      ...(kind === 'control' ? { path: record.path, status: record.status }
        : { stage: record.stage, productionToolStatus: 200,
          nativeDestroyAcknowledged: true, successResponseForwarded: false }) };
    records.push(accepted);
    for (const waiter of waiters) if (matches(accepted, waiter.expected)) waiter.resolve(accepted);
  }
  function feed(chunk) {
    if (failure || ended) return;
    buffer += decoder.write(chunk);
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const value = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      if (Buffer.byteLength(value) > maxLineBytes) { fail('native recovery line exceeded finite bound'); return; }
      receive(value);
      if (failure) return;
    }
    if (Buffer.byteLength(buffer) > maxLineBytes) { buffer = ''; fail('native recovery line exceeded finite bound'); }
  }
  function end() {
    if (ended) return;
    ended = true; buffer += decoder.end();
    if (Buffer.byteLength(buffer) > maxLineBytes) fail('native recovery line exceeded finite bound');
    else if (buffer && !failure) receive(buffer);
    buffer = '';
    // Pending waits cannot survive this runtime. Previously captured records
    // remain inspectable but never establish a new stage after EOF.
    if (waiters.size) fail('native runtime stdout ended before required recovery stage');
  }
  async function waitFor(expected, deadline) {
    if (!expected || !containerIds.includes(expected.containerId) ||
        !['control', 'stage'].includes(expected.kind) ||
        (expected.kind === 'control' && (typeof expected.path !== 'string' || expected.status !== 200)) ||
        (expected.kind === 'stage' && expected.stage !== 'old-container-destroyed-before-tool-ack') ||
        !Number.isFinite(deadline)) throw new Error('invalid recovery wake-up expectation');
    if (failure) throw failure;
    if (Date.now() >= deadline) throw new Error('native recovery stage deadline expired');
    const captured = records.find((record) => matches(record, expected));
    if (captured) return { ...captured };
    if (ended) throw new Error('native runtime stdout ended before required recovery stage');
    let timer, waiter;
    try {
      const result = await new Promise((resolve, reject) => {
        waiter = { expected: { ...expected }, resolve, reject }; waiters.add(waiter);
        timer = setTimeout(() => reject(new Error('native recovery stage deadline expired')),
          Math.max(1, deadline - Date.now()));
      });
      if (failure) throw failure;
      if (Date.now() >= deadline) throw new Error('native recovery marker arrived after stage deadline');
      return { ...result };
    } finally { clearTimeout(timer); waiters.delete(waiter); }
  }
  return { feed, end, waitFor, snapshot: () => records.map((record) => ({ ...record })) };
}
