import type { ToolResolver } from './resolver';
import { CapabilityRegistry } from './capability-registry';
import { buildToolDescriptor } from './descriptor-builder';
import type { ToolExecutor } from './executor';

export function buildPerRunCapabilityRegistry(executor: ToolExecutor): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.registerAll(executor.getAvailableTools().map((tool) => buildToolDescriptor(tool)));
  return registry;
}

export function toOpenAIFunctions(tools: ReturnType<ToolResolver['getAvailableTools']>) {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
