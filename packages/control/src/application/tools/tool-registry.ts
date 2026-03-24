/**
 * Tool Registry -- Type-safe tool definition + handler pairing.
 *
 * Eliminates the risk of adding a tool definition without its handler
 * (or vice versa) by pairing them in a single registry structure.
 *
 * Today, tool modules export parallel arrays (`TOOLS: ToolDefinition[]`)
 * and objects (`HANDLERS: Record<string, ToolHandler>`) independently.
 * That makes it easy for a definition to exist without a handler (or the
 * reverse), producing a runtime crash rather than a compile-time error.
 *
 * `createToolRegistry` pairs each definition with its handler in a single
 * entry, and `mergeRegistries` composes multiple sub-registries into the
 * same `{ definitions, handlers }` shape that the rest of the codebase
 * already consumes.
 *
 * @example
 * ```ts
 * import { createToolRegistry, mergeRegistries } from './tool-registry';
 *
 * const kvRegistry = createToolRegistry([
 *   { definition: KV_GET, handler: kvGetHandler },
 *   { definition: KV_PUT, handler: kvPutHandler },
 * ]);
 *
 * const d1Registry = createToolRegistry([
 *   { definition: D1_QUERY, handler: d1QueryHandler },
 * ]);
 *
 * const storageRegistry = mergeRegistries(kvRegistry, d1Registry);
 * // storageRegistry.definitions  -> ToolDefinition[]
 * // storageRegistry.handlers     -> Record<string, ToolHandler>
 * ```
 */

import type { ToolDefinition, ToolHandler } from './types';

/** A single tool entry: one definition paired with its handler. */
export interface ToolRegistryEntry {
  definition: ToolDefinition;
  handler: ToolHandler;
}

/** The flattened registry shape consumed by the executor and discovery layer. */
export interface ToolRegistry {
  definitions: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
}

/**
 * Create a typed tool registry from an array of entries.
 *
 * Guarantees:
 * - Every definition has a corresponding handler.
 * - No two entries share the same `definition.name` (throws on duplicates).
 *
 * @param entries - array of definition+handler pairs.
 * @returns a {@link ToolRegistry} ready for use by the tool executor.
 * @throws if two entries register the same tool name.
 */
export function createToolRegistry(entries: ToolRegistryEntry[]): ToolRegistry {
  const definitions: ToolDefinition[] = [];
  const handlers: Record<string, ToolHandler> = {};

  for (const entry of entries) {
    const name = entry.definition.name;
    if (handlers[name]) {
      throw new Error(`Duplicate tool handler for "${name}"`);
    }
    definitions.push(entry.definition);
    handlers[name] = entry.handler;
  }

  return { definitions, handlers };
}

/**
 * Merge multiple registries into one.
 *
 * Definitions are concatenated in order; handlers are shallow-merged
 * (later registries override earlier ones on name collision -- this
 * matches the current `Object.assign` behaviour in storage.ts).
 *
 * @param registries - one or more registries to merge.
 * @returns a single merged {@link ToolRegistry}.
 */
export function mergeRegistries(
  ...registries: ToolRegistry[]
): ToolRegistry {
  const definitions: ToolDefinition[] = [];
  const handlers: Record<string, ToolHandler> = {};

  for (const registry of registries) {
    definitions.push(...registry.definitions);
    Object.assign(handlers, registry.handlers);
  }

  return { definitions, handlers };
}
