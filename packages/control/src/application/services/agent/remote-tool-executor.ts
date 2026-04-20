import type { ToolObserver } from "../memory-graph/graph-models.ts";
import type {
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "../../tools/tool-definitions.ts";
import type { ToolExecutorLike } from "../../tools/executor.ts";

type RemoteToolCatalog = {
  tools: ToolDefinition[];
  mcpFailedServers: string[];
};

export interface RemoteToolExecutorIo {
  getToolCatalog(input: { runId: string }): Promise<RemoteToolCatalog>;
  executeTool(
    input: { runId: string; toolCall: ToolCall },
  ): Promise<ToolResult>;
  cleanupToolExecutor(input: { runId: string }): Promise<void>;
}

export class RemoteToolExecutor implements ToolExecutorLike {
  private readonly io: RemoteToolExecutorIo;
  private readonly runId: string;
  private readonly tools: ToolDefinition[];
  private readonly failedServers: string[];
  private observer: ToolObserver | null = null;

  private constructor(
    runId: string,
    catalog: RemoteToolCatalog,
    io: RemoteToolExecutorIo,
  ) {
    this.io = io;
    this.runId = runId;
    this.tools = catalog.tools;
    this.failedServers = catalog.mcpFailedServers;
  }

  static async create(
    runId: string,
    io: RemoteToolExecutorIo,
  ): Promise<RemoteToolExecutor> {
    const catalog = await io.getToolCatalog({ runId });
    return new RemoteToolExecutor(runId, {
      tools: Array.isArray(catalog.tools) ? catalog.tools : [],
      mcpFailedServers: Array.isArray(catalog.mcpFailedServers)
        ? catalog.mcpFailedServers
        : [],
    }, io);
  }

  getAvailableTools(): ToolDefinition[] {
    return this.tools;
  }

  get mcpFailedServers(): string[] {
    return this.failedServers;
  }

  setObserver(observer: ToolObserver): void {
    this.observer = observer;
  }

  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const startedAt = Date.now();
    const result = await this.io.executeTool({
      runId: this.runId,
      toolCall,
    });

    if (this.observer) {
      try {
        this.observer.observe({
          toolName: toolCall.name,
          arguments: toolCall.arguments,
          result: result.error ? "" : result.output,
          error: result.error,
          timestamp: startedAt,
          duration: Date.now() - startedAt,
        });
      } catch {
        // Best-effort observation.
      }
    }

    return result;
  }

  async cleanup(): Promise<void> {
    await this.io.cleanupToolExecutor({ runId: this.runId });
  }
}
