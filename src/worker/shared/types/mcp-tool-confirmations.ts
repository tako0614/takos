export const MAX_MCP_TOOL_CONFIRMATIONS_PER_RESPONSE = 100;
export const MAX_MCP_TOOL_CONFIRMATION_ID_CHARACTERS = 128;
export const MAX_MCP_TOOL_CONFIRMATION_SERVER_ID_CHARACTERS = 512;
export const MAX_MCP_TOOL_CONFIRMATION_NAME_CHARACTERS = 255;
export const MAX_MCP_TOOL_CONFIRMATION_SCHEMA_HASH_CHARACTERS = 64;
export const MAX_MCP_TOOL_CONFIRMATION_TIMESTAMP_CHARACTERS = 64;
export const MAX_MCP_TOOL_CONFIRMATION_ARGUMENT_BYTES = 64 * 1024;
export const MAX_MCP_TOOL_CONFIRMATION_ARGUMENT_DEPTH = 32;
export const MAX_MCP_TOOL_CONFIRMATION_ARGUMENT_NODES = 4096;
export const MAX_MCP_TOOL_CONFIRMATION_ARGUMENT_KEY_CHARACTERS = 255;

export interface PublicMcpToolConfirmation {
  id: string;
  server_id: string;
  server_name: string;
  tool_name: string;
  schema_hash: string;
  arguments: Record<string, unknown>;
  requested_run_id: string;
  requested_thread_id: string;
  status: "pending" | "approved";
  expires_at: string;
  created_at: string;
}

/**
 * Accept only JSON-object arguments that remain safe to canonicalize, encrypt,
 * transfer, and pretty-print on the confirmation authority surface.
 */
export function isBoundedMcpToolConfirmationArguments(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (
      nodes > MAX_MCP_TOOL_CONFIRMATION_ARGUMENT_NODES ||
      current.depth > MAX_MCP_TOOL_CONFIRMATION_ARGUMENT_DEPTH
    ) {
      return false;
    }

    const item = current.value;
    if (
      item === null || typeof item === "string" ||
      typeof item === "boolean"
    ) {
      continue;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) return false;
      continue;
    }
    if (typeof item !== "object") return false;
    if (seen.has(item)) return false;
    seen.add(item);

    if (Array.isArray(item)) {
      for (const child of item) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }

    for (const [key, child] of Object.entries(item)) {
      if (
        key.length === 0 ||
        key.length > MAX_MCP_TOOL_CONFIRMATION_ARGUMENT_KEY_CHARACTERS
      ) {
        return false;
      }
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }

  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      MAX_MCP_TOOL_CONFIRMATION_ARGUMENT_BYTES;
  } catch {
    return false;
  }
}
