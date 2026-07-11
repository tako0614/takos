export function buildMcpToolPolicyPath(
  serverId: string,
  toolName: string,
  workspaceId: string,
): string {
  return `/api/mcp/servers/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(
    toolName,
  )}?workspaceId=${encodeURIComponent(workspaceId)}`;
}

export function buildMcpToolPolicyPatch(
  enabled: boolean,
  schemaHash: string,
  invocationPolicy: "automatic" | "confirm_each_time",
): {
  enabled: boolean;
  schema_hash: string;
  invocation_policy: "automatic" | "confirm_each_time";
} {
  return {
    enabled,
    schema_hash: schemaHash,
    invocation_policy: invocationPolicy,
  };
}
