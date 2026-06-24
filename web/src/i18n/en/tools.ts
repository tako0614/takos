export const tools = {
  // MCP Servers Section
  mcpServers: "MCP Servers",
  mcpServersDescription:
    "Managed worker and app MCP servers appear automatically. Add external servers here.",
  addMcpServer: "Add MCP Server",
  noMcpServersYet: "No MCP servers connected yet",
  managedMcpServersAutoConnected:
    "Managed worker and app MCP servers appear automatically after deploy or install.",
  inputJson: "Input (JSON)",
  enable: "Enable",
  disable: "Disable",

  // MCP Servers Hook
  failedToFetchMcpServers: "Failed to fetch MCP servers",
  failedToCreateMcpServer: "Failed to create MCP server",
  failedToUpdateMcpServer: "Failed to update MCP server",
  failedToFetchTools: "Failed to fetch tools",
  missingSpaceId: "Missing space id",
  removeMcpServer: "Remove MCP Server",
  removeMcpServerConfirm: 'Remove "{name}" from this space?',
  failedToRemoveMcpServer: "Failed to remove MCP server",

  // MCP
  mcpServerTools: "Tools",
  mcpNoTools: "No tools available",
  mcpFetchingTools: "Fetching tools...",
  mcpFetchToolsFailed: "Failed to fetch tools",
  mcpRefreshTools: "Refresh tools",
  mcpReauthorize: "Re-authorize",
  mcpReauthorizeAction: "Re-authorize",
  failedToReauthorizeMcpServer: "Failed to re-authorize the MCP server",
  mcpStatusConnected: "Connected",
  mcpStatusTokenExpired: "Token expired",
  mcpStatusDisabled: "Disabled",
  mcpStatusNoToken: "Not authenticated",
  mcpNameInvalid:
    "Name must start with a letter (letters, digits, _, - only, max 64)",
  mcpUrlInvalid: "Must be a valid HTTPS URL",
  mcpAdvanced: "Advanced",
  mcpToolCount: "{count} tools",
} as const;
