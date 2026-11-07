import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const scenarios = {
  rejected: "a saved chat message can retry a rejected reply without being saved twice",
  draft: "an unknown reply preserves its fence when a newer draft is sent",
  route: "an unknown reply survives navigation away and back",
  unrelated: "an unrelated active reply does not settle an unknown attempt",
  attachment: "a message ACK missing its uploaded attachment stays unconfirmed",
  rate: "a message postcommit 429 stays unconfirmed",
  remount: "an unknown reply survives conversation remount in the same app",
  pending: "a send settles into its original conversation after navigation",
  confirm: "a new reply confirmation retires across navigation away and back",
  history: "a malformed history response cannot confirm reply status",
  positive: "an accepted reply connects to the exact acknowledged Run",
  restore: "an unconfirmed attachment draft restores only by current explicit intent",
  principal: "local recovery receipts clear on a principal boundary",
  confirmed: "a deliberate new reply does not resend the saved message or overwrite a newer draft",
  dismiss: "discarding uncertainty requires explicit intent and keeps the new draft unsent",
  message202: "an asynchronous message acceptance is not a durable message ACK",
  run202: "an asynchronous Run acceptance is not an exact Run ACK",
  messageRejected: "a definite message rejection restores its unsent draft for ordinary retry",
  late401: "a retired reply authentication failure does not navigate the new view",
  current401: "a current reply authentication failure retains login navigation",
  samePrincipal: "a repeated principal snapshot preserves the same user recovery receipt",
  pendingSuccess: "a background accepted reply releases its local receipt and resumes through history",
  authRefresh: "an actual auth read failure preserves same user recovery after refetch",
  authPending: "a message ACK crossing an auth read failure does not start a Run",
  conversation: "a new reply action describes the current conversation after another client appends a message",
  earlyReturn: "a returning view can reconnect an accepted Run missed by its initial history read",
  historyReturn: "a returning conversation keeps its fresh history after the old response finishes",
  history401: "a retired history authentication response cannot navigate the returning conversation",
  historyError: "a retired history failure cannot replace the returning conversation error state",
  historyDisposed: "an unmounted conversation ignores its late history authentication response",
  historyCurrent401: "a current history authentication failure retains login navigation and error feedback",
  historyFocus: "a newer same-thread focus keeps its history when the old body finishes",
  cancelLate401: "a retired Cancel authentication response cannot navigate another conversation",
  cancelLateError: "a retired Cancel failure cannot replace another conversation error or draft",
  cancelReturn: "a Cancel response stays retired after leaving and returning to the same conversation",
  cancelUnmount: "an unmounted conversation ignores its late Cancel authentication response",
  cancelCurrent401: "a current Cancel authentication failure retains login and error feedback",
  cancelCurrentOK: "a current Cancel ACK clears its pending control without inventing Run completion",
  cancelOverlap: "an old Cancel settlement cannot unlock a newer conversation cancellation",
  cancelOverlapAck: "an old Cancel ACK cannot unlock a newer conversation cancellation",
  cancelFocus401: "a retired Cancel authentication response cannot navigate a newer focus in the same conversation",
  cancelFocusError: "a retired Cancel failure cannot affect a newer focus or its next cancellation",
  pollingAbort: "an aborted message refresh cannot navigate the new conversation after a terminal WebSocket event",
  pollingFocus: "an aborted message refresh cannot navigate a newer focus in the same conversation",
  pollingDispose: "a disposed message refresh cannot navigate after its body is aborted",
  pollingCurrent401: "a current message refresh authentication failure retains login navigation",
  pollingCurrentOK: "a current message refresh adopts the saved reply after a terminal WebSocket event",
  runReadLate401: "a retired Run status authentication response cannot navigate the new conversation",
  runReadLateTerminal: "a retired completed Run status cannot stop the newer conversation Run",
  runReadFocus: "a retired Run status cannot navigate a newer focus before its connection frame arrives",
  runReadDispose: "a disposed Run status read cannot navigate after its body finishes",
  runReadCurrent401: "a current Run status authentication failure retains login navigation",
  runReadCurrentActive: "a current active Run status refreshes messages and keeps its controls",
  runReadCurrentTerminal: "a current completed Run status adopts terminal state and messages",
  runReadMismatched: "an unmatched Run status payload cannot replace the current Run",
  runReadWatchdog503: "an unavailable Run status watchdog keeps the current WebSocket usable",
  closeLate401: "a retired transport-close authentication response cannot navigate another conversation",
  closeLateTerminal: "a retired transport-close completion body cannot stop another conversation Run",
  closeFocus: "a retired transport-close response cannot navigate a newer focus of the same Run",
  closeDispose: "a disposed transport-close read cannot navigate after its response arrives",
  closeCurrent401: "a current transport-close authentication failure retains sign-in and error feedback",
  closeCurrentTerminal: "a current transport-close completion adopts its final messages",
  closeCurrentActive: "a current active transport-close status reconnects the exact Run",
  closeCurrent503: "an unavailable transport-close status retries the current disconnected Run",
  closeMismatched: "an unmatched transport-close Run payload cannot complete the current Run",
  closeReturnActive: "a retired transport-close read cannot reconnect over a returning Run connection",
  closeQueuedReconnect: "a queued transport-close retry cannot replace a returning Run connection",
  retryBackoff: "repeated failed fallback connections retain their exponential retry backoff",
  retryWireError: "a data-bearing SSE Run error still completes the Run and shows its error",
  retryWireMessage: "a live SSE message still updates the current streaming reply",
  retryNewRun: "a new conversation resets the failed connection retry budget",
  retryTransportError: "an SSE transport error keeps the current Run active for retry",
  authCloseCode: "an authentication WebSocket close code returns to sign-in without another Run read",
  authCloseReason: "an authentication WebSocket close reason reaches the existing sign-in guard",
  authClosePolicy: "the existing policy close code reaches the sign-in guard without retry",
};
type Scenario = keyof typeof scenarios;
for (const mode of Object.keys(scenarios) as Scenario[]) test(scenarios[mode], async () => {
  if (process.env.TAKOS_CHAT_SEND_UI_PROCESS === mode) {
    await verifySendRecovery(mode); return;
  }
  const child = Bun.spawn([process.execPath, "test", import.meta.path, "--test-name-pattern", `^${scenarios[mode]}$`], {
    env: { ...process.env, TAKOS_CHAT_SEND_UI_PROCESS: mode },
    stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 30_000,
  });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    console.info(`Compiled send recovery UI: ${stderr.split("\n").filter((line) => /^\s*\d+ (?:pass|fail|expect\(\) calls)/.test(line)).map((line) => line.trim()).join("; ")}`);
    expect(code).toBe(0);
  } finally { if (child.exitCode === null) child.kill(); }
}, 45_000);

async function verifySendRecovery(mode: Scenario) {
  if (mode.startsWith("retry")) {
    const child = Bun.spawn(["node", resolve(import.meta.dir, "fixtures/chat-send-recovery/sse-runtime.mjs"), mode], {
      env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 25_000,
    });
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
      expect(code).toBe(0);
    } finally { if (child.exitCode === null) child.kill(); }
    return;
  }
  const authCloseLifetime = mode.startsWith("authClose");
  const closeLifetime = mode.startsWith("close");
  const closeStreamBody = ["closeLateTerminal", "closeCurrentTerminal", "closeMismatched", "closeReturnActive", "closeQueuedReconnect"].includes(mode);
  const runReadLifetime = mode.startsWith("runRead");
  const pollingLifetime = mode.startsWith("polling");
  const cancelLifetime = mode.startsWith("cancel");
  const cancelOverlap = mode === "cancelOverlap" || mode === "cancelOverlapAck";
  const cancelFocus = mode === "cancelFocus401" || mode === "cancelFocusError";
  const historyLifetime = ["historyReturn", "history401", "historyError", "historyDisposed", "historyCurrent401", "historyFocus"].includes(mode);
  const [{ parseHTML }, { build }, { default: solid }, { createContext, runInContext }] = await Promise.all([
    import("linkedom"), import("vite"), import("vite-plugin-solid"), import("node:vm"),
  ]);
  const output = await mkdtemp(join(tmpdir(), "takos-send-recovery-ui-"));
  const messages: { id: string; thread_id: string; role: string; content: string; metadata: string; sequence: number; created_at: string }[] = [];
  const attempts: { method: string; path: string }[] = [];
  let runPosts = 0, historyReads = 0, subscriptions = 0;
  let messagePosts = 0;
  const runModels: string[] = [];
  let authStatus = 200;
  let releaseRun!: () => void;
  const runGate = new Promise<void>((yes) => { releaseRun = yes; });
  let releaseHistory!: () => void;
  const historyGate = new Promise<void>((yes) => { releaseHistory = yes; });
  let historyParsesStarted = 0, historyParsesDone = 0;
  const historyWindows: { limit: string | null; offset: string | null }[] = [];
  let releaseCancel!: () => void;
  const cancelGate = new Promise<void>((yes) => { releaseCancel = yes; });
  let releaseSecondCancel!: () => void;
  const secondCancelGate = new Promise<void>((yes) => { releaseSecondCancel = yes; });
  let cancelParsesStarted = 0, cancelParsesDone = 0;
  const cancelPosts: string[] = [];
  let releaseMessages!: () => void;
  const messagesGate = new Promise<void>((yes) => { releaseMessages = yes; });
  let messageProducer = Promise.resolve();
  let messageReads = 0, messageParsesStarted = 0, messageParsesDone = 0, messageAborts = 0;
  const messageParseErrors: string[] = [];
  let completeRun: (() => void) | undefined;
  let releaseRunRead!: () => void;
  const runReadGate = new Promise<void>((yes) => { releaseRunRead = yes; });
  let runReadProducer = Promise.resolve();
  const runReadRequests: string[] = [];
  let oldRunReadStarted = 0, oldRunReadDone = 0, newRunReadDone = 0;
  let runReadResponses = 0, runReadSocketCount = 0, runReadClosed = 0;
  let resumeRunConnected: (() => void) | undefined;
  let sendLiveMessage: (() => void) | undefined;
  let closeTransport: (() => void) | undefined;
  let releaseCloseRead!: () => void;
  const closeReadGate = new Promise<void>((yes) => { releaseCloseRead = yes; });
  const closeReadRequests: string[] = [];
  let closeReadDone = 0;
  let closeParsesStarted = 0, closeParsesDone = 0;
  let closeReadProducer = Promise.resolve();
  let closeAuthSocket: (() => void) | undefined;
  let authCloseReads = 0;
  const run = { id: "unrelated-run", thread_id: "thread-a", space_id: "space-a", root_thread_id: "thread-a", root_run_id: "unrelated-run", parent_run_id: null, child_thread_id: null, session_id: null, agent_type: "default", model: "synthetic-model", status: "queued", input: "{}", output: null, error: null, usage: "{}", started_at: null, completed_at: null, created_at: "2026-11-07T00:00:00Z" };
  const otherRun = { ...run, id: "second-run", thread_id: cancelFocus ? "thread-a" : "thread-b", root_thread_id: cancelFocus ? "thread-a" : "thread-b", root_run_id: "second-run" };
  let activeRun: (Omit<typeof run, "completed_at"> & { completed_at: string | null }) | null = cancelLifetime || pollingLifetime || runReadLifetime || closeLifetime || authCloseLifetime ? run : null;
  const uploaded = { id: "attachment-1", name: "draft.txt", path: "/chat-attachments/thread-a/draft.txt", mime_type: "text/plain", size: 5 };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request, server) {
    const path = new URL(request.url).pathname;
    attempts.push({ method: request.method, path });
    if (request.method === "GET" && path === "/api/me") return authStatus === 200
      ? Response.json({ username: "synthetic-owner", email: "synthetic@example.invalid", name: "Synthetic account", picture: null, setup_completed: true })
      : Response.json({ error: "Synthetic auth read unavailable" }, { status: authStatus });
    if (request.method === "GET" && path === "/api/me/settings") return Response.json({ setup_completed: true, auto_update_enabled: false, private_account: false, activity_visibility: "private", ai_model: "synthetic-model", available_models: [] });
    if (request.method === "GET" && path === "/api/spaces") return Response.json({ spaces: [] });
    if (request.method === "GET" && path === "/api/runtime/capabilities") return Response.json({ capabilities: { vectorSearch: "disabled", agentContainers: "external-host" } });
    if (request.method === "GET" && path === "/api/spaces/space-a/model") return Response.json({ model: "synthetic-model", available_models: { openai: ["synthetic-model"], anthropic: [], google: [] } });
    if (request.method === "GET" && /^\/api\/runs\/[^/]+\/ws$/.test(path)) {
      if (server.upgrade(request)) return;
      return new Response(null, { status: 400 });
    }
    if (authCloseLifetime && request.method === "GET" && /^\/api\/runs\/[^/]+$/.test(path)) {
      authCloseReads++;
      return Response.json({ error: { code: "SYNTHETIC_UNAVAILABLE", message: "Synthetic status read unavailable after auth close" } }, { status: 503 });
    }
    if (closeLifetime && request.method === "GET" && /^\/api\/runs\/[^/]+$/.test(path)) {
      closeReadRequests.push(path);
      if (closeStreamBody) {
        const terminal = !["closeReturnActive", "closeQueuedReconnect"].includes(mode);
        if (terminal && mode !== "closeMismatched") activeRun = { ...run, status: "completed", completed_at: "2026-11-07T00:00:01Z" };
        const payload = JSON.stringify({ run: mode === "closeMismatched" ? { ...run, id: "unmatched-run", status: "completed" } : terminal ? activeRun : run });
        let open = true;
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode(payload.slice(0, 1)));
          closeReadProducer = closeReadGate.then(() => { if (open) { controller.enqueue(new TextEncoder().encode(payload.slice(1))); controller.close(); open = false; } });
        }, cancel() { open = false; } }), { headers: { "content-type": "application/json" } });
      }
      await closeReadGate;
      if (mode === "closeCurrentActive") return Response.json({ run });
      return mode === "closeCurrent503"
        ? Response.json({ error: { code: "SYNTHETIC_UNAVAILABLE", message: "Synthetic close status unavailable" } }, { status: 503 })
        : Response.json({ error: { code: "UNAUTHENTICATED", message: "Synthetic close status authentication failure" } }, { status: 401 });
    }
    if (runReadLifetime && request.method === "GET" && /^\/api\/runs\/[^/]+$/.test(path)) {
      runReadRequests.push(path);
      if (path.endsWith("/second-run")) return Response.json({ run: otherRun });
      if (runReadRequests.filter((value) => value.endsWith("/unrelated-run")).length > 1) return mode === "runReadWatchdog503"
        ? Response.json({ error: { code: "SYNTHETIC_UNAVAILABLE", message: "Synthetic Run read unavailable" } }, { status: 503 })
        : Response.json({ run });
      const terminal = ["runReadLateTerminal", "runReadCurrentTerminal"].includes(mode);
      const status = ["runReadCurrentActive", "runReadCurrentTerminal", "runReadLateTerminal", "runReadMismatched", "runReadWatchdog503"].includes(mode) ? 200 : 401;
      if (terminal) activeRun = { ...run, status: "completed", completed_at: "2026-11-07T00:00:01Z" };
      const payload = JSON.stringify(status === 401
        ? { error: { code: "UNAUTHENTICATED", message: "Synthetic Run status authentication failure" } }
        : { run: mode === "runReadMismatched" ? { ...run, id: "unmatched-run", status: "completed" } : terminal ? activeRun : run });
      let open = true;
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(payload.slice(0, 1)));
        runReadProducer = runReadGate.then(() => { if (open) { controller.enqueue(new TextEncoder().encode(payload.slice(1))); controller.close(); open = false; } });
      }, cancel() { open = false; } }), { status, headers: { "content-type": "application/json" } });
    }
    if (request.method === "GET" && /^\/api\/runs\/[^/]+$/.test(path)) return Response.json({ run: cancelLifetime ? path.endsWith("/second-run") ? otherRun : run : activeRun ?? run });
    if (request.method === "GET" && /^\/api\/threads\/thread-[ab]\/history$/.test(path)) {
      historyReads++;
      const body = { messages: messages.filter((message) => message.thread_id === path.split("/")[3]), runs: [], focus: null, activeRun, pendingSessionDiff: null, taskContext: null };
      if (runReadLifetime || closeLifetime || authCloseLifetime) {
        const thread = path.split("/")[3]!;
        body.activeRun = thread === "thread-a" ? activeRun && ["pending", "queued", "running"].includes(activeRun.status) ? activeRun : null : otherRun;
        body.messages = [{ id: `history-${thread}`, thread_id: thread, role: "user", content: thread === "thread-a" ? "Current A Run view" : "Current B Run view", metadata: "{}", sequence: 1, created_at: "2026-11-07T00:00:00Z" }];
        if (new URL(request.url).searchParams.get("offset") === "200") body.messages[0]!.content = "Focused A Run view";
      }
      if (pollingLifetime) {
        const thread = path.split("/")[3]!;
        body.activeRun = activeRun?.thread_id === thread && ["pending", "queued", "running"].includes(activeRun.status) ? activeRun : null;
        body.messages = [{ id: `history-${thread}`, thread_id: thread, role: "user", content: thread === "thread-a" ? "Current A refresh view" : "Current B refresh view", metadata: "{}", sequence: 1, created_at: "2026-11-07T00:00:00Z" }];
        if (new URL(request.url).searchParams.get("offset") === "200") body.messages[0]!.content = "Focused A refresh view";
      }
      if (cancelLifetime) {
        const thread = path.split("/")[3]!;
        body.activeRun = activeRun?.thread_id === thread ? activeRun : null;
        if (cancelOverlap && thread === "thread-b") body.activeRun = otherRun;
        body.messages = [{ id: `history-${thread}`, thread_id: thread, role: "user", content: thread === "thread-a" ? "Current A cancellation view" : "Current B cancellation view", metadata: "{}", sequence: 1, created_at: "2026-11-07T00:00:00Z" }];
        if (cancelFocus && activeRun?.id === otherRun.id) body.messages[0]!.content = "Focused A cancellation view";
      }
      if (historyLifetime) {
        const query = new URL(request.url).searchParams;
        historyWindows.push({ limit: query.get("limit"), offset: query.get("offset") });
        body.messages = [{ id: `history-${historyReads}`, thread_id: path.split("/")[3]!, role: "user", content: historyReads === 1 ? "Old A snapshot" : path.includes("thread-a") ? "Current A snapshot" : "Current B snapshot", metadata: "{}", sequence: 1, created_at: "2026-11-07T00:00:00Z" }];
        if (historyReads === 1) {
          const status = ["history401", "historyDisposed", "historyCurrent401"].includes(mode) ? 401 : mode === "historyError" ? 500 : 200;
          const payload = JSON.stringify(status !== 200 ? { error: { code: "SYNTHETIC_HISTORY_FAILURE", message: "Synthetic history failure" } } : body);
          return new Response(new ReadableStream({ start(controller) {
            controller.enqueue(new TextEncoder().encode(payload.slice(0, 1)));
            void historyGate.then(() => { controller.enqueue(new TextEncoder().encode(payload.slice(1))); controller.close(); });
          } }), { status, headers: { "content-type": "application/json" } });
        }
      }
      if (mode === "history" && runPosts > 0) return Response.json({ ...body, activeRun: undefined });
      return Response.json(body);
    }
    if ((runReadLifetime || closeLifetime) && request.method === "GET" && /^\/api\/threads\/thread-[ab]\/messages$/.test(path)) {
      const thread = path.split("/")[3]!;
      return Response.json({ messages: [{ id: `current-${thread}`, thread_id: thread, role: "user", content: thread === "thread-a" ? "Current A Run messages" : "Current B Run messages", metadata: "{}", sequence: 1, created_at: "2026-11-07T00:00:00Z" }] });
    }
    if (pollingLifetime && request.method === "GET" && path === "/api/threads/thread-a/messages") {
      messageReads++;
      const status = mode === "pollingCurrentOK" ? 200 : 401;
      const payload = JSON.stringify(status === 200
        ? { messages: [{ id: "saved-reply", thread_id: "thread-a", role: "assistant", content: "Canonical refreshed reply", metadata: "{}", sequence: 2, created_at: "2026-11-07T00:00:01Z" }] }
        : { error: { code: "UNAUTHENTICATED", message: "Synthetic message refresh authentication failure" } });
      let open = true;
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(payload.slice(0, 1)));
        messageProducer = messagesGate.then(() => { if (open) { controller.enqueue(new TextEncoder().encode(payload.slice(1))); controller.close(); open = false; } });
      }, cancel() { open = false; } }), { status, headers: { "content-type": "application/json" } });
    }
    if (request.method === "POST" && path === "/api/threads/thread-a/messages") {
      messagePosts++;
      const body = await request.json() as { content: string; metadata?: unknown };
      if (mode === "messageRejected" && messagePosts === 1) return Response.json({ error: { code: "BAD_REQUEST", message: "Synthetic precommit validation rejection" } }, { status: 400 });
      const message = { id: `message-${messages.length + 1}`, thread_id: "thread-a", role: "user", content: body.content, metadata: JSON.stringify(body.metadata ?? {}), sequence: messages.length + 1, created_at: "2026-11-07T00:00:00Z" };
      messages.push(message);
      if (mode === "authPending") await runGate;
      if (mode === "rate") return Response.json({ error: { code: "TOO_MANY_REQUESTS", message: "Synthetic postcommit response replacement" } }, { status: 429 });
      return Response.json({ message: ["attachment", "restore"].includes(mode) ? { ...message, metadata: "{}" } : message }, { status: mode === "message202" ? 202 : 201 });
    }
    if (request.method === "PATCH" && path === "/api/threads/thread-a") return Response.json({ ok: true });
    if (cancelLifetime && request.method === "POST" && /^\/api\/runs\/[^/]+\/cancel$/.test(path)) {
      cancelPosts.push(path);
      const isSecond = path.includes("second-run");
      const status = ["cancelCurrentOK", "cancelOverlapAck"].includes(mode) || isSecond ? 200 : ["cancelLateError", "cancelOverlap", "cancelFocusError"].includes(mode) ? 500 : 401;
      const payload = JSON.stringify(status === 200 ? { success: true } : { error: { code: "SYNTHETIC_CANCEL_FAILURE", message: "Synthetic cancellation failure" } });
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(payload.slice(0, 1)));
        void (isSecond ? secondCancelGate : cancelGate).then(() => { controller.enqueue(new TextEncoder().encode(payload.slice(1))); controller.close(); });
      } }), { status, headers: { "content-type": "application/json" } });
    }
    if (request.method === "POST" && path === "/api/threads/thread-a/runs") {
      runPosts++;
      runModels.push((await request.json() as { model: string }).model);
      if (["pending", "late401", "pendingSuccess", "earlyReturn"].includes(mode)) await runGate;
      if (["positive", "pendingSuccess", "earlyReturn"].includes(mode)) {
        expect(runModels.at(-1)).toBe("synthetic-model");
        activeRun = { ...run, id: "created-run", root_run_id: "created-run" };
        return Response.json({ run: activeRun }, { status: 201 });
      }
      if (mode === "run202") return Response.json({ run: { ...run, id: "asynchronous-run", root_run_id: "asynchronous-run" } }, { status: 202 });
      return Response.json({ error: { code: "SYNTHETIC_REPLY_FAILURE", message: "Synthetic reply failure" } }, { status: ["late401", "current401"].includes(mode) ? 401 : ["rejected", "messageRejected", "conversation"].includes(mode) ? 400 : 500 });
    }
    if (request.method === "POST" && path === "/api/spaces/space-a/storage/folders") return Response.json({ ok: true });
    if (request.method === "POST" && path === "/api/spaces/space-a/storage/upload-url") return Response.json({ file_id: uploaded.id, upload_url: String(new URL("/synthetic-upload", server.url)) });
    if (request.method === "PUT" && path === "/synthetic-upload") { expect(await request.text()).toBe("draft"); return new Response(null, { status: 204 }); }
    if (request.method === "POST" && path === "/api/spaces/space-a/storage/confirm-upload") return Response.json({ file: uploaded });
    throw new Error(`Unexpected synthetic request: ${request.method} ${path}`);
  }, websocket: { open(socket) {
    if (runReadLifetime) {
      runReadSocketCount++;
      const connected = () => socket.send(JSON.stringify({ type: "connected", data: { connectionId: "synthetic-connection", lastEventId: 0 } }));
      if (mode === "runReadFocus" && runReadSocketCount > 1) resumeRunConnected = connected;
      else connected();
      sendLiveMessage = () => { socket.send(JSON.stringify({ type: "message", data: { content: "Streaming after unavailable status" }, eventId: 1 })); };
    }
  }, close() { if (runReadLifetime) runReadClosed++; }, message(socket, value) {
    if (value === "ping") socket.send("pong");
    else if (JSON.parse(String(value)).type === "subscribe") {
      subscriptions++;
      if (authCloseLifetime) closeAuthSocket = () => {
        socket.close(mode === "authClosePolicy" ? 1008 : mode === "authCloseReason" ? 1012 : 4401,
          mode === "authCloseReason" ? "Synthetic unauthorized close" : "Synthetic policy gate");
      };
      if (closeLifetime) closeTransport = () => { socket.close(1012, "Synthetic restart"); };
      if (pollingLifetime) completeRun = () => {
        activeRun = { ...run, status: "completed", completed_at: "2026-11-07T00:00:01Z" };
        socket.send(JSON.stringify({ type: "completed", data: { run: activeRun }, eventId: 1 }));
      };
    }
  } } });
  let fixture: { state: () => { input: string; messages: unknown[]; error: string | null; loading: boolean; cancelling: boolean; streamingMessage: string | null; model: string; files: string[] }; setThread: (id: string) => void; setMounted: (mounted: boolean) => void; setFocus: (sequence: number | null) => void; setPrincipal: (id: string) => void; setModel: (id: string) => void; idle: () => Promise<void>; pendingCount: () => number; refetchIdentity: () => Promise<void>; dispose: () => void } | undefined;
  try {
    await build({ configFile: false, root: resolve(import.meta.dir, "../.."), logLevel: "silent", plugins: [solid()],
      build: { outDir: output, minify: false, lib: { entry: resolve(import.meta.dir, "fixtures/chat-send-recovery/client.tsx"), formats: ["iife"], name: "ChatSendRecoveryTest", fileName: () => "client.js" } },
    });
    const { document, window, Event, HTMLElement } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
    const storage = new Map<string, string>();
    const location = { href: `${server.url.origin}/chat/space-a/thread-a`, origin: server.url.origin, host: server.url.host, protocol: server.url.protocol, pathname: "/chat/space-a/thread-a", search: "", assign(next: string) { this.href = next; } };
    const scope: Record<string, unknown> = {
      document, Event, HTMLElement, URL, URLSearchParams, Headers, Request, Response, Blob, File, FormData, AbortController, TextEncoder, TextDecoder, WebSocket,
      console, navigator: { language: "en" }, location,
      chatSendTestConfig: { auth: ["authRefresh", "authPending"].includes(mode), cancel: cancelLifetime || runReadLifetime || closeLifetime || authCloseLifetime },
      setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
      addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window),
      localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
      fetch: async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input), server.url);
        if (url.origin !== server.url.origin) throw new Error("Non-loopback fixture request refused");
        if (pollingLifetime && url.pathname.endsWith("/messages")) init?.signal?.addEventListener("abort", () => { messageAborts++; });
        const response = await fetch(url, init);
        if (closeLifetime && /^\/api\/runs\/[^/]+$/.test(url.pathname)) {
          closeReadDone++;
          const json = response.json.bind(response);
          response.json = async () => { closeParsesStarted++; try { return await json(); } finally { closeParsesDone++; } };
        }
        if (runReadLifetime && /^\/api\/runs\/[^/]+$/.test(url.pathname)) {
          const json = response.json.bind(response);
          const old = url.pathname.endsWith("/unrelated-run") && ++runReadResponses === 1;
          response.json = async () => {
            if (!old) { try { return await json(); } finally { newRunReadDone++; } }
            oldRunReadStarted++; try { return await json(); } finally { oldRunReadDone++; }
          };
        }
        if (pollingLifetime && url.pathname.endsWith("/messages")) {
          const json = response.json.bind(response);
          response.json = async () => {
            messageParsesStarted++;
            try { return await json(); } catch (error) { messageParseErrors.push((error as Error).name); throw error; }
            finally { messageParsesDone++; }
          };
        }
        if (historyLifetime && url.pathname.endsWith("/history")) {
          const json = response.json.bind(response);
          response.json = async () => { historyParsesStarted++; try { return await json(); } finally { historyParsesDone++; } };
        }
        if (cancelLifetime && url.pathname.endsWith("/cancel")) {
          const json = response.json.bind(response);
          response.json = async () => { cancelParsesStarted++; try { return await json(); } finally { cancelParsesDone++; } };
        }
        return response;
      },
    };
    scope.window = scope; scope.self = scope;
    runInContext(await readFile(join(output, "client.js"), "utf8"), createContext(scope));
    fixture = scope.chatSendFixture as NonNullable<typeof fixture>;
    await waitFor(() => (cancelLifetime || pollingLifetime || runReadLifetime || closeLifetime || authCloseLifetime ? historyReads >= 1 : historyReads === 1) && fixture!.state().model === "synthetic-model");
    await Bun.sleep(0);
    if (authCloseLifetime) {
      await waitFor(() => subscriptions === 1 && closeAuthSocket !== undefined);
      closeAuthSocket!(); await waitFor(() => location.href.startsWith("/signin") || authCloseReads > 0);
      expect(location.href).toBe("/signin?next=%2Fchat%2Fspace-a%2Fthread-a");
      expect(fixture.state().loading).toBe(false); expect(fixture.state().error).toBeTruthy();
      await Bun.sleep(2_050); expect(authCloseReads).toBe(0); expect(subscriptions).toBe(1);
      expect(attempts.every((attempt) => attempt.method === "GET")).toBe(true);
      return;
    }
    if (closeLifetime) {
      await waitFor(() => subscriptions === 1 && closeTransport !== undefined);
      closeTransport!(); await waitFor(() => closeReadRequests.length === 1);
      if (closeStreamBody) await waitFor(() => closeParsesStarted === 1);
      if (mode === "closeQueuedReconnect") {
        releaseCloseRead(); await waitFor(() => closeParsesDone === 1); await Bun.sleep(0);
      }
      if (mode === "closeDispose") {
        fixture.setMounted(false); await Bun.sleep(0); expect(document.querySelector("textarea")).toBeNull();
        releaseCloseRead(); await waitFor(() => closeReadDone === 1); await Bun.sleep(0);
        expect(location.href).toBe(`${server.url.origin}/chat/space-a/thread-a`);
        expect(subscriptions).toBe(1); expect(attempts.every((attempt) => attempt.method === "GET")).toBe(true);
        return;
      }
      if (["closeCurrent401", "closeCurrentTerminal", "closeCurrentActive", "closeCurrent503", "closeMismatched"].includes(mode)) {
        releaseCloseRead(); await waitFor(() => closeStreamBody ? closeParsesDone === 1 : closeReadDone === 1); await Bun.sleep(0);
        if (mode === "closeCurrent401") {
          expect(location.href).toBe("/signin?next=%2Fchat%2Fspace-a%2Fthread-a");
          expect(fixture.state().loading).toBe(false); expect(fixture.state().error).toBeTruthy();
        } else if (mode === "closeCurrentTerminal") {
          await waitFor(() => document.body.textContent!.includes("Current A Run messages"));
          expect(fixture.state().loading).toBe(false); expect(subscriptions).toBe(1);
        } else if (mode === "closeMismatched") {
          expect(fixture.state().loading).toBe(true);
          expect(document.body.textContent).toContain("Current A Run view");
          expect(attempts.some((attempt) => attempt.path.endsWith("/messages"))).toBe(false);
        } else {
          await waitFor(() => subscriptions === 2);
          expect(attempts.filter((attempt) => attempt.path.endsWith("/ws")).map((attempt) => attempt.path)).toEqual(["/api/runs/unrelated-run/ws", "/api/runs/unrelated-run/ws"]);
          expect(fixture.state().loading).toBe(true); expect(fixture.state().error).toBeNull();
        }
        expect(closeReadRequests).toEqual(["/api/runs/unrelated-run"]);
        expect(attempts.every((attempt) => attempt.method === "GET")).toBe(true);
        return;
      }
      if (mode === "closeFocus") {
        fixture.setFocus(300); await waitFor(() => document.body.textContent!.includes("Focused A Run view") && subscriptions === 2);
      } else {
        fixture.setThread("thread-b"); await waitFor(() => document.body.textContent!.includes("Current B Run view") && subscriptions === 2);
        if (["closeReturnActive", "closeQueuedReconnect"].includes(mode)) {
          fixture.setThread("thread-a"); await waitFor(() => document.body.textContent!.includes("Current A Run view") && subscriptions === 3);
        }
      }
      expect(fixture.state().loading).toBe(true);
      releaseCloseRead(); await waitFor(() => closeStreamBody ? closeParsesDone === 1 : closeReadDone === 1); await Bun.sleep(0);
      if (["closeReturnActive", "closeQueuedReconnect"].includes(mode)) { await Bun.sleep(2_050); expect(subscriptions).toBe(3); }
      expect(location.href).toBe(`${server.url.origin}/chat/space-a/${["closeFocus", "closeReturnActive", "closeQueuedReconnect"].includes(mode) ? "thread-a" : "thread-b"}`);
      expect(fixture.state().loading).toBe(true); expect(fixture.state().error).toBeNull();
      expect(closeReadRequests).toEqual(["/api/runs/unrelated-run"]);
      expect(attempts.some((attempt) => attempt.path.endsWith("/messages"))).toBe(false);
      expect(attempts.every((attempt) => attempt.method === "GET")).toBe(true);
      return;
    }
    if (runReadLifetime) {
      await waitFor(() => oldRunReadStarted === 1);
      if (mode === "runReadDispose") {
        fixture.setMounted(false); await Bun.sleep(0); expect(document.querySelector("textarea")).toBeNull();
        releaseRunRead(); await waitFor(() => oldRunReadDone === 1); await Bun.sleep(0);
        expect(location.href).toBe(`${server.url.origin}/chat/space-a/thread-a`);
        expect(attempts.every((attempt) => attempt.method === "GET")).toBe(true);
        return;
      }
      if (mode === "runReadFocus") {
        fixture.setFocus(300); await waitFor(() => document.body.textContent!.includes("Focused A Run view") && resumeRunConnected !== undefined);
        releaseRunRead(); await waitFor(() => oldRunReadDone === 1); await Bun.sleep(0);
        expect(location.href).toBe(`${server.url.origin}/chat/space-a/thread-a`);
        resumeRunConnected!(); await waitFor(() => newRunReadDone === 1 && document.body.textContent!.includes("Current A Run messages"));
        expect(fixture.state().loading).toBe(true); expect(runReadRequests).toHaveLength(2);
        return;
      }
      if (["runReadCurrent401", "runReadCurrentActive", "runReadCurrentTerminal", "runReadMismatched", "runReadWatchdog503"].includes(mode)) {
        releaseRunRead(); await waitFor(() => oldRunReadDone === 1); await Bun.sleep(0);
        if (mode === "runReadCurrent401") {
          expect(location.href).toBe("/auth/oidc/login?return_to=%2Fchat%2Fspace-a%2Fthread-a");
          expect(runReadRequests).toHaveLength(1);
        } else if (mode === "runReadMismatched") {
          expect(fixture.state().loading).toBe(true);
          expect(document.body.textContent).toContain("Current A Run view");
          expect(attempts.some((attempt) => attempt.path.endsWith("/messages"))).toBe(false);
        } else {
          await waitFor(() => document.body.textContent!.includes("Current A Run messages"));
          expect(fixture.state().loading).toBe(mode !== "runReadCurrentTerminal");
          if (mode === "runReadWatchdog503") {
            await Bun.sleep(8_050); await waitFor(() => newRunReadDone >= 1); await Bun.sleep(25);
            expect(runReadClosed).toBe(0);
            sendLiveMessage!(); await waitFor(() => fixture!.state().streamingMessage === "Streaming after unavailable status");
            expect(fixture.state().loading).toBe(true); expect(fixture.state().error).toBeNull();
            expect(runReadRequests).toHaveLength(2);
          }
          expect(location.href).toBe(`${server.url.origin}/chat/space-a/thread-a`);
        }
        expect(attempts.every((attempt) => attempt.method === "GET")).toBe(true);
        return;
      }
      fixture.setThread("thread-b"); await waitFor(() => document.body.textContent!.includes("Current B Run messages") && newRunReadDone === 1);
      expect(fixture.state().loading).toBe(true);
      releaseRunRead(); await waitFor(() => oldRunReadDone === 1); await Bun.sleep(0);
      expect(location.href).toBe(`${server.url.origin}/chat/space-a/thread-b`);
      expect(fixture.state().loading).toBe(true); expect(fixture.state().error).toBeNull();
      expect(runReadRequests).toEqual(["/api/runs/unrelated-run", "/api/runs/second-run"]);
      expect(attempts.every((attempt) => attempt.method === "GET")).toBe(true);
      return;
    }
    if (pollingLifetime) {
      await waitFor(() => subscriptions === 1); await Bun.sleep(0);
      expect(messageReads).toBe(0);
      completeRun!(); await waitFor(() => messageParsesStarted === 1);
      expect(messageReads).toBe(1);
      if (["pollingCurrent401", "pollingCurrentOK"].includes(mode)) {
        releaseMessages(); await waitFor(() => messageParsesDone === 1); await Bun.sleep(0);
        expect(messageAborts).toBe(0); expect(messageParseErrors).toEqual([]);
        if (mode === "pollingCurrent401") {
          expect(location.href).toBe("/auth/oidc/login?return_to=%2Fchat%2Fspace-a%2Fthread-a");
          expect(fixture.state().error).toBeNull();
        } else {
          expect(document.body.textContent).toContain("Canonical refreshed reply");
          expect(document.body.textContent).not.toContain("Current A refresh view");
          expect(fixture.state().loading).toBe(false);
          expect(location.href).toBe(`${server.url.origin}/chat/space-a/thread-a`);
        }
        expect(attempts.every((attempt) => attempt.method === "GET")).toBe(true);
        return;
      }
      if (mode === "pollingDispose") {
        fixture.setMounted(false); await Bun.sleep(0);
        expect(document.querySelector("textarea")).toBeNull();
      } else if (mode === "pollingFocus") {
        fixture.setFocus(300); await waitFor(() => document.body.textContent!.includes("Focused A refresh view"));
      } else {
        fixture.setThread("thread-b"); await waitFor(() => document.body.textContent!.includes("Current B refresh view"));
      }
      await waitFor(() => messageAborts === 1 && messageParsesDone === 1); await Bun.sleep(0);
      expect(messageParseErrors).toEqual(["AbortError"]);
      expect(location.href).toBe(`${server.url.origin}/chat/space-a/${mode === "pollingAbort" ? "thread-b" : "thread-a"}`);
      expect(fixture.state().error).toBeNull();
      expect(attempts.every((attempt) => attempt.method === "GET")).toBe(true);
      return;
    }
    if (cancelLifetime) {
      await waitFor(() => document.querySelector('button[aria-label="Cancel"]') !== null);
      document.querySelector<HTMLButtonElement>('button[aria-label="Cancel"]')!.click();
      await waitFor(() => cancelParsesStarted === 1);
      expect(cancelPosts).toEqual(["/api/runs/unrelated-run/cancel"]);
      if (["cancelCurrent401", "cancelCurrentOK"].includes(mode)) {
        releaseCancel(); await fixture.idle();
        expect(cancelParsesDone).toBe(1); expect(fixture.state().cancelling).toBe(false);
        expect(cancelPosts).toHaveLength(1);
        if (mode === "cancelCurrent401") {
          expect(location.href).toBe("/auth/oidc/login?return_to=%2Fchat%2Fspace-a%2Fthread-a");
          expect(fixture.state().error).not.toBeNull();
        } else {
          expect(location.href).toBe(`${server.url.origin}/chat/space-a/thread-a`);
          expect(fixture.state().error).toBeNull(); expect(fixture.state().loading).toBe(true);
          expect(document.querySelector<HTMLButtonElement>('button[aria-label="Cancel"]')!.disabled).toBe(false);
        }
        return;
      }
      if (mode === "cancelUnmount") {
        fixture.setMounted(false); await Bun.sleep(0);
        expect(document.querySelector("textarea")).toBeNull();
        releaseCancel(); await fixture.idle();
        expect(cancelParsesDone).toBe(1);
        expect(location.href).toBe(`${server.url.origin}/chat/space-a/thread-a`);
        expect(cancelPosts).toHaveLength(1);
        return;
      }
      if (cancelFocus) {
        activeRun = otherRun;
        fixture.setFocus(300); await waitFor(() => document.body.textContent!.includes("Focused A cancellation view"));
        releaseCancel(); await fixture.idle();
        expect(cancelParsesDone).toBe(1);
        expect(location.href).toBe(`${server.url.origin}/chat/space-a/thread-a`);
        expect(fixture.state().error).toBeNull(); expect(fixture.state().cancelling).toBe(false);
        document.querySelector<HTMLButtonElement>('button[aria-label="Cancel"]')!.click();
        await waitFor(() => cancelParsesStarted === 2);
        releaseSecondCancel(); await fixture.idle();
        expect(cancelPosts).toEqual(["/api/runs/unrelated-run/cancel", "/api/runs/second-run/cancel"]);
        expect(fixture.state().error).toBeNull(); expect(fixture.state().cancelling).toBe(false);
        return;
      }
      fixture.setThread("thread-b"); await waitFor(() => document.body.textContent!.includes("Current B cancellation view"));
      if (mode === "cancelReturn") {
        fixture.setThread("thread-a"); await waitFor(() => document.body.textContent!.includes("Current A cancellation view"));
        releaseCancel(); await fixture.idle();
        expect(cancelParsesDone).toBe(1); expect(fixture.state().error).toBeNull();
        expect(location.href).toBe(`${server.url.origin}/chat/space-a/thread-a`);
        expect(document.querySelector<HTMLButtonElement>('button[aria-label="Cancel"]')!.disabled).toBe(false);
        expect(cancelPosts).toHaveLength(1);
        return;
      }
      if (cancelOverlap) {
        await waitFor(() => document.querySelector('button[aria-label="Cancel"]') !== null);
        document.querySelector<HTMLButtonElement>('button[aria-label="Cancel"]')!.click();
        await waitFor(() => cancelParsesStarted === 2);
        expect(fixture.state().cancelling).toBe(true);
        releaseCancel(); await waitFor(() => fixture!.pendingCount() === 1);
        expect(cancelParsesDone).toBe(1); expect(fixture.state().cancelling).toBe(true);
        expect(fixture.state().error).toBeNull();
        expect(document.querySelector<HTMLButtonElement>('button[aria-label="Cancelling..."]')!.disabled).toBe(true);
        releaseSecondCancel(); await fixture.idle();
        expect(cancelParsesDone).toBe(2); expect(fixture.state().cancelling).toBe(false);
        expect(cancelPosts).toEqual(["/api/runs/unrelated-run/cancel", "/api/runs/second-run/cancel"]);
        return;
      }
      const currentDraft = document.querySelector<HTMLTextAreaElement>("textarea")!;
      currentDraft.value = "A current B draft"; currentDraft.dispatchEvent(new Event("input", { bubbles: true }));
      releaseCancel(); await fixture.idle();
      expect(cancelParsesDone).toBe(1);
      expect(location.href).toBe(`${server.url.origin}/chat/space-a/thread-b`);
      expect(fixture.state().error).toBeNull();
      expect(cancelPosts).toEqual(["/api/runs/unrelated-run/cancel"]);
      expect(currentDraft.value).toBe("A current B draft");
      expect(document.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(false);
      return;
    }
    if (historyLifetime) {
      await waitFor(() => historyParsesStarted === 1);
      if (mode === "historyCurrent401") {
        releaseHistory(); await waitFor(() => historyParsesDone === 1); await Bun.sleep(0);
        expect(location.href).toBe("/auth/oidc/login?return_to=%2Fchat%2Fspace-a%2Fthread-a");
        expect(fixture.state().error).not.toBeNull();
        expect(attempts.every((attempt) => attempt.method === "GET")).toBe(true);
        return;
      }
      if (mode === "historyDisposed") {
        fixture.setMounted(false); await Bun.sleep(0);
        expect(document.querySelector("textarea")).toBeNull();
      } else if (mode === "historyFocus") {
        fixture.setFocus(300); await waitFor(() => document.body.textContent!.includes("Current A snapshot"));
        expect(historyWindows).toEqual([{ limit: "100", offset: "0" }, { limit: "200", offset: "200" }]);
      } else {
        fixture.setThread("thread-b"); await waitFor(() => document.body.textContent!.includes("Current B snapshot"));
        fixture.setThread("thread-a"); await waitFor(() => document.body.textContent!.includes("Current A snapshot"));
      }
      releaseHistory(); await waitFor(() => historyParsesDone === (mode === "historyDisposed" ? 1 : mode === "historyFocus" ? 2 : 3)); await Bun.sleep(0);
      if (mode === "historyDisposed") {
        expect(location.href).toBe(`${server.url.origin}/chat/space-a/thread-a`);
        expect(attempts.every((attempt) => attempt.method === "GET")).toBe(true);
        return;
      }
      expect(document.body.textContent).toContain("Current A snapshot");
      expect(document.body.textContent).not.toContain("Old A snapshot");
      expect(location.href).toBe(`${server.url.origin}/chat/space-a/thread-a`);
      expect(fixture.state().error).toBeNull();
      expect(attempts.every((attempt) => attempt.method === "GET")).toBe(true);
      return;
    }
    const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
    const form = document.querySelector("form")!;
    textarea.value = "Start one reply"; textarea.dispatchEvent(new Event("input", { bubbles: true }));
    if (["attachment", "restore"].includes(mode)) {
      const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, "files", { configurable: true, value: [new File(["draft"], "draft.txt", { type: "text/plain" })] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    if (mode === "earlyReturn") {
      await waitFor(() => runPosts === 1);
      fixture.setThread("thread-b"); await waitFor(() => historyReads >= 2); await Bun.sleep(0);
      fixture.setThread("thread-a"); await waitFor(() => historyReads >= 3); await Bun.sleep(0);
      releaseRun(); await fixture.idle();
      const reconnect = document.querySelector<HTMLButtonElement>('button[aria-label="Reconnect reply"]');
      expect(reconnect).not.toBeNull();
      expect(document.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(true);
      reconnect!.click(); await fixture.idle(); await waitFor(() => subscriptions === 1);
      expect(runPosts).toBe(1); expect(messages).toHaveLength(1);
      return;
    }
    if (mode === "authPending") {
      await waitFor(() => messagePosts === 1);
      authStatus = 503; await fixture.refetchIdentity();
      expect(document.body.textContent).not.toContain("Start one reply");
      releaseRun(); await fixture.idle(); expect(runPosts).toBe(0);
      authStatus = 200; await fixture.refetchIdentity();
      await waitFor(() => historyReads >= 2 && fixture!.state().model === "synthetic-model"); await Bun.sleep(0);
      expect(document.body.textContent).toContain("Your message is saved");
      expect(messages).toHaveLength(1); expect(runPosts).toBe(0);
      return;
    }
    if (["pending", "late401", "pendingSuccess"].includes(mode)) {
      await waitFor(() => runPosts === 1);
      fixture.setThread("thread-b"); await waitFor(() => historyReads >= 2); await Bun.sleep(0);
      expect(document.body.textContent).not.toContain("reply status is unknown");
      releaseRun(); await fixture.idle();
      expect(fixture.state().error).toBeNull();
      expect(location.href).toBe(`${server.url.origin}/chat/space-a/thread-b`);
      fixture.setThread("thread-a"); await waitFor(() => historyReads >= 3); await Bun.sleep(0);
      if (mode === "pendingSuccess") {
        await waitFor(() => subscriptions === 1);
        expect(document.body.textContent).not.toContain("The reply was created");
        expect(document.body.textContent).not.toContain("reply status is unknown");
      } else expect(document.body.textContent).toContain(mode === "pending" ? "reply status is unknown" : "Your message is saved");
      expect(runPosts).toBe(1); expect(messages).toHaveLength(1);
      return;
    }
    await fixture.idle();
    const click = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === text)!.click();
    const dialog = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === text)!.click();
    if (mode === "positive") {
      await waitFor(() => subscriptions === 1);
      expect(runPosts).toBe(1); expect(messages).toHaveLength(1);
      expect(document.body.textContent).not.toContain("reply status is unknown");
      expect(document.querySelector('button[aria-label="Start reply from current conversation"]')).toBeNull();
      return;
    }
    if (mode === "message202") {
      expect(runPosts).toBe(0); expect(messages).toHaveLength(1);
      expect(document.body.textContent).toContain("message may already be saved");
      return;
    }
    if (mode === "run202") {
      expect(document.body.textContent).toContain("reply status is unknown");
      expect(subscriptions).toBe(0); expect(runPosts).toBe(1); expect(messages).toHaveLength(1);
      return;
    }
    if (mode === "messageRejected") {
      expect(messages).toHaveLength(0); expect(runPosts).toBe(0); expect(textarea.value).toBe("Start one reply");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await fixture.idle();
      expect(messages).toHaveLength(1); expect(runPosts).toBe(1); expect(messagePosts).toBe(2);
      return;
    }
    if (mode === "restore") {
      expect(runPosts).toBe(0); expect(document.body.textContent).toContain("draft.txt");
      click("Restore as a new message"); await Bun.sleep(0); dialog("Cancel"); await Bun.sleep(0);
      expect(textarea.value).toBe(""); expect(messages).toHaveLength(1);
      textarea.value = "Newer draft"; textarea.dispatchEvent(new Event("input", { bubbles: true }));
      expect([...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Restore as a new message")!.disabled).toBe(true);
      textarea.value = ""; textarea.dispatchEvent(new Event("input", { bubbles: true }));
      click("Restore as a new message"); await Bun.sleep(0); dialog("Restore as a new message"); await Bun.sleep(0);
      expect(textarea.value).toBe("Start one reply"); expect(fixture.state().files).toEqual(["draft.txt"]);
      expect(messages).toHaveLength(1); expect(runPosts).toBe(0);
      return;
    }
    if (mode === "attachment" || mode === "rate") {
      expect(runPosts).toBe(0);
      expect(textarea.value).toBe("");
      expect(document.body.textContent).toContain("message may already be saved");
      expect(messages).toHaveLength(1);
      return;
    }
    expect(runPosts).toBe(1);
    if (mode === "authRefresh") {
      authStatus = 503; await fixture.refetchIdentity();
      expect(document.body.textContent).not.toContain("reply status is unknown");
      authStatus = 200; await fixture.refetchIdentity();
      await waitFor(() => historyReads >= 3 && fixture!.state().model === "synthetic-model"); await Bun.sleep(0);
      expect(document.body.textContent).toContain("reply status is unknown");
      expect(messages).toHaveLength(1); expect(runPosts).toBe(1);
      return;
    }
    if (mode === "conversation") {
      await fetch(new URL("/api/threads/thread-a/messages", server.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "Another client message" }) });
      const action = document.querySelector<HTMLButtonElement>('button[aria-label="Start reply from current conversation"]');
      expect(action).not.toBeNull();
      fixture.setModel("new-selected-model"); action!.click(); await fixture.idle();
      expect(messages.map((message) => message.content)).toEqual(["Start one reply", "Another client message"]);
      expect(runPosts).toBe(2); expect(runModels).toEqual(["synthetic-model", "new-selected-model"]);
      return;
    }
    if (mode === "samePrincipal") {
      fixture.setPrincipal("synthetic-owner"); await Bun.sleep(0);
      expect(document.body.textContent).toContain("reply status is unknown");
      expect(runPosts).toBe(1);
      return;
    }
    if (mode === "current401") {
      expect(location.href).toBe("/auth/oidc/login?return_to=%2Fchat%2Fspace-a%2Fthread-a");
      expect(document.querySelector('button[aria-label="Start reply from current conversation"]')).not.toBeNull();
      return;
    }
    if (mode === "confirmed" || mode === "dismiss") {
      textarea.value = "Newer draft"; textarea.dispatchEvent(new Event("input", { bubbles: true }));
      const action = mode === "confirmed" ? "Start another reply" : "Write a new message";
      click(action); await Bun.sleep(0); dialog("Cancel"); await Bun.sleep(0);
      expect(runPosts).toBe(1); expect(messages).toHaveLength(1); expect(textarea.value).toBe("Newer draft");
      click(action); await Bun.sleep(0); dialog(action); await Bun.sleep(0); await fixture.idle();
      expect(messages).toHaveLength(1); expect(textarea.value).toBe("Newer draft");
      if (mode === "confirmed") { expect(runPosts).toBe(2); expect(runModels).toEqual(["synthetic-model", "synthetic-model"]); }
      else {
        expect(runPosts).toBe(1);
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await fixture.idle();
        expect(messages.map((message) => message.content)).toEqual(["Start one reply", "Newer draft"]);
        expect(runPosts).toBe(2);
      }
      return;
    }
    if (mode === "principal") {
      expect(document.body.textContent).toContain("reply status is unknown");
      fixture.setPrincipal("other-synthetic-owner"); await Bun.sleep(0);
      expect(document.body.textContent).not.toContain("reply status is unknown");
      expect(runPosts).toBe(1);
      return;
    }
    if (mode === "remount") {
      fixture.setMounted(false); await Bun.sleep(0); fixture.setMounted(true);
      await waitFor(() => historyReads >= 3); await Bun.sleep(0);
      expect(document.body.textContent).toContain("reply status is unknown");
      expect(document.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!.disabled).toBe(true);
      return;
    }
    if (mode === "history") {
      expect(document.body.textContent).toContain("reply status is unknown");
      expect([...document.querySelectorAll("button")].some((button) => button.textContent === "Start another reply")).toBe(false);
      expect(runPosts).toBe(1);
      return;
    }
    if (mode === "confirm") {
      click("Start another reply"); await Bun.sleep(0);
      fixture.setThread("thread-b"); await waitFor(() => historyReads >= 3); await Bun.sleep(0);
      fixture.setThread("thread-a"); await waitFor(() => historyReads >= 4); await Bun.sleep(0);
      dialog("Start another reply"); await Bun.sleep(0); await fixture.idle();
      expect(runPosts).toBe(1); expect(messages).toHaveLength(1);
      return;
    }
    if (mode === "draft") {
      textarea.value = "Newer draft"; textarea.dispatchEvent(new Event("input", { bubbles: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await fixture.idle();
      expect(messages).toHaveLength(1);
      expect(runPosts).toBe(1);
      expect(textarea.value).toBe("Newer draft");
      expect(document.body.textContent).toContain("reply status is unknown");
      return;
    }
    if (mode === "route") {
      fixture.setThread("thread-b"); await waitFor(() => historyReads >= 3); await Bun.sleep(0);
      expect(document.body.textContent).not.toContain("reply status is unknown");
      fixture.setThread("thread-a"); await waitFor(() => historyReads >= 4); await Bun.sleep(0);
      expect(document.body.textContent).toContain("reply status is unknown");
      expect(runPosts).toBe(1);
      return;
    }
    if (mode === "unrelated") {
      activeRun = run;
      [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Check reply status")!.click();
      await fixture.idle();
      expect(document.body.textContent).toContain("reply status is unknown");
      expect(runPosts).toBe(1);
      return;
    }
    textarea.value = "Newer draft"; textarea.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.setModel("changed-model");
    const retry = document.querySelector<HTMLButtonElement>('button[aria-label="Start reply from current conversation"]');
    if (retry) retry.click();
    else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await fixture.idle();
    const readback = await fetch(new URL("/api/threads/thread-a/history", server.url)).then((response) => response.json()) as { messages: unknown[] };
    expect(readback.messages).toHaveLength(1);
    expect(fixture.state().messages).toHaveLength(1);
    expect(retry).not.toBeNull();
    expect(textarea.value).toBe("Newer draft");
    expect(runModels).toEqual(["synthetic-model", "changed-model"]);
  } finally {
    releaseCloseRead();
    releaseRunRead();
    releaseMessages();
    releaseCancel();
    releaseSecondCancel();
    releaseHistory();
    releaseRun();
    await messageProducer;
    await runReadProducer;
    await closeReadProducer;
    await fixture?.idle();
    fixture?.dispose(); server.stop(true);
    await rm(output, { recursive: true, force: true });
  }
}

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Send recovery UI phase did not close");
    await Bun.sleep(5);
  }
}
