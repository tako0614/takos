import type { Env } from '../../../shared/types';
import { type RunNotifierEmitPayload } from '../run-notifier';
export declare function persistRunEvent(env: Env, runId: string, type: string, data: unknown): Promise<number>;
export declare function emitToNotifier(env: Env, runId: string, payload: RunNotifierEmitPayload, useTimeout?: boolean): Promise<Response>;
export declare function persistAndEmitEvent(env: Env, runId: string, type: string, data: unknown, useTimeout?: boolean): Promise<void>;
export declare function fetchWithTimeout(stub: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}, request: Request | URL | string, timeoutMs?: number): Promise<Response>;
//# sourceMappingURL=run-events.d.ts.map