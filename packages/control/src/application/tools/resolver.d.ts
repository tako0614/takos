import type { D1Database } from '../../shared/types/bindings.ts';
import type { ToolDefinition, RegisteredTool, ToolCategory } from './tool-definitions';
import type { Env } from '../../shared/types';
import type { SpaceRole } from '../../shared/types';
export interface ToolResolverOptions {
    disabledBuiltinTools?: string[];
    mcpExposureContext?: {
        role?: SpaceRole;
        capabilities?: string[];
    };
}
export declare class ToolResolver {
    private db;
    private spaceId;
    private env?;
    private mcpTools;
    private mcpClients;
    private initialized;
    private disabledBuiltinTools;
    private _mcpFailedServers;
    private mcpExposureContext?;
    constructor(db: D1Database, spaceId: string, env?: Env | undefined, options?: ToolResolverOptions);
    private isBuiltinToolEnabled;
    init(): Promise<void>;
    get mcpFailedServers(): string[];
    getAvailableTools(): ToolDefinition[];
    resolve(name: string): RegisteredTool | undefined;
    exists(name: string): boolean;
    isBuiltin(name: string): boolean;
    getToolNamesByCategory(category: ToolCategory): string[];
}
export declare function createToolResolver(db: D1Database, spaceId: string, env?: Env, options?: ToolResolverOptions): Promise<ToolResolver>;
//# sourceMappingURL=resolver.d.ts.map