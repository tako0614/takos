import type { PlatformExecutionContext } from '../shared/types/bindings.ts';
/**
 * Node/Hono bootstrap shim for Workers-style background tasks.
 *
 * Local mode still uses the Workers-shaped execution contract at the
 * application boundary, but maps it to a lightweight in-process scheduler.
 */
export declare function createLocalExecutionContext(): PlatformExecutionContext;
//# sourceMappingURL=execution-context.d.ts.map