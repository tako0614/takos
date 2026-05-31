/**
 * Typed test helpers for dep-injection stubs.
 *
 * Many test files override service `deps.*` properties with placeholder
 * functions that the test never actually invokes (the real call paths
 * happen via deps overrides set in the test's setup block). Historically
 * those placeholders were written as:
 *
 *   `mocks.xxx = ((..._args: any[]) => undefined) as any`
 *
 * which scatters `as any` casts across the suite and gives no signal if
 * the unimplemented stub is accidentally called.
 *
 * `noopDep` and `asyncNoopDep` consolidate the cast in a single place and
 * make the stub throw on accidental invocation. The argument `label`
 * surfaces a descriptive error so tests can pinpoint the missing override.
 */

/**
 * Build a typed sync stub for a dep function. The returned stub throws
 * if invoked — tests that exercise the dep path must override it with a
 * real implementation. The cast is centralised inside this helper; the
 * `T extends (...args: never[]) => unknown` constraint ensures only
 * function types are accepted.
 */
export function noopDep<T extends (...args: never[]) => unknown>(
  label: string,
): T {
  return ((..._args: unknown[]) => {
    throw new Error(
      `noopDep '${label}' was called without an override`,
    );
  }) as unknown as T;
}

/**
 * Async variant of {@link noopDep}. Returns a rejected promise so
 * `await`-based call sites surface the missing override as a test
 * failure.
 */
export function asyncNoopDep<
  T extends (...args: never[]) => Promise<unknown>,
>(label: string): T {
  return ((..._args: unknown[]) =>
    Promise.reject(
      new Error(`asyncNoopDep '${label}' was called without an override`),
    )) as unknown as T;
}

/**
 * Wrap a partial mock as a target class/interface that has private
 * members (e.g. `DeploymentService.encryptionKey`). The returned proxy
 * forwards property access to the partial when present, and throws with
 * a descriptive error otherwise. A single-step structural assertion
 * declares the result as `T`; the proxy genuinely covers the surface
 * (throwing on any unstubbed method) so the assertion is sound.
 */
export function asTestClassMock<T extends object, M extends object>(
  partial: M,
  label: string,
): T {
  return new Proxy(partial, {
    get(target, prop, receiver) {
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      if (prop === "then") return undefined;
      return () => {
        throw new Error(
          `${label}: method '${String(prop)}' is not stubbed for this test`,
        );
      };
    },
  }) as unknown as T;
}
