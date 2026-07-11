import type { McpServerRecord, McpServerTool } from "../../types/index.ts";

export type ServerStatus =
  "connected" | "disabled" | "token_expired" | "no_token";

export function getServerStatus(server: McpServerRecord): ServerStatus {
  if (!server.enabled) return "disabled";
  switch (server.authorization_status) {
    case "authorization_required":
      return "no_token";
    case "reauthorization_required":
      return "token_expired";
    case "not_required":
    case "authorized":
    case "managed":
      return "connected";
  }
}

export function canUpdateToolPolicy(
  server: McpServerRecord,
  tool: McpServerTool,
): boolean {
  return (
    server.source_type === "external" &&
    !tool.policy_read_only &&
    tool.supported
  );
}

export function getServerSourceLabelKey(
  sourceType: string,
):
  | "connectionSourceRemote"
  | "connectionSourceCapsulePublished"
  | "connectionSourceManagedService"
  | "connectionSourceProjected"
  | "connectionSourceManaged" {
  switch (sourceType) {
    case "external":
      return "connectionSourceRemote";
    case "publication":
      return "connectionSourceCapsulePublished";
    case "worker":
    case "service":
      return "connectionSourceManagedService";
    case "bundle_deployment":
      return "connectionSourceProjected";
    default:
      return "connectionSourceManaged";
  }
}

export function getServerAuthLabelKey(
  authMode: string,
):
  | "connectionAuthOAuth"
  | "connectionAuthToken"
  | "connectionAuthWorkspaceOidc"
  | "connectionAuthNone"
  | "connectionAuthOther" {
  switch (authMode) {
    case "oauth_pkce":
      return "connectionAuthOAuth";
    case "bearer_token":
      return "connectionAuthToken";
    case "takos_oidc":
      return "connectionAuthWorkspaceOidc";
    case "none":
      return "connectionAuthNone";
    default:
      return "connectionAuthOther";
  }
}
