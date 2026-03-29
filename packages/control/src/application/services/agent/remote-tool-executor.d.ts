import type { ToolObserver } from '../memory-graph/graph-models';
import type { ToolCall, ToolDefinition, ToolResult } from '../../tools/tool-definitions';
import type { ToolExecutorLike } from '../../tools/executor';
type RemoteToolCatalog = {
    tools: ToolDefinition[];
    mcpFailedServers: string[];
};
export interface RemoteToolExecutorIo {
    getToolCatalog(input: {
        runId: string;
    }): Promise<RemoteToolCatalog>;
    executeTool(input: {
        runId: string;
        toolCall: ToolCall;
    }): Promise<ToolResult>;
    cleanupToolExecutor(input: {
        runId: string;
    }): Promise<void>;
}
export declare class RemoteToolExecutor implements ToolExecutorLike {
    private readonly io;
    private readonly runId;
    private readonly tools;
    private readonly failedServers;
    private observer;
    private constructor();
    static create(runId: string, io: RemoteToolExecutorIo): Promise<RemoteToolExecutor>;
    getAvailableTools(): ToolDefinition[];
    get mcpFailedServers(): string[];
    setObserver(observer: ToolObserver): void;
    execute(toolCall: ToolCall): Promise<ToolResult>;
    cleanup(): Promise<void>;
}
export {};
//# sourceMappingURL=remote-tool-executor.d.ts.map