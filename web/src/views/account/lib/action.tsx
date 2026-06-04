/**
 * One small primitive for the account screens' hand-rolled async-action
 * machine.
 *
 * Almost every mutation path was the same shape: a `busy` signal, an `error`
 * signal, an optional `result` signal, and a `setBusy(true) / setError(null) /
 * try { ... } catch { setError(msg) } finally { setBusy(false) }` block, with
 * `(e as ApiError).message` copied inline ~a dozen times. {@link createAction}
 * captures that shape so the call sites only describe the async work + its
 * success side effects.
 *
 * Behavior is identical to the inline version:
 *   - `run()` sets `busy` true, clears `error`, awaits `fn`, stores the
 *     resolved value in `result`, and returns it; on throw it records the
 *     message in `error` (and rethrows nothing — `run` resolves to
 *     `undefined`). `busy` is always cleared in `finally`.
 *   - the success side effects (refetch / navigate / reset inputs) live in
 *     `fn` itself, after the awaited call, so they only run on success.
 *
 * Ported from takosumi dashboard-ui/src/lib/action.tsx.
 */
import { type Accessor, createSignal, type JSX, Show } from "solid-js";
import { ApiError } from "./api.ts";

/** Extract a user-facing message from a thrown value, ApiError-aware. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export interface Action<Args extends unknown[], Result> {
  /** Run the action; resolves to the result on success, `undefined` on error. */
  readonly run: (...args: Args) => Promise<Result | undefined>;
  readonly busy: Accessor<boolean>;
  readonly error: Accessor<string | null>;
  readonly result: Accessor<Result | undefined>;
  /**
   * Surface a message on the action's error signal without running `fn` —
   * for client-side pre-flight validation that shares the same error display.
   */
  readonly setError: (message: string | null) => void;
  /** Imperatively clear the surfaced error (e.g. when re-opening a form). */
  readonly clearError: () => void;
  /** Imperatively reset the stored result. */
  readonly clearResult: () => void;
}

export function createAction<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
): Action<Args, Result> {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [result, setResult] = createSignal<Result | undefined>(undefined);

  const run = async (...args: Args): Promise<Result | undefined> => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn(...args);
      setResult(() => r);
      return r;
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  return {
    run,
    busy,
    error,
    result,
    setError: (message) => setError(message),
    clearError: () => setError(null),
    clearResult: () => setResult(() => undefined),
  };
}

/** Render an action's surfaced error with the shared `.sign-in-error` style. */
export function ActionError(props: {
  error: Accessor<string | null>;
}): JSX.Element {
  return (
    <Show when={props.error()}>
      {(m) => <p class="sign-in-error">{m()}</p>}
    </Show>
  );
}
