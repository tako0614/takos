import { type Accessor, createEffect, createSignal, untrack } from "solid-js";
import { createLatestRequest } from "../lib/createLatestRequest.ts";

// A created thread is not yet delivery of the first message. Keep its exact
// continuation; an uncertain write must never be treated as a safe retry.
export type WelcomeSubmissionOutcome =
  | { kind: "created"; resume: (message: string, files?: File[]) => boolean }
  | { kind: "unconfirmed" };
export type WelcomeSubmissionResult = boolean | WelcomeSubmissionOutcome;

export interface WelcomeSubmissionOptions {
  input: Accessor<string>;
  setInput: (value: string) => void;
  attachedFiles: Accessor<File[]>;
  setAttachedFiles: (files: File[]) => void;
  scope: Accessor<string | undefined>;
  submit: (message: string, files?: File[]) => WelcomeSubmissionResult | Promise<WelcomeSubmissionResult>;
  onClear: () => void;
  onError: (error: unknown) => void;
}

export function useWelcomeSubmission(options: WelcomeSubmissionOptions) {
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [outcome, setOutcome] = createSignal<WelcomeSubmissionOutcome>();
  const requests = createLatestRequest();
  const drafts = new Map<string | undefined, { input: string; files: File[]; outcome?: WelcomeSubmissionOutcome }>();
  const pending = new Map<string | undefined, object>();
  let draftScope = options.scope();
  let disposed = false;
  createEffect(() => {
    // A new Workspace owns its own busy state. Retire the old finally/error
    // branches too, so their completion cannot unlock a newer submission.
    const nextScope = options.scope();
    untrack(() => {
      if (draftScope !== nextScope) {
        drafts.set(draftScope, { input: options.input(), files: [...options.attachedFiles()], outcome: outcome() });
        draftScope = nextScope;
        const draft = drafts.get(nextScope);
        options.setInput(draft?.input ?? "");
        options.setAttachedFiles(draft?.files ?? []);
        setOutcome(draft?.outcome);
      }
      requests.next();
      setIsSubmitting(pending.has(nextScope));
    });
  });
  const send = async (): Promise<boolean> => {
    if (disposed || isSubmitting()) return false;
    if (outcome()?.kind === "unconfirmed") return false;
    const input = options.input();
    const files = [...options.attachedFiles()];
    const trimmed = input.trim();
    if (!trimmed && files.length === 0) return false;
    const scope = options.scope();
    const token = {};
    pending.set(scope, token);
    const claim = requests.claim(() => !disposed && options.scope() === scope);
    const isCurrent = claim.won;
    const remember = (result: WelcomeSubmissionOutcome) => {
      if (disposed || pending.get(scope) !== token) return;
      if (draftScope === scope) setOutcome(result);
      else {
        const draft = drafts.get(scope);
        if (draft) draft.outcome = result;
      }
    };
    setIsSubmitting(true);
    try {
      const current = outcome();
      const accepted = current?.kind === "created"
        ? current.resume(trimmed, files.length > 0 ? files : undefined)
        : await options.submit(trimmed, files.length > 0 ? files : undefined);
      if (typeof accepted === "object") {
        remember(accepted);
        return false;
      }
      if (accepted && !isCurrent()) remember({ kind: "unconfirmed" });
      if (!accepted || !isCurrent()) return false;
      setOutcome(undefined);
      if (options.input() === input) {
        options.setInput("");
        options.onClear();
      }
      options.setAttachedFiles(
        options.attachedFiles().filter((file) => !files.includes(file)),
      );
      return true;
    } catch (error) {
      remember({ kind: "unconfirmed" });
      if (isCurrent()) options.onError(error);
      return false;
    } finally {
      if (pending.get(scope) === token) {
        pending.delete(scope);
        if (!disposed && draftScope === scope) setIsSubmitting(false);
      }
    }
  };

  const confirmNewAttempt = async (confirm: () => Promise<boolean>): Promise<boolean> => {
    if (disposed || isSubmitting() || !outcome()) return false;
    const scope = options.scope();
    const claim = requests.claim(() => !disposed && options.scope() === scope);
    setIsSubmitting(true);
    try {
      if (!await confirm() || !claim.won()) return false;
      setOutcome(undefined);
      setIsSubmitting(false);
      return await send();
    } finally {
      if (claim.won()) setIsSubmitting(false);
    }
  };

  const dispose = () => {
    disposed = true;
    requests.next();
    drafts.clear();
    pending.clear();
    setIsSubmitting(false);
  };
  return { send, isSubmitting, outcome, confirmNewAttempt, dispose };
}
