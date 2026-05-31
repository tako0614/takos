/**
 * Typed test helpers for `Database` / `SqlDatabaseBinding` mocks.
 *
 * Test mocks for the drizzle wrapper (`Database`) and the raw SQL binding
 * (`SqlDatabaseBinding`) almost always implement only a tiny subset of the
 * real surface (`select` / `insert` / `prepare`, etc.). Historically tests
 * cast the partial literal with `as unknown as Database` /
 * `as unknown as SqlDatabaseBinding` at the call site, which scatters
 * unsafe casts across the suite and hides the fact that the cast is the
 * same intentional narrowing each time.
 *
 * `asTestDatabase` and `asTestSqlDatabaseBinding` centralise the bridge in
 * a single place. Both helpers wrap the partial in a `Proxy` that throws
 * on any unstubbed access, so unintended use of an unimplemented method
 * surfaces an actionable error at the call site rather than a silent
 * `undefined is not a function`. The proxy is then declared as
 * `Database & T` / `SqlDatabaseBinding & T` via a single-step type
 * assertion (not `as unknown as`) — the proxy genuinely covers the full
 * surface (returning a throwing function for unknown methods), so the
 * structural assertion is sound.
 */
import type { Database } from "@/db";
import type { SqlDatabaseBinding } from "@/shared/types/bindings.ts";

function wrapWithThrowingProxy<T extends object>(
  partial: T,
  label: string,
): T {
  return new Proxy(partial, {
    get(target, prop, receiver) {
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      // `then` is checked by Promise resolution machinery; returning
      // `undefined` lets `await` treat the proxy as a non-thenable.
      if (prop === "then") return undefined;
      return () => {
        throw new Error(
          `${label}: method '${String(prop)}' is not stubbed for this test`,
        );
      };
    },
  });
}

/**
 * Wrap a drizzle-shape partial as `Database`. Test mocks typically only
 * implement the chained methods the code under test exercises
 * (`select` / `insert` / `update` / `delete` / `_` / etc.). The returned
 * type is `Database & T`, which preserves any extra fields the test mock
 * attaches (e.g. capture maps, spy state) so call sites can read them
 * back without an extra cast.
 */
export function asTestDatabase<T extends object>(partial: T): Database & T {
  return wrapWithThrowingProxy(partial, "asTestDatabase") as Database & T;
}

/**
 * Wrap a raw-binding-shape partial as `SqlDatabaseBinding`. Test mocks
 * typically only implement `prepare` (and the prepared-statement chain
 * underneath). The returned type is `SqlDatabaseBinding & T`, which
 * preserves any extra fields the test mock attaches.
 */
export function asTestSqlDatabaseBinding<T extends object>(
  partial: T,
): SqlDatabaseBinding & T {
  return wrapWithThrowingProxy(
    partial,
    "asTestSqlDatabaseBinding",
  ) as SqlDatabaseBinding & T;
}
