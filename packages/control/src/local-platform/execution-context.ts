import type { PlatformExecutionContext } from "../shared/types/bindings.ts";

/**
 * Node/Hono bootstrap shim for Workers-style background tasks.
 *
 * Local mode still uses the Workers-shaped execution contract at the
 * application boundary, but maps it to a lightweight in-process scheduler.
 */
export function createLocalExecutionContext(): PlatformExecutionContext {
  const pending = new Set<Promise<unknown>>();

  return {
    waitUntil(promise: Promise<unknown>): void {
      const tracked = Promise.resolve(promise)
        .catch(() =>
          undefined /* waitUntil: background task errors must not propagate to request lifecycle */
        )
        .finally(() => pending.delete(tracked));
      pending.add(tracked);
    },
    passThroughOnException(): void {
      // No-op in local mode. Node's request lifecycle owns exception flow.
    },
    props: {},
  };
}
