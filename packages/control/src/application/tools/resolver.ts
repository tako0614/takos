import type { D1Database } from '../../shared/types/bindings.ts';
import type { ToolDefinition, RegisteredTool, ToolCategory } from './types';
import type { Env } from '../../shared/types';
import type { WorkspaceRole } from '../../shared/types';
import { BUILTIN_TOOLS, isBuiltinTool, getBuiltinTool, getBuiltinHandler } from './builtin';
import { McpClient } from './mcp-client';
import { loadMcpTools } from './loaders/mcp-tools';
import { logWarn } from '../../shared/utils/logger';

export interface ToolResolverOptions {
  disabledBuiltinTools?: string[];
  mcpExposureContext?: {
    role?: WorkspaceRole;
    capabilities?: string[];
  };
}

export class ToolResolver {
  private mcpTools: Map<string, RegisteredTool> = new Map();
  private mcpClients: Map<string, McpClient> = new Map();
  private initialized = false;
  private disabledBuiltinTools: Set<string>;
  private _mcpFailedServers: string[] = [];
  private mcpExposureContext?: ToolResolverOptions['mcpExposureContext'];

  constructor(
    private db: D1Database,
    private spaceId: string,
    private env?: Env,
    options?: ToolResolverOptions
  ) {
    this.disabledBuiltinTools = new Set(options?.disabledBuiltinTools || []);
    this.mcpExposureContext = options?.mcpExposureContext;
  }

  private isBuiltinToolEnabled(name: string): boolean {
    return !this.disabledBuiltinTools.has(name);
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    if (this.env) {
      const existingNames = new Set<string>(BUILTIN_TOOLS.map(t => t.name));

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
    const tools: ToolDefinition[] = BUILTIN_TOOLS.filter((tool) => this.isBuiltinToolEnabled(tool.name));
    const addedNames = new Set(tools.map(t => t.name));

    for (const [name, tool] of this.mcpTools) {
      if (!addedNames.has(name)) {
        tools.push(tool.definition);
        addedNames.add(name);
      }
    }

    return tools;
  }

  resolve(name: string): RegisteredTool | undefined {
    if (!name || typeof name !== 'string') {
      logWarn(`Invalid tool name format: ${name}`, { module: 'tools/resolver' });
      return undefined;
    }

    if (isBuiltinTool(name) && this.isBuiltinToolEnabled(name)) {
      const definition = getBuiltinTool(name);
      const handler = getBuiltinHandler(name);

      if (definition && handler) {
        return {
          definition,
          handler,
          builtin: true,
        };
      }
    }

    return this.mcpTools.get(name);
  }

  exists(name: string): boolean {
    return (isBuiltinTool(name) && this.isBuiltinToolEnabled(name)) || this.mcpTools.has(name);
  }

  isBuiltin(name: string): boolean {
    return isBuiltinTool(name) && this.isBuiltinToolEnabled(name);
  }

  getToolNamesByCategory(category: ToolCategory): string[] {
    return BUILTIN_TOOLS
      .filter(t => t.category === category && this.isBuiltinToolEnabled(t.name))
      .map(t => t.name);
  }
}

export async function createToolResolver(
  db: D1Database,
  spaceId: string,
  env?: Env,
  options?: ToolResolverOptions
): Promise<ToolResolver> {
  const resolver = new ToolResolver(db, spaceId, env, options);
  await resolver.init();
  return resolver;
}
