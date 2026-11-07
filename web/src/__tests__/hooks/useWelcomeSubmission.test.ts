import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { afterEach, test } from "bun:test";
import { createRoot, createSignal, onCleanup } from "solid-js";
import {
  useWelcomeSubmission,
  type WelcomeSubmissionResult,
} from "../../hooks/useWelcomeSubmission.ts";

if (Bun.env.TAKOS_WELCOME_SUBMISSION_CLIENT !== "1") {
  test("Welcome submission uses Solid browser ownership", async () => {
    const child = Bun.spawn([process.execPath, "--conditions=browser", "test", import.meta.path], {
      env: { ...process.env, TAKOS_WELCOME_SUBMISSION_CLIENT: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    strictEqual(code, 0);
  });
} else {
  const disposals: (() => void)[] = [];
  afterEach(() => { for (const dispose of disposals.splice(0)) dispose(); });
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  }

  function fixture(submit: (text: string, files?: File[]) => Promise<WelcomeSubmissionResult>) {
    const state = {
      input: "  first request  ",
      files: [new File(["draft"], "draft.txt", { type: "text/plain" })],
      scope: "workspace-a",
      clears: 0,
      errors: [] as unknown[],
      calls: [] as { text: string; files?: File[] }[],
    };
    const [scope, setScope] = createSignal(state.scope);
    Object.defineProperty(state, "scope", { get: scope, set: setScope });
    const submission = createRoot((dispose) => {
      disposals.push(dispose);
      const submission = useWelcomeSubmission({
        input: () => state.input,
        setInput: (value) => { state.input = value; },
        attachedFiles: () => state.files,
        setAttachedFiles: (value) => { state.files = value; },
        scope: () => state.scope,
        submit: (text, files) => {
          state.calls.push({ text, files });
          return submit(text, files);
        },
        onClear: () => { state.clears++; },
        onError: (error) => { state.errors.push(error); },
      });
      onCleanup(submission.dispose);
      return submission;
    });
    return { state, submission };
  }

  test("welcome keeps the draft until thread creation is accepted", async () => {
    const pending = deferred<boolean>();
    const { state, submission } = fixture(() => pending.promise);
    const original = state.files;
    const sent = submission.send();
    const before = { input: state.input, busy: submission.isSubmitting() };
    pending.resolve(false);
    strictEqual(await sent, false);
    deepStrictEqual(before, { input: "  first request  ", busy: true });
    strictEqual(state.input, "  first request  ");
    strictEqual(state.files, original);
    strictEqual(state.clears, 0);
    strictEqual(submission.isSubmitting(), false);
  });

  test("welcome clears accepted text and submitted attachments", async () => {
    const { state, submission } = fixture(async () => true);
    strictEqual(await submission.send(), true);
    strictEqual(state.input, "");
    deepStrictEqual(state.files, []);
    strictEqual(state.calls[0].text, "first request");
    strictEqual(state.calls[0].files?.[0].name, "draft.txt");
    strictEqual(state.clears, 1);
  });

  test("welcome keeps the draft and reports a rejected request", async () => {
    const error = new Error("offline");
    const { state, submission } = fixture(async () => { throw error; });
    strictEqual(await submission.send(), false);
    strictEqual(state.input, "  first request  ");
    strictEqual(state.files.length, 1);
    deepStrictEqual(state.errors, [error]);
    strictEqual(submission.isSubmitting(), false);
  });

  test("welcome serializes double clicks and allows retry after failure", async () => {
    const pending = deferred<boolean>();
    let accepted = false;
    const { state, submission } = fixture(() => accepted ? Promise.resolve(true) : pending.promise);
    const first = submission.send();
    const second = submission.send();
    pending.resolve(false);
    await first;
    await second;
    strictEqual(state.calls.length, 1);
    accepted = true;
    strictEqual(await submission.send(), true);
    strictEqual(state.calls.length, 2);
  });

  test("welcome preserves edits and new attachments made while sending", async () => {
    const pending = deferred<boolean>();
    const { state, submission } = fixture(() => pending.promise);
    const oldFile = state.files[0];
    const sent = submission.send();
    state.input = "next request";
    const nextFile = new File(["next"], "next.txt", { type: "text/plain" });
    state.files = [oldFile, nextFile];
    pending.resolve(true);
    strictEqual(await sent, true);
    strictEqual(state.input, "next request");
    deepStrictEqual(state.files, [nextFile]);
    strictEqual(state.clears, 0);
  });

  test("welcome ignores acceptance after the Workspace changes", async () => {
    const pending = deferred<boolean>();
    const { state, submission } = fixture(() => pending.promise);
    const sent = submission.send();
    state.scope = "workspace-b";
    state.input = "draft in b";
    pending.resolve(true);
    strictEqual(await sent, false);
    strictEqual(state.input, "draft in b");
    strictEqual(state.files.length, 0);
    state.scope = "workspace-a";
    strictEqual(state.input, "  first request  ");
    strictEqual(state.files.length, 1);
  });

  test("welcome ignores acceptance after the form is disposed", async () => {
    const pending = deferred<boolean>();
    const { state, submission } = fixture(() => pending.promise);
    const sent = submission.send();
    submission.dispose();
    pending.resolve(true);
    strictEqual(await sent, false);
    strictEqual(state.input, "  first request  ");
    strictEqual(state.clears, 0);
    strictEqual(await submission.send(), false);
  });

  test("welcome accepts attachments without text and skips empty drafts", async () => {
    const { state, submission } = fixture(async () => true);
    state.input = "   ";
    strictEqual(await submission.send(), true);
    strictEqual(state.calls[0].text, "");
    state.files = [];
    strictEqual(await submission.send(), false);
    strictEqual(state.calls.length, 1);
  });

  test("a Workspace switch frees its new form without letting an old completion unlock a new send", async () => {
    const a = deferred<boolean>();
    const b = deferred<boolean>();
    let calls = 0;
    const { state, submission } = fixture(() => ++calls === 1 ? a.promise : b.promise);
    const first = submission.send();
    state.scope = "workspace-b";
    strictEqual(submission.isSubmitting(), false);
    state.input = "draft in b";
    const second = submission.send();
    strictEqual(state.calls.length, 2);
    strictEqual(submission.isSubmitting(), true);
    a.resolve(true);
    strictEqual(await first, false);
    strictEqual(state.input, "draft in b");
    strictEqual(submission.isSubmitting(), true);
    b.resolve(true);
    strictEqual(await second, true);
    strictEqual(submission.isSubmitting(), false);
    strictEqual(state.input, "");
  });

  test("returning to the original Workspace does not revive its retired submission", async () => {
    const pending = deferred<boolean>();
    const { state, submission } = fixture(() => pending.promise);
    const sent = submission.send();
    state.scope = "workspace-b";
    state.scope = "workspace-a";
    strictEqual(submission.isSubmitting(), true);
    strictEqual(await submission.send(), false);
    strictEqual(state.calls.length, 1);
    pending.resolve(true);
    strictEqual(await sent, false);
    strictEqual(state.input, "  first request  ");
    strictEqual(state.files.length, 1);
    strictEqual(state.clears, 0);
  });

  test("a retired failure cannot report into or unlock the new Workspace submission", async () => {
    const a = deferred<boolean>();
    const b = deferred<boolean>();
    let calls = 0;
    const { state, submission } = fixture(() => ++calls === 1 ? a.promise : b.promise);
    const first = submission.send();
    state.scope = "workspace-b";
    state.input = "B stays pending";
    const second = submission.send();
    a.reject(new Error("Old A failed"));
    strictEqual(await first, false);
    strictEqual(submission.isSubmitting(), true);
    strictEqual(state.input, "B stays pending");
    deepStrictEqual(state.errors, []);
    b.resolve(false);
    strictEqual(await second, false);
    strictEqual(submission.isSubmitting(), false);
    strictEqual(state.input, "B stays pending");
  });

  test("a parked known create resumes with the visible draft without another create", async () => {
    const result = deferred<WelcomeSubmissionResult>();
    const resumed: { text: string; files?: File[] }[] = [];
    const { state, submission } = fixture(() => result.promise);
    const sent = submission.send();
    state.scope = "workspace-b";
    result.resolve({ kind: "created", resume: (text, files) => { resumed.push({ text, files }); return true; } });
    strictEqual(await sent, false);
    strictEqual(submission.outcome(), undefined);
    state.scope = "workspace-a";
    strictEqual(submission.outcome()?.kind, "created");
    state.input = "updated visible draft";
    strictEqual(await submission.send(), true);
    strictEqual(state.calls.length, 1);
    strictEqual(resumed[0].text, "updated visible draft");
    strictEqual(resumed[0].files?.[0].name, "draft.txt");
    strictEqual(state.input, "");
  });

  test("unconfirmed results refuse ordinary Send and cancellation, then require a new intent", async () => {
    let accepted = false;
    const { state, submission } = fixture(async () => accepted ? true : { kind: "unconfirmed" });
    strictEqual(await submission.send(), false);
    strictEqual(submission.outcome()?.kind, "unconfirmed");
    strictEqual(await submission.send(), false);
    strictEqual(await submission.confirmNewAttempt(async () => false), false);
    strictEqual(state.calls.length, 1);
    strictEqual(state.input, "  first request  ");
    accepted = true;
    strictEqual(await submission.confirmNewAttempt(async () => true), true);
    strictEqual(state.calls.length, 2);
    strictEqual(state.input, "");
  });

  test("a confirmation from another route cannot create in the current Workspace", async () => {
    const { state, submission } = fixture(async () => ({ kind: "unconfirmed" }));
    await submission.send();
    const decision = deferred<boolean>();
    const confirming = submission.confirmNewAttempt(() => decision.promise);
    state.scope = "workspace-b";
    state.input = "B draft";
    decision.resolve(true);
    strictEqual(await confirming, false);
    strictEqual(state.calls.length, 1);
    strictEqual(state.input, "B draft");
    state.scope = "workspace-a";
    strictEqual(submission.outcome()?.kind, "unconfirmed");
  });
}
