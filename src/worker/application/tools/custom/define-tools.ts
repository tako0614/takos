import type { ToolDefinition, ToolHandler } from "../tool-definitions.ts";

/**
 * A single tool authored as one source of truth: its {@link ToolDefinition}
 * paired with the {@link ToolHandler} that runs it.
 */
export type ToolEntry = readonly [ToolDefinition, ToolHandler];

/**
 * The two parallel collections every leaf tool module used to hand-maintain:
 * an ordered `ToolDefinition[]` and a `Record<name, ToolHandler>`. Both are now
 * derived from a single {@link ToolEntry} list so the tool name can never drift
 * between the definition and the handler map.
 */
export interface DefinedTools {
  tools: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
}

/**
 * Derive a module's `tools` array and `handlers` map from one combined list of
 * `[definition, handler]` pairs. The handler-map key is always the
 * definition's own `name`, so adding, renaming, or removing a tool only touches
 * a single entry. Duplicate tool names throw so collisions surface at module
 * load instead of silently shadowing a handler.
 */
export function defineTools(entries: readonly ToolEntry[]): DefinedTools {
  const tools: ToolDefinition[] = [];
  const handlers: Record<string, ToolHandler> = {};

  for (const [definition, handler] of entries) {
    if (Object.prototype.hasOwnProperty.call(handlers, definition.name)) {
      throw new Error(`Duplicate custom tool name: ${definition.name}`);
    }
    tools.push(definition);
    handlers[definition.name] = handler;
  }

  return { tools, handlers };
}

/**
 * Merge several {@link DefinedTools} groups (e.g. an aggregator combining leaf
 * modules) into one, preserving order and rejecting duplicate tool names.
 */
export function mergeDefinedTools(
  groups: readonly DefinedTools[],
): DefinedTools {
  const tools: ToolDefinition[] = [];
  const handlers: Record<string, ToolHandler> = {};

  for (const group of groups) {
    for (const tool of group.tools) {
      if (Object.prototype.hasOwnProperty.call(handlers, tool.name)) {
        throw new Error(`Duplicate custom tool name: ${tool.name}`);
      }
      tools.push(tool);
    }
    for (const [name, handler] of Object.entries(group.handlers)) {
      handlers[name] = handler;
    }
  }

  return { tools, handlers };
}
