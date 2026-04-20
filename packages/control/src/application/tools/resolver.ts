import type { D1Database } from "../../shared/types/bindings.ts";
import type {
  RegisteredTool,
  ToolCategory,
  ToolDefinition,
} from "./tool-definitions.ts";
import type { Env } from "../../shared/types/index.ts";
import type { SpaceRole } from "../../shared/types/index.ts";
import {
  CUSTOM_TOOLS,
  getCustomHandler,
  getCustomTool,
  isCustomTool,
} from "./custom/index.ts";
import type { McpClient } from "./mcp-client.ts";
import { loadMcpTools } from "./mcp-tools.ts";
import { logWarn } from "../../shared/utils/logger.ts";

export interface ToolResolverOptions {
  disabledCustomTools?: string[];
  mcpExposureContext?: {
    role?: SpaceRole;
    capabilities?: string[];
  };
}

export class ToolResolver {
  private mcpTools: Map<string, RegisteredTool> = new Map();
  private mcpClients: Map<string, McpClient> = new Map();
  private initialized = false;
  private disabledCustomTools: Set<string>;
  private _mcpFailedServers: string[] = [];
  private mcpExposureContext?: ToolResolverOptions["mcpExposureContext"];

  constructor(
    private db: D1Database,
    private spaceId: string,
    private env?: Env,
    options?: ToolResolverOptions,
  ) {
    this.disabledCustomTools = new Set(options?.disabledCustomTools || []);
    this.mcpExposureContext = options?.mcpExposureContext;
  }

  private isCustomToolEnabled(name: string): boolean {
    return !this.disabledCustomTools.has(name);
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    if (this.env) {
      const existingNames = new Set<string>(CUSTOM_TOOLS.map((t) => t.name));

      const mcpResult = await loadMcpTools(
        this.db,
        this.spaceId,
        this.env,
        existingNames,
        this.mcpExposureContext,
      );
      this.mcpTools = mcpResult.tools;
      this.mcpClients = mcpResult.clients;
      this._mcpFailedServers = mcpResult.failedServers;
    }

    this.initialized = true;
  }

  get mcpFailedServers(): string[] {
    return this._mcpFailedServers;
  }

  getAvailableTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = CUSTOM_TOOLS.filter((tool) =>
      this.isCustomToolEnabled(tool.name)
    );
    const addedNames = new Set(tools.map((t) => t.name));

    for (const [name, tool] of this.mcpTools) {
      if (!addedNames.has(name)) {
        tools.push(tool.definition);
        addedNames.add(name);
      }
    }

    return tools;
  }

  resolve(name: string): RegisteredTool | undefined {
    if (!name || typeof name !== "string") {
      logWarn(`Invalid tool name format: ${name}`, {
        module: "tools/resolver",
      });
      return undefined;
    }

    if (isCustomTool(name) && this.isCustomToolEnabled(name)) {
      const definition = getCustomTool(name);
      const handler = getCustomHandler(name);

      if (definition && handler) {
        return {
          definition,
          handler,
          custom: true,
        };
      }
    }

    return this.mcpTools.get(name);
  }

  exists(name: string): boolean {
    return (isCustomTool(name) && this.isCustomToolEnabled(name)) ||
      this.mcpTools.has(name);
  }

  isCustom(name: string): boolean {
    return isCustomTool(name) && this.isCustomToolEnabled(name);
  }

  getToolNamesByCategory(category: ToolCategory): string[] {
    return CUSTOM_TOOLS
      .filter((t) =>
        t.category === category && this.isCustomToolEnabled(t.name)
      )
      .map((t) => t.name);
  }
}

export async function createToolResolver(
  db: D1Database,
  spaceId: string,
  env?: Env,
  options?: ToolResolverOptions,
): Promise<ToolResolver> {
  const resolver = new ToolResolver(db, spaceId, env, options);
  await resolver.init();
  return resolver;
}
