import type { Env } from '../../../shared/types';
import type { DurableObjectStubBinding } from '../../../shared/types/bindings.ts';
import type { RunNotifierEmitPayload } from './run-notifier-payload';
type RunNotifierStub = DurableObjectStubBinding;
export declare function getRunNotifierStub(env: Pick<Env, 'RUN_NOTIFIER'>, runId: string): RunNotifierStub;
export declare function buildRunNotifierEmitRequest(payload: RunNotifierEmitPayload, signal?: AbortSignal): Request;
export {};
//# sourceMappingURL=client.d.ts.map