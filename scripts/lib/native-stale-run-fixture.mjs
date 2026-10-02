/** Build source for a temporary Miniflare Worker which delegates every
 * production event to src/worker/index.ts. The fixture routes only provide
 * deterministic D1 seeding/readback and observation of the native queue send.
 */
export function nativeStaleRunFixtureSource(workerPath, schemaGatePath, migrationPath) {
  return `import production, { RunNotifierDO } from ${JSON.stringify(workerPath)};
import { ensureSchemaReady } from ${JSON.stringify(schemaGatePath)};
import { EMBEDDED_MIGRATIONS } from ${JSON.stringify(migrationPath)};
export { RunNotifierDO };

const OWNER = "native-stale-owner";
const WORKSPACE = "native-stale-private-workspace";
const ISSUER = "https://issuer.native-stale.example";
const SUBJECT = "native-stale-owner-subject";
const PROVIDER_SUB = ISSUER + "#" + SUBJECT;
const RUNS = ["cron-stale", "queue-stale", "fresh-running", "terminal"];
const emitted = [];
const emittedSnapshots = [];
const dispatches = [];
const dispatchSnapshots = [];
const ACKS = [];
function err(error) { return { name: error?.name, message: String(error?.message ?? error), stack: error?.stack }; }
async function execute(db, sql, values = []) {
  let statement = db.prepare(sql);
  if (values.length) statement = statement.bind(...values);
  return statement.run();
}
async function read(db, sql, values = []) {
  let statement = db.prepare(sql);
  if (values.length) statement = statement.bind(...values);
  return statement.first();
}
async function seed(db) {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const checkpoint = JSON.stringify({ version: 2, opaque: { provider: "fixture", cursor: "keep-me", nested: [1, 2, 3] }, cumulativeUsage: { inputTokens: 41, outputTokens: 17 } });
  await execute(db, "INSERT INTO accounts (id,type,status,name,slug,owner_account_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", [OWNER,"user","active","Native owner","native-stale-owner",OWNER,now,now]);
  await execute(db, "INSERT INTO accounts (id,type,status,name,slug,owner_account_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)", [WORKSPACE,"team","active","Private fixture Workspace","native-stale-workspace",OWNER,now,now]);
  await execute(db, "INSERT INTO auth_identities (id,user_id,provider,provider_sub,linked_at,last_login_at) VALUES (?,?,?,?,?,?)", ["native-stale-identity",OWNER,"oidc",PROVIDER_SUB,now,now]);
  await execute(db, "INSERT INTO account_memberships (id,account_id,member_id,role,status,created_at,updated_at) VALUES (?,?,?,'owner','active',?,?)", ["native-stale-membership",WORKSPACE,OWNER,now,now]);
  await execute(db, "INSERT INTO account_settings (account_id,private_account,created_at,updated_at) VALUES (?,1,?,?)", [WORKSPACE,now,now]);
  await execute(db, "INSERT INTO threads (id,account_id,title,next_message_sequence,created_at,updated_at) VALUES (?,?,'Native stale Run proof',1,?,?)", ["native-stale-thread",WORKSPACE,now,now]);
  for (const id of RUNS) {
    const stale = id === "cron-stale";
    const staleLease = id === "cron-stale" || id === "queue-stale";
    const terminal = id === "terminal";
    const status = terminal ? "completed" : (stale ? "running" : "running");
    const lease = staleLease ? 7 : (id === "fresh-running" ? 11 : 3);
    await execute(db, "INSERT INTO runs (id,thread_id,account_id,requester_account_id,agent_type,model,status,input,usage,service_id,service_heartbeat,lease_version,engine_checkpoint,engine_checkpoint_updated_at,started_at,completed_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [id,"native-stale-thread",WORKSPACE,OWNER,"default","persisted-model",status,"{\\"prompt\\":\\"preserve\\"}",JSON.stringify({inputTokens:41,outputTokens:17}), terminal ? "terminal-service" : (staleLease ? "old-service" : "fresh-service"), terminal ? now : (stale ? old : now),lease,checkpoint,old,old,terminal ? now : null,stale ? old : now]);
  }
  await execute(db, "INSERT INTO tool_operations (id,run_id,operation_key,tool_name,status,result_output,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?)", ["completed-op","queue-stale","op-completed","fixture.completed","completed","{\\"ok\\":true}",old,old]);
  await execute(db, "INSERT INTO tool_operations (id,run_id,operation_key,tool_name,status,created_at) VALUES (?,?,?,?,?,?)", ["pending-op","queue-stale","op-pending","fixture.pending","pending",old]);
  return { old, now, checkpoint };
}
async function snapshot(db, id) {
  const run = await read(db, "SELECT * FROM runs WHERE id=?", [id]);
  const operations = (await db.prepare("SELECT * FROM tool_operations WHERE run_id=? ORDER BY id").bind(id).all()).results;
  const receipts = (await db.prepare("SELECT * FROM run_events WHERE run_id=? AND type='executor_dispatch_receipt' ORDER BY event_key").bind(id).all()).results;
  return { run, operations, receipts };
}
async function authoritySnapshot(db) {
  return {
    owner: await read(db, "SELECT * FROM accounts WHERE id=?", [OWNER]),
    workspace: await read(db, "SELECT * FROM accounts WHERE id=?", [WORKSPACE]),
    membership: await read(db, "SELECT * FROM account_memberships WHERE id='native-stale-membership'"),
    privateSettings: await read(db, "SELECT * FROM account_settings WHERE account_id=?", [WORKSPACE]),
    oidcIdentity: await read(db, "SELECT * FROM auth_identities WHERE id='native-stale-identity'"),
  };
}
function wrappedEnv(env) {
  const runQueue = Object.assign(Object.create(null), { send: async (body, options) => { emitted.push(structuredClone(body)); emittedSnapshots.push({ body: structuredClone(body), beforeQueueSend: await snapshot(env.DB, body.runId) }); return env.RUN_QUEUE.send(body, options); } });
  return { ...env, RUN_QUEUE: runQueue, EXECUTOR_HOST: { fetch: async (request) => {
    const body = await request.clone().json(); dispatches.push(body); dispatchSnapshots.push({ dispatch: body, beforeHostResponse: await snapshot(env.DB, body.runId) });
    return Response.json({ accepted: true, transport: "fixture-stub-no-container" }, { headers: { "X-Takos-Executor-Container-Id": "native-stale-proof-no-container" } });
  } } };
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    try {
      if (path === "/__native/seed") {
        const fixture = await seed(env.DB);
        const ledger = (await env.DB.prepare("SELECT name,checksum,applied_at FROM _takos_opentofu_migrations ORDER BY rowid").all()).results;
        const baselineRuns = { "fresh-running": await snapshot(env.DB, "fresh-running"), terminal: await snapshot(env.DB, "terminal") };
        const authority = await authoritySnapshot(env.DB);
        return Response.json({ fixture, migrations: EMBEDDED_MIGRATIONS, ledger, baselineRuns, authority });
      }
      if (path === "/__native/admit") {
        const schema = await ensureSchemaReady(env.DB);
        const ledger = schema.ledgerTable === "_takos_opentofu_migrations"
          ? (await env.DB.prepare("SELECT name,checksum,applied_at FROM _takos_opentofu_migrations ORDER BY rowid").all()).results
          : [];
        const lock = await env.DB.prepare("SELECT id,status,holder,lease_expires_at,updated_at,detail FROM _takos_runtime_migration_lock WHERE id=1").first();
        const response = { schema, ledger, lock, migrations: EMBEDDED_MIGRATIONS };
        return Response.json(response, { status: schema.state === "ready" ? 200 : schema.state === "pending" || schema.state === "applying" ? 202 : 500 });
      }
      if (path === "/__native/readback") {
        const runs = {};
        for (const id of RUNS) runs[id] = await snapshot(env.DB, id);
        return Response.json({ runs, emitted, emittedSnapshots, dispatches, dispatchSnapshots, acknowledgements: ACKS, authority: await authoritySnapshot(env.DB) });
      }
      if (path === "/__native/age-queue-run") {
        const old = new Date(Date.now() - 6 * 60 * 1000).toISOString();
        await execute(env.DB, "UPDATE runs SET service_heartbeat=? WHERE id='queue-stale'", [old]);
        return Response.json({ serviceHeartbeat: old });
      }
      if (path === "/__native/enqueue") {
        const body = await request.json();
        const beforeQueueSend = await snapshot(env.DB, body.runId);
        emitted.push(structuredClone(body));
        emittedSnapshots.push({ body: structuredClone(body), beforeQueueSend });
        await env.RUN_QUEUE.send(body);
        return Response.json({ accepted: true, runId: body.runId });
      }
      return await production.fetch(request, env, { waitUntil() {} });
    } catch (error) { return Response.json({ error: err(error) }, { status: 599 }); }
  },
  async scheduled(controller, env, ctx) { return production.scheduled(controller, wrappedEnv(env), ctx); },
  async queue(batch, env, ctx) {
    const messages = batch.messages.map((message) => ({
      body: message.body,
      id: message.id,
      timestamp: message.timestamp ?? new Date(),
      attempts: message.attempts ?? 1,
      ack() { ACKS.push({ id: message.body?.runId, action: "ack" }); return message.ack?.(); },
      retry(options) { ACKS.push({ id: message.body?.runId, action: "retry", options: options ?? null }); return message.retry?.(options); },
    }));
    return production.queue({ ...batch, messages }, wrappedEnv(env), ctx);
  },
};
`;
}
