import type {
  ToolContext,
  ToolDefinition,
  ToolHandler,
} from "../tool-definitions.ts";

interface ToolExecutorLike {
  execute(
    call: { id: string; name: string; arguments: Record<string, unknown> },
  ): Promise<{ output: string; error?: string }>;
  getAvailableTools?(): ToolDefinition[];
}

const NO_REGISTRY_ERROR = JSON.stringify({
  error:
    "All tools are already available. Call the tool you need directly by name.",
});

const ROUTER_TOOL_NAMES = new Set([
  "toolbox",
  "capability_search",
  "capability_families",
  "capability_describe",
  "capability_invoke",
]);

export const TOOLBOX: ToolDefinition = {
  name: "toolbox",
  description:
    "One entry point for the full tool catalog. Use action=search to find tools, describe to inspect schemas, call to execute a tool, and families to list capability groups.",
  category: "space",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Toolbox operation to run.",
        enum: ["search", "describe", "call", "families"],
      },
      query: {
        type: "string",
        description: "Natural language search query for action=search.",
      },
      limit: {
        type: "number",
        description: "Maximum search results. Default: 10.",
      },
      tool_name: {
        type: "string",
        description: "Tool name for action=describe or action=call.",
      },
      tool_names: {
        type: "array",
        description: "Tool names for action=describe.",
        items: {
          type: "string",
          description: "Tool name.",
        },
      },
      arguments: {
        type: "object",
        description: "Arguments passed to the target tool for action=call.",
      },
    },
    required: ["action"],
  },
};

export const CAPABILITY_SEARCH: ToolDefinition = {
  name: "capability_search",
  description:
    "Search for tools by capability or intent. Use this when you need to find the right tool quickly or explore a broader capability family.",
  category: "space",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          'Natural language query describing the capability you need (e.g., "upload file to R2", "create KV namespace").',
      },
      limit: {
        type: "number",
        description: "Maximum number of results to return. Default: 10.",
      },
    },
    required: ["query"],
  },
};

export const capabilitySearchHandler: ToolHandler = async (args, ctx) => {
  return toolboxHandler({ ...args, action: "search" }, ctx);
};

export const CAPABILITY_FAMILIES: ToolDefinition = {
  name: "capability_families",
  description:
    "List all tool/skill families and their sizes. Use this to explore what categories of capabilities are available.",
  category: "space",
  parameters: {
    type: "object",
    properties: {},
  },
};

export const capabilityFamiliesHandler: ToolHandler = async (_args, ctx) => {
  return toolboxHandler({ action: "families" }, ctx);
};

export const CAPABILITY_INVOKE: ToolDefinition = {
  name: "capability_invoke",
  description:
    "Execute a tool discovered via capability_search or described via capability_describe. The tool is resolved and executed with the same permission checks as direct calls.",
  category: "space",
  parameters: {
    type: "object",
    properties: {
      tool_name: {
        type: "string",
        description:
          "The name of the tool to execute (as returned by capability_search).",
      },
      arguments: {
        type: "object",
        description:
          "Arguments to pass to the tool. Use capability_describe first when you need the tool's input schema.",
      },
    },
    required: ["tool_name"],
  },
};

export const CAPABILITY_DESCRIBE: ToolDefinition = {
  name: "capability_describe",
  description:
    "Get full descriptions and input schemas for tools discovered via capability_search. Use this before capability_invoke when arguments are not obvious.",
  category: "space",
  parameters: {
    type: "object",
    properties: {
      tool_name: {
        type: "string",
        description:
          "Single tool name to describe. Use tool_names for multiple tools.",
      },
      tool_names: {
        type: "array",
        description:
          "Tool names to describe. Keep this small and describe only candidates you may invoke.",
        items: {
          type: "string",
          description: "Tool name returned by capability_search.",
        },
      },
    },
  },
};

export const capabilityDescribeHandler: ToolHandler = async (args, ctx) => {
  return toolboxHandler({ ...args, action: "describe" }, ctx);
};

export const capabilityInvokeHandler: ToolHandler = async (args, ctx) => {
  return toolboxHandler({ ...args, action: "call" }, ctx);
};

export const toolboxHandler: ToolHandler = async (args, ctx) => {
  const action = String(args.action ?? "").trim();
  switch (action) {
    case "search":
      return toolboxSearch(args, ctx);
    case "families":
      return toolboxFamilies(ctx);
    case "describe":
      return toolboxDescribe(args, ctx);
    case "call":
      return toolboxCall(args, ctx);
    default:
      throw new Error(
        "toolbox: action must be one of search, describe, call, families.",
      );
  }
};

async function toolboxSearch(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const registry = ctx.capabilityRegistry;
  if (!registry) return NO_REGISTRY_ERROR;

  const query = String(args.query ?? "");
  const limit = typeof args.limit === "number" && args.limit > 0
    ? Math.min(args.limit, 50)
    : 10;

  const results = registry
    .search(query, { limit: limit + ROUTER_TOOL_NAMES.size })
    .filter((d) => d.discoverable && !ROUTER_TOOL_NAMES.has(d.name))
    .slice(0, limit);

  return JSON.stringify({
    results: results.map((d) => ({
      id: d.id,
      kind: d.kind,
      name: d.name,
      summary: d.summary,
      family: d.family,
      namespace: d.namespace,
      risk_level: d.risk_level,
    })),
    total_available: registry.all().filter((d) =>
      !ROUTER_TOOL_NAMES.has(d.name)
    )
      .length,
    hint:
      "Use toolbox action=describe to inspect schemas, then action=call to execute the selected tool.",
  });
}

async function toolboxFamilies(ctx: ToolContext): Promise<string> {
  const registry = ctx.capabilityRegistry;
  if (!registry) return NO_REGISTRY_ERROR;

  const counts = new Map<string, number>();
  for (const descriptor of registry.all()) {
    if (ROUTER_TOOL_NAMES.has(descriptor.name) || !descriptor.family) continue;
    counts.set(descriptor.family, (counts.get(descriptor.family) ?? 0) + 1);
  }

  return JSON.stringify({
    families: [...counts.entries()]
      .map(([family, count]) => ({ family, count }))
      .sort((a, b) => a.family.localeCompare(b.family)),
    total_capabilities: registry.all().filter((d) =>
      !ROUTER_TOOL_NAMES.has(d.name)
    ).length,
  });
}

async function toolboxDescribe(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const toolNames = normalizeToolNames(args);
  if (toolNames.length === 0) {
    throw new Error("toolbox describe: tool_name or tool_names is required.");
  }

  const executor =
    (ctx as ToolContext & { _toolExecutor?: ToolExecutorLike })._toolExecutor;
  if (!executor?.getAvailableTools) {
    throw new Error("toolbox describe: Tool catalog not available.");
  }

  const toolsByName = new Map(
    executor.getAvailableTools().map((tool) => [tool.name, tool]),
  );

  return JSON.stringify({
    tools: toolNames.map((name) => {
      const tool = toolsByName.get(name);
      if (!tool) {
        return { name, available: false };
      }
      return {
        name: tool.name,
        available: true,
        description: tool.description,
        category: tool.category,
        namespace: tool.namespace,
        family: tool.family,
        risk_level: tool.risk_level,
        side_effects: tool.side_effects,
        required_roles: tool.required_roles,
        required_capabilities: tool.required_capabilities,
        parameters: tool.parameters,
      };
    }),
    hint:
      "Use toolbox action=call with tool_name and arguments matching the described parameters.",
  });
}

async function toolboxCall(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const toolName = String(args.tool_name ?? "");
  if (!toolName) {
    throw new Error("toolbox call: tool_name is required.");
  }

  if (ROUTER_TOOL_NAMES.has(toolName)) {
    throw new Error(`toolbox call: cannot invoke router tool "${toolName}".`);
  }

  const registry = ctx.capabilityRegistry;
  if (registry) {
    const descriptor = registry.get(`tool:${toolName}`);
    if (descriptor && !descriptor.discoverable) {
      throw new Error(
        `toolbox call: tool "${toolName}" is not available for invocation.`,
      );
    }
  }

  const executor =
    (ctx as ToolContext & { _toolExecutor?: ToolExecutorLike })._toolExecutor;
  if (!executor) {
    throw new Error("toolbox call: Tool executor not available.");
  }

  const toolArgs =
    (typeof args.arguments === "object" && args.arguments != null)
      ? args.arguments as Record<string, unknown>
      : {};

  const result = await executor.execute({
    id: `invoke_${Date.now()}`,
    name: toolName,
    arguments: toolArgs,
  });

  if (result.error) {
    throw new Error(`toolbox call "${toolName}": ${result.error}`);
  }
  return result.output;
}

export const DISCOVERY_TOOLS: ToolDefinition[] = [
  TOOLBOX,
  CAPABILITY_SEARCH,
  CAPABILITY_FAMILIES,
  CAPABILITY_DESCRIBE,
  CAPABILITY_INVOKE,
];
export const DISCOVERY_HANDLERS: Record<string, ToolHandler> = {
  toolbox: toolboxHandler,
  capability_search: capabilitySearchHandler,
  capability_families: capabilityFamiliesHandler,
  capability_describe: capabilityDescribeHandler,
  capability_invoke: capabilityInvokeHandler,
};

function normalizeToolNames(args: Record<string, unknown>): string[] {
  const values: unknown[] = [];
  if (typeof args.tool_name === "string") {
    values.push(args.tool_name);
  }
  if (Array.isArray(args.tool_names)) {
    values.push(...args.tool_names);
  }

  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const name = value.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
    if (names.length >= 20) break;
  }
  return names;
}
