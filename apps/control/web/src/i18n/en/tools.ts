export const tools = {
    // Takopack
    takopack: 'Takopack',

    // Custom Tools
    customTools: 'Custom Tools',

    // Takopack Section
    install: 'Install',
    installingTakopack: 'Installing...',
    noTakopacksInstalled: 'No deployment bundles installed',
    shortcutGroups: 'Shortcut Groups',
    uiExtensions: 'UI Extensions',

    // Custom Tools Section
    addTool: 'Add Tool',
    noCustomToolsYet: 'No custom tools yet',
    createFirstTool: 'Create your first worker tool',
    mcpServers: 'MCP Servers',
    mcpServersDescription: 'Managed worker and deployment-bundle MCP servers appear automatically. Add external servers here.',
    addMcpServer: 'Add MCP Server',
    noMcpServersYet: 'No MCP servers connected yet',
    managedMcpServersAutoConnected: 'Managed worker and takopack servers will appear automatically after deploy or install.',
    inputJson: 'Input (JSON)',
    enable: 'Enable',
    disable: 'Disable',
    test: 'Test',
    executionFailed: 'Execution failed',

    // Create Tool Modal
    createCustomTool: 'Create Worker Tool',
    editTool: 'Edit Worker Tool',
    toolNameSnakeCase: 'Name (snake_case)',
    toolDescriptionPlaceholder: 'What does this tool do?',
    parameterDescriptionPlaceholder: 'Describe this parameter',
    toolType: 'Type',
    inputParameters: 'Input Parameters',
    noParametersDefined: 'No parameters defined',
    addParameter: 'Add Parameter',
    requiredField: 'Required',
    nameAlreadyExists: 'Name already exists',
    nameCannotBeChanged: 'Name (cannot be changed)',
    workerIdCannotBeChanged: 'Worker ID (cannot be changed)',
    saveChanges: 'Save Changes',

    // Custom Tools Hook
    failedToLoadTool: 'Failed to load tool',
    toolCreated: 'Tool created',
    failedToCreateTool: 'Failed to create tool',
    toolUpdated: 'Tool updated',
    failedToUpdateTool: 'Failed to update tool',
    deleteToolTitle: 'Delete Tool',
    deleteToolConfirm: 'Are you sure you want to delete "{name}"?',
    toolDeleted: 'Tool deleted',
    failedToDeleteTool: 'Failed to delete tool',
    failedToToggleTool: 'Failed to toggle tool',

    // Takopacks Hook
    failedToLoadAppDeployment: 'Failed to load app deployment',
    removeAppDeployment: 'Remove App Deployment',
    removeAppDeploymentConfirm: 'Remove "{name}" and its managed MCP servers, shortcuts, and UI extensions?',
    appDeploymentRemoved: 'App deployment removed',
    failedToRemoveAppDeployment: 'Failed to remove app deployment',
    rollbackAppDeployment: 'Rollback App Deployment',
    rollbackAppDeploymentConfirm: 'Redeploy "{name}" to the previous successful deployment?',
    rolledBackName: 'Rolled back "{name}"',
    rollbackFailed: 'Rollback failed',

    // MCP Servers Hook
    failedToFetchMcpServers: 'Failed to fetch MCP servers',
    failedToCreateMcpServer: 'Failed to create MCP server',
    failedToUpdateMcpServer: 'Failed to update MCP server',
    removeMcpServer: 'Remove MCP Server',
    removeMcpServerConfirm: 'Remove "{name}" from this space?',
    failedToRemoveMcpServer: 'Failed to remove MCP server',

    // MCP
    mcpServerTools: 'Tools',
    mcpNoTools: 'No tools available',
    mcpFetchingTools: 'Fetching tools...',
    mcpFetchToolsFailed: 'Failed to fetch tools',
    mcpRefreshTools: 'Refresh tools',
    mcpReauthorize: 'Re-authorize',
    mcpStatusConnected: 'Connected',
    mcpStatusTokenExpired: 'Token expired',
    mcpStatusDisabled: 'Disabled',
    mcpStatusNoToken: 'Not authenticated',
    mcpNameInvalid: 'Name must start with a letter (letters, digits, _, - only, max 64)',
    mcpUrlInvalid: 'Must be a valid HTTPS URL',
    mcpAdvanced: 'Advanced',
    mcpToolCount: '{count} tools',
} as const;
