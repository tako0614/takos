export interface AgentExecutorDispatchPayload {
    runId: string;
    workerId: string;
    serviceId?: string;
    model?: string;
    leaseVersion?: number;
}
export interface AgentExecutorControlConfig {
    controlRpcBaseUrl?: string;
    controlRpcToken: string;
}
export interface AgentExecutorStartPayload extends AgentExecutorDispatchPayload, AgentExecutorControlConfig {
}
export interface AgentExecutorDispatchResult {
    ok: boolean;
    status: number;
    body: string;
}
export interface AgentExecutorDispatchTarget {
    startAndWaitForPorts(ports?: number | number[]): Promise<void>;
    fetch(request: Request): Promise<Response>;
}
export interface AgentExecutorDispatchStub {
    dispatchStart(body: AgentExecutorDispatchPayload): Promise<AgentExecutorDispatchResult>;
}
export declare function resolveAgentExecutorServiceId(body: AgentExecutorDispatchPayload): string | null;
export declare function dispatchAgentExecutorStart(target: AgentExecutorDispatchTarget, body: AgentExecutorDispatchPayload, controlConfig: AgentExecutorControlConfig): Promise<AgentExecutorDispatchResult>;
export declare function forwardAgentExecutorDispatch(stub: AgentExecutorDispatchStub, body: AgentExecutorDispatchPayload): Promise<Response>;
//# sourceMappingURL=executor-dispatch.d.ts.map