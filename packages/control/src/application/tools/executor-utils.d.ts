import type { ToolResolver } from './resolver';
import { CapabilityRegistry } from './capability-registry';
import type { ToolExecutor } from './executor';
export declare function buildPerRunCapabilityRegistry(executor: ToolExecutor): CapabilityRegistry;
export declare function toOpenAIFunctions(tools: ReturnType<ToolResolver['getAvailableTools']>): {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, import("./tool-definitions").ToolParameter>;
            required?: string[];
        };
    };
}[];
//# sourceMappingURL=executor-utils.d.ts.map