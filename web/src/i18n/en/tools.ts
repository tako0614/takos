export const tools = {
  // Packages
  packageLabel: "Package",

  // Custom Tools

  // Custom Tools Section
  noCustomToolsYet: "No custom tools yet",
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

  // Create Tool Modal
  createCustomTool: "Create Worker Tool",
  editTool: "Edit Worker Tool",
  toolNameSnakeCase: "Name (snake_case)",
  toolDescriptionPlaceholder: "What does this tool do?",
  parameterDescriptionPlaceholder: "Describe this parameter",
  toolType: "Type",
  inputParameters: "Input Parameters",
  noParametersDefined: "No parameters defined",
  addParameter: "Add Parameter",
  requiredField: "Required",
  schemaTypeString: "String",
  schemaTypeNumber: "Number",
  schemaTypeBoolean: "Boolean",
  schemaTypeArray: "Array",
  schemaTypeObject: "Object",
  nameAlreadyExists: "Name already exists",
  nameCannotBeChanged: "Name (cannot be changed)",
  workerIdCannotBeChanged: "Worker ID (cannot be changed)",
  saveChanges: "Save Changes",

  // Custom Tools Hook
  failedToLoadTool: "Failed to load tool",

  // Installation Hook
  rollbackFailed: "Rollback failed",

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
