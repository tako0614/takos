// Node-only observer of this child's correlated native production response.
// It carries no Worker promise, SQL operation, or actor lifetime assumption.
export function createFirstProjectorObserver({ runId, nonce }) {
  if (typeof runId !== 'string' || typeof nonce !== 'string' || !runId || !nonce) {
    throw new Error('invalid first-projector observer identity');
  }
  let pending = '', failure;
  const responses = [];
  const fail = (message) => { failure ??= new Error(message); };
  return {
    feed(chunk) {
      if (failure) return;
      pending += Buffer.from(chunk).toString('utf8');
      if (Buffer.byteLength(pending) > 1024 * 1024) { fail('native first-projector line exceeds bound'); return; }
      for (;;) {
        const end = pending.indexOf('\n'); if (end < 0) break;
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        const start = line.indexOf('{'); if (start < 0) continue;
        let value; try { value = JSON.parse(line.slice(start)); } catch { continue; }
        if (value.nativeFirstProjectorProbe !== true || value.runId !== runId || value.nonce !== nonce) continue;
        if (value.stage !== 'usage-project-response' || !/^[0-9a-f]{64}$/u.test(value.doId ?? '') ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value.instanceId ?? '') || value.faultConsumed !== true ||
          value.success !== true || !Number.isSafeInteger(value.status) || value.status < 200 || value.status >= 300 ||
          !Number.isSafeInteger(value.revision) || value.revision < 1 ||
          !Number.isSafeInteger(value.domainEntries) || value.domainEntries < 1) {
          fail('invalid correlated native production response marker'); return;
        }
        if (responses.length >= 8 || responses.some((entry) => entry.revision === value.revision)) {
          fail('duplicate or excessive native production response marker'); return;
        }
        responses.push({ ...value });
      }
    },
    snapshot() {
      if (failure) throw failure;
      return responses.map((value) => ({ ...value }));
    },
    async response(revision) {
      const until = Date.now() + 2000;
      do {
        if (failure) throw failure;
        const found = responses.find((value) => value.revision === revision);
        if (found) return { ...found };
        await new Promise((done) => setTimeout(done, 5));
      } while (Date.now() < until);
      throw new Error('actual native production retry response marker missing');
    },
  };
}
