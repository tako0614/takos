import type { ToolResolver } from "./resolver.ts";
import { CapabilityRegistry } from "./capability-registry.ts";
import { buildToolDescriptor } from "./descriptor-builder.ts";
import type { CapabilityDescriptor } from "./capability-types.ts";
import type { ToolExecutor } from "./executor.ts";

export function buildPerRunCapabilityRegistry(
  executor: ToolExecutor,
  extraDescriptors: CapabilityDescriptor[] = [],
): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.registerAll(
    executor.getAvailableTools().map((tool) => buildToolDescriptor(tool)),
  );
  registry.registerAll(extraDescriptors);
  return registry;
}

export function toOpenAIFunctions(
  tools: ReturnType<ToolResolver["getAvailableTools"]>,
) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
