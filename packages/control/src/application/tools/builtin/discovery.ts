import type { ToolDefinition, ToolHandler, ToolContext } from '../types';

interface ToolExecutorLike {
  execute(call: { id: string; name: string; arguments: Record<string, unknown> }): Promise<{ output: string; error?: string }>;
}

const NO_REGISTRY_ERROR = JSON.stringify({
  error: 'All tools are already available. Call the tool you need directly by name.',
});

export const CAPABILITY_SEARCH: ToolDefinition = {
  name: 'capability_search',
  description:
    'Search for tools by capability or intent. Use this when you need to find the right tool quickly or explore a broader capability family.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language query describing the capability you need (e.g., "upload file to R2", "create KV namespace").',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return. Default: 10.',
      },
    },
    required: ['query'],
  },
};

export const capabilitySearchHandler: ToolHandler = async (args, ctx) => {
  const registry = ctx.capabilityRegistry;
  if (!registry) return NO_REGISTRY_ERROR;

  const query = String(args.query ?? '');
  const limit = typeof args.limit === 'number' ? args.limit : 10;

  const results = registry.search(query, { limit }).filter(d => d.discoverable);

  return JSON.stringify({
    results: results.map(d => ({
      id: d.id,
      kind: d.kind,
      name: d.name,
      summary: d.summary,
      family: d.family,
      namespace: d.namespace,
      risk_level: d.risk_level,
    })),
    total_available: registry.size,
    hint: 'Use capability_invoke to execute any of these tools.',
  });
};

export const CAPABILITY_FAMILIES: ToolDefinition = {
  name: 'capability_families',
  description:
    'List all tool/skill families and their sizes. Use this to explore what categories of capabilities are available.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const capabilityFamiliesHandler: ToolHandler = async (_args, ctx) => {
  const registry = ctx.capabilityRegistry;
  if (!registry) return NO_REGISTRY_ERROR;

  return JSON.stringify({
    families: registry.families(),
    total_capabilities: registry.size,
  });
};

export const CAPABILITY_INVOKE: ToolDefinition = {
  name: 'capability_invoke',
  description:
    'Execute a tool discovered via capability_search. The tool is resolved and executed with the same permission checks as direct calls.',
  category: 'workspace',
  parameters: {
    type: 'object',
    properties: {
      tool_name: {
        type: 'string',
        description: 'The name of the tool to execute (as returned by capability_search).',
      },
      arguments: {
        type: 'object',
        description: 'Arguments to pass to the tool. Check capability_search results for tool descriptions.',
      },
    },
    required: ['tool_name'],
  },
};

export const capabilityInvokeHandler: ToolHandler = async (args, ctx) => {
  const toolName = String(args.tool_name ?? '');
  if (!toolName) {
    throw new Error('capability_invoke: tool_name is required.');
  }

  if (toolName === 'capability_invoke') {
    throw new Error('capability_invoke: cannot invoke itself.');
  }

  const registry = ctx.capabilityRegistry;
  if (registry) {
    const descriptor = registry.get(`tool:${toolName}`);
    if (descriptor && !descriptor.discoverable) {
      throw new Error(`capability_invoke: tool "${toolName}" is not available for invocation.`);
    }
  }

  const executor = (ctx as ToolContext & { _toolExecutor?: ToolExecutorLike })._toolExecutor;
  if (!executor) {
    throw new Error('capability_invoke: Tool executor not available.');
  }

  const toolArgs = (typeof args.arguments === 'object' && args.arguments != null)
    ? args.arguments as Record<string, unknown>
    : {};

  const result = await executor.execute({
    id: `invoke_${Date.now()}`,
    name: toolName,
    arguments: toolArgs,
  });

  if (result.error) {
    throw new Error(`capability_invoke "${toolName}": ${result.error}`);
  }
  return result.output;
};

export const DISCOVERY_TOOLS: ToolDefinition[] = [CAPABILITY_SEARCH, CAPABILITY_FAMILIES, CAPABILITY_INVOKE];
export const DISCOVERY_HANDLERS: Record<string, ToolHandler> = {
  capability_search: capabilitySearchHandler,
  capability_families: capabilityFamiliesHandler,
  capability_invoke: capabilityInvokeHandler,
};
