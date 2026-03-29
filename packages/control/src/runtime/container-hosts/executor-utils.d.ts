/**
 * Shared utility functions, response helpers, and types for the executor-host
 * subsystem.  All proxy handlers and the main fetch entrypoint depend on these.
 */
import type { DurableObjectNamespace, R2Bucket, Queue } from '../../shared/types/bindings.ts';
import { base64ToBytes } from '../../shared/utils/encoding-utils';
import type { DbEnv, StorageEnv, AiEnv, IndexJobQueueMessage } from '../../shared/types';
export interface AgentExecutorEnv extends DbEnv, StorageEnv, AiEnv {
    EXECUTOR_CONTAINER: ContainerNamespace;
    RUN_NOTIFIER: DurableObjectNamespace;
    TAKOS_OFFLOAD: R2Bucket;
    TAKOS_EGRESS: {
        fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    };
    RUNTIME_HOST?: {
        fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    };
    BROWSER_HOST?: {
        fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    };
    /** Service binding to main takos-web worker for control RPC forwarding. */
    TAKOS_CONTROL?: {
        fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    };
    /** Shared secret for authenticating forwarded requests to the main worker. */
    EXECUTOR_PROXY_SECRET?: string;
    INDEX_QUEUE?: Queue<IndexJobQueueMessage>;
    CONTROL_RPC_BASE_URL?: string;
}
export type Env = AgentExecutorEnv;
import type { AgentExecutorDispatchPayload, AgentExecutorDispatchResult } from './executor-dispatch';
/** Token metadata stored alongside each random proxy token. */
export interface ProxyTokenInfo {
    runId: string;
    serviceId: string;
    capability: ProxyCapability;
}
export interface ExecutorContainerStub {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    dispatchStart(body: AgentExecutorDispatchPayload): Promise<AgentExecutorDispatchResult>;
    verifyProxyToken(token: string): Promise<ProxyTokenInfo | null>;
}
export interface ContainerNamespace extends DurableObjectNamespace {
    get(id: unknown): ExecutorContainerStub;
    getByName(name: string): ExecutorContainerStub;
}
/**
 * Wrapper type for the Cloudflare AI binding that accepts dynamic model names.
 * The built-in `Ai` type requires a specific `AiModels` key, but proxy callers
 * send arbitrary model name strings resolved at runtime.
 */
export interface AiRunBinding {
    run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}
export type ProxyCapability = 'bindings' | 'control';
export declare function unauthorized(): Response;
export declare function ok(data: unknown): Response;
export declare function err(message: string, status?: number): Response;
export declare function classifyProxyError(e: unknown): {
    status: number;
    message: string;
};
export declare function headersToRecord(headers: Headers): Record<string, string>;
export { base64ToBytes };
export declare function readRunServiceId(body: Record<string, unknown>): string | null;
export declare function recordProxyUsage(path: string): void;
export declare function getProxyUsageSnapshot(): Record<string, number>;
/**
 * Check if a path should be forwarded to the control plane.
 */
export declare function isControlRpcPath(path: string): boolean;
/**
 * Forward a control RPC request to the main takos-web worker.
 * Returns null if TAKOS_CONTROL is not configured (fall through to legacy handlers).
 */
export declare function forwardToControlPlane(path: string, body: Record<string, unknown>, env: Env): Promise<Response | null>;
//# sourceMappingURL=executor-utils.d.ts.map