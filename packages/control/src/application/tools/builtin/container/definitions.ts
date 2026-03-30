import type { ToolDefinition } from '../../tool-definitions';

export const CONTAINER_START: ToolDefinition = {
  name: 'container_start',
  description: 'Start a development container for file editing and command execution. You MUST call this before using file_read, file_write, runtime_exec, or any file operations. The container provides an isolated environment where you can safely make changes. If no repository exists, use create_repository first.',
  category: 'container',
  parameters: {
    type: 'object',
    properties: {
      repo_id: {
        type: 'string',
        description: 'Repository ID to clone. If not provided, uses the default repository in the workspace.',
      },
      repo_ids: {
        type: 'array',
        items: {
          type: 'string',
          description: 'Repository ID entry.',
        },
        description: 'Multiple repository IDs to mount in a single session (multi-repo).',
      },
      mounts: {
        type: 'array',
        description: 'Explicit multi-repo mounts with custom paths and branches.',
        items: {
          type: 'object',
          description: 'Mount descriptor for a repository.',
          properties: {
            repo_id: { type: 'string', description: 'Repository ID to mount.' },
            branch: { type: 'string', description: 'Branch name for this repository.' },
            mount_path: { type: 'string', description: 'Mount path inside the session (e.g., "repos/core").' },
            is_primary: { type: 'boolean', description: 'Whether this repo is the primary/active one.' },
          },
          required: ['repo_id'],
        },
      },
      branch: {
        type: 'string',
        description: 'Optional branch name. Defaults to the repository default branch.',
      },
    },
    required: [],
  },
};

export const CONTAINER_STATUS: ToolDefinition = {
  name: 'container_status',
  description: 'Check if a container is running and list files in the container. Shows the current state of the development environment.',
  category: 'container',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const CONTAINER_COMMIT: ToolDefinition = {
  name: 'container_commit',
  description: 'Apply all changes to the workspace and stop the container. This saves all file modifications you made. Use this when you are done making changes and want to save them.',
  category: 'container',
  parameters: {
    type: 'object',
    properties: {
      repo_id: {
        type: 'string',
        description: 'Commit only this repository (optional for multi-repo sessions).',
      },
      message: {
        type: 'string',
        description: 'A brief description of the changes being applied (optional)',
      },
    },
    required: [],
  },
};

export const CONTAINER_STOP: ToolDefinition = {
  name: 'container_stop',
  description: 'Stop the container and discard ALL changes. Use this if you want to abandon all modifications. Warning: All unsaved work will be lost!',
  category: 'container',
  parameters: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description: 'Reason for stopping without saving (optional)',
      },
    },
    required: [],
  },
};

export const CREATE_REPOSITORY: ToolDefinition = {
  name: 'create_repository',
  description: 'Create a new Git-initialized repository for the workspace. Use this before container_start if no repository exists yet. Returns the repository ID which can be used with container_start.',
  category: 'container',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Repository name. Defaults to "main" if not specified.',
      },
      description: {
        type: 'string',
        description: 'Optional description for the repository.',
      },
    },
    required: [],
  },
};

export const CONTAINER_TOOLS: ToolDefinition[] = [
  CONTAINER_START,
  CONTAINER_STATUS,
  CONTAINER_COMMIT,
  CONTAINER_STOP,
  CREATE_REPOSITORY,
];
