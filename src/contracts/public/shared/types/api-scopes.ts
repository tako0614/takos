export interface ApiBearerScope {
  name: string;
  description: string;
  category: "identity" | "resource";
}

export const API_BEARER_SCOPES: Record<string, ApiBearerScope> = {
  openid: {
    name: "openid",
    description: "OpenID Connect identity",
    category: "identity",
  },
  profile: {
    name: "profile",
    description: "User profile (name, picture)",
    category: "identity",
  },
  email: { name: "email", description: "Email address", category: "identity" },
  "spaces:read": {
    name: "spaces:read",
    description: "Read workspaces",
    category: "resource",
  },
  "spaces:write": {
    name: "spaces:write",
    description: "Write workspaces",
    category: "resource",
  },
  "files:read": {
    name: "files:read",
    description: "Read files",
    category: "resource",
  },
  "files:write": {
    name: "files:write",
    description: "Write files",
    category: "resource",
  },
  "memories:read": {
    name: "memories:read",
    description: "Read memories",
    category: "resource",
  },
  "memories:write": {
    name: "memories:write",
    description: "Write memories",
    category: "resource",
  },
  "threads:read": {
    name: "threads:read",
    description: "Read threads",
    category: "resource",
  },
  "threads:write": {
    name: "threads:write",
    description: "Write threads",
    category: "resource",
  },
  "runs:read": {
    name: "runs:read",
    description: "Read runs",
    category: "resource",
  },
  "runs:write": {
    name: "runs:write",
    description: "Trigger or cancel runs",
    category: "resource",
  },
  "agents:execute": {
    name: "agents:execute",
    description: "Execute agents",
    category: "resource",
  },
  "repos:read": {
    name: "repos:read",
    description: "Read repositories",
    category: "resource",
  },
  "repos:write": {
    name: "repos:write",
    description: "Write repositories",
    category: "resource",
  },
  "mcp:invoke": {
    name: "mcp:invoke",
    description: "Invoke MCP servers",
    category: "resource",
  },
  "events:subscribe": {
    name: "events:subscribe",
    description: "Subscribe to space lifecycle events",
    category: "resource",
  },
};

export const ALL_API_BEARER_SCOPES: string[] = Object.keys(
  API_BEARER_SCOPES,
);
