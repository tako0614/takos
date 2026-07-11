import type {
  ToolContext,
  ToolDefinition,
  ToolHandler,
} from "../tool-definitions.ts";
import { defineTools } from "./define-tools.ts";

export interface ToolExecutorLike {
  execute(
    call: { id: string; name: string; arguments: Record<string, unknown> },
  ): Promise<{ output: string; error?: string }>;
  getAvailableTools?(): ToolDefinition[];
}

export const TOOLBOX: ToolDefinition = {
  name: "toolbox",
  description:
    "Search and use tools from Takos, installed Capsules, registered external MCP servers, and workflow manuals. Use search, describe, call, or families.",
  category: "space",
  namespace: "discovery",
  family: "discovery.toolbox",
  risk_level: "medium",
  side_effects: true,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Toolbox operation",
        enum: ["search", "describe", "call", "families"],
      },
      query: {
        type: "string",
        description: "Natural-language query for search",
      },
      limit: { type: "number", description: "Maximum search results" },
      tool_name: {
        type: "string",
        description: "Tool or manual name for describe/call",
      },
      tool_names: {
        type: "array",
        description: "Tool or manual names for describe",
        items: { type: "string", description: "Tool or manual name" },
      },
      arguments: {
        type: "object",
        description: "Arguments passed to a target tool for call",
      },
    },
    required: ["action"],
  },
};

const NO_REGISTRY = JSON.stringify({
  error: "No additional tools or manuals are available in this run.",
});

function executorFrom(context: ToolContext): ToolExecutorLike | undefined {
  return (context as ToolContext & { _toolExecutor?: ToolExecutorLike })
    ._toolExecutor;
}

function displayKind(descriptor: { kind: string }): string {
  return descriptor.kind === "skill" ? "manual" : descriptor.kind;
}

function findManual(context: ToolContext, ref: string) {
  const normalized = ref.trim().toLowerCase();
  return context.capabilityRegistry?.all().find((descriptor) =>
    descriptor.kind === "skill" && descriptor.discoverable &&
    (descriptor.id.toLowerCase() === normalized ||
      descriptor.name.toLowerCase() === normalized ||
      descriptor.id.toLowerCase() === `skill:${normalized}`)
  );
}

function toolNames(args: Record<string, unknown>): string[] {
  const values = [
    typeof args.tool_name === "string" ? args.tool_name : undefined,
    ...(Array.isArray(args.tool_names) ? args.tool_names : []),
  ];
  return [...new Set(values.filter((value): value is string =>
    typeof value === "string" && value.trim().length > 0
  ).map((value) => value.trim()))].slice(0, 20);
}

async function search(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<string> {
  const registry = context.capabilityRegistry;
  if (!registry) return NO_REGISTRY;
  const limit = typeof args.limit === "number" && args.limit > 0
    ? Math.min(args.limit, 50)
    : 10;
  const results = registry.search(String(args.query ?? ""), { limit: limit + 1 })
    .filter((descriptor) =>
      descriptor.discoverable && descriptor.name !== TOOLBOX.name
    ).slice(0, limit);
  return JSON.stringify({
    results: results.map((descriptor) => ({
      id: descriptor.id,
      kind: displayKind(descriptor),
      name: descriptor.name,
      summary: descriptor.summary,
      family: descriptor.family,
      namespace: descriptor.namespace,
      risk_level: descriptor.risk_level,
      side_effects: descriptor.side_effects,
    })),
    total_available: registry.all().filter((descriptor) =>
      descriptor.discoverable && descriptor.name !== TOOLBOX.name
    ).length,
    hint:
      "Use toolbox action=describe for likely results, then action=call when a tool advances the task.",
  });
}

function families(context: ToolContext): string {
  const registry = context.capabilityRegistry;
  if (!registry) return NO_REGISTRY;
  const counts = new Map<string, number>();
  for (const descriptor of registry.all()) {
    if (
      !descriptor.discoverable || descriptor.name === TOOLBOX.name ||
      !descriptor.family
    ) continue;
    counts.set(
      descriptor.family,
      (counts.get(descriptor.family) ?? 0) + 1,
    );
  }
  return JSON.stringify({
    families: [...counts].map(([family, count]) => ({ family, count }))
      .sort((left, right) => left.family.localeCompare(right.family)),
  });
}

function describe(
  args: Record<string, unknown>,
  context: ToolContext,
): string {
  const names = toolNames(args);
  if (names.length === 0) {
    throw new Error("toolbox describe: tool_name or tool_names is required");
  }
  const executor = executorFrom(context);
  if (!executor?.getAvailableTools) {
    throw new Error("toolbox describe: tool catalog is unavailable");
  }
  const available = new Map(
    executor.getAvailableTools().map((tool) => [tool.name, tool]),
  );
  const manuals: unknown[] = [];
  const tools = names.flatMap((name) => {
    const manual = findManual(context, name);
    if (manual) {
      manuals.push({
        id: manual.id,
        kind: "manual",
        name: manual.name,
        summary: manual.summary,
        family: manual.family,
        triggers: manual.triggers ?? [],
        recommended_tools: manual.recommended_tools ?? [],
        output_modes: manual.output_modes ?? [],
        instructions: manual.instructions ?? "",
      });
      return [];
    }
    const tool = available.get(name);
    if (!tool) return [{ name, available: false }];
    return [{
      name: tool.name,
      available: true,
      description: tool.description,
      category: tool.category,
      namespace: tool.namespace,
      family: tool.family,
      risk_level: tool.risk_level,
      side_effects: tool.side_effects,
      annotations: tool.annotations,
      parameters: tool.parameters,
    }];
  });
  return JSON.stringify({
    tools,
    manuals,
    hint: "Use toolbox action=call with arguments matching the described schema.",
  });
}

async function call(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<string> {
  const name = typeof args.tool_name === "string" ? args.tool_name.trim() : "";
  if (!name) throw new Error("toolbox call: tool_name is required");
  if (name === TOOLBOX.name) throw new Error("toolbox cannot call itself");

  const executor = executorFrom(context);
  const available = executor?.getAvailableTools?.().some((tool) =>
    tool.name === name
  );
  if (!executor || !available) {
    throw new Error(
      `toolbox call: tool "${name}" is not in the available tool catalog`,
    );
  }
  const registry = context.capabilityRegistry;
  const descriptor = registry?.get(`tool:${name}`);
  if (registry && !descriptor) {
    throw new Error(
      `toolbox call: tool "${name}" is missing a capability descriptor`,
    );
  }
  if (
    descriptor &&
    (descriptor.kind !== "tool" || !descriptor.discoverable ||
      !descriptor.selectable)
  ) {
    throw new Error(`toolbox call: tool "${name}" is not selectable`);
  }
  const result = await executor.execute({
    id: `toolbox_${crypto.randomUUID()}`,
    name,
    arguments: typeof args.arguments === "object" && args.arguments !== null
      ? args.arguments as Record<string, unknown>
      : {},
  });
  if (result.error) throw new Error(`toolbox call "${name}": ${result.error}`);
  return result.output;
}

export const toolboxHandler: ToolHandler = async (args, context) => {
  switch (String(args.action ?? "").trim()) {
    case "search":
      return search(args, context);
    case "families":
      return families(context);
    case "describe":
      return describe(args, context);
    case "call":
      return call(args, context);
    default:
      throw new Error(
        "toolbox action must be one of search, describe, call, families",
      );
  }
};

export const { tools: DISCOVERY_TOOLS, handlers: DISCOVERY_HANDLERS } =
  defineTools([[TOOLBOX, toolboxHandler]]);
