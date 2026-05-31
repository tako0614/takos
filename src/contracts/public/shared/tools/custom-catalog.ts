export type SerializedCustomTool = {
  id: string;
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  enabled: true;
  type: "custom";
  bundleDeploymentId: null;
};

export const CUSTOM_TOOL_CATALOG: readonly SerializedCustomTool[] = [
  {
    "id": "container_start",
    "name": "container_start",
    "description":
      "Start a development container for file editing and command execution. You MUST call this before using file_read, file_write, runtime_exec, or any file operations. The container provides an isolated environment where you can safely make changes. If no repository exists, use create_repository first.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "repo_id": {
          "type": "string",
          "description":
            "Repository ID to clone. If not provided, uses the default repository in the space.",
        },
        "repo_ids": {
          "type": "array",
          "items": {
            "type": "string",
            "description": "Repository ID entry.",
          },
          "description":
            "Multiple repository IDs to mount in a single session (multi-repo).",
        },
        "mounts": {
          "type": "array",
          "description":
            "Explicit multi-repo mounts with custom paths and branches.",
          "items": {
            "type": "object",
            "description": "Mount descriptor for a repository.",
            "properties": {
              "repo_id": {
                "type": "string",
                "description": "Repository ID to mount.",
              },
              "branch": {
                "type": "string",
                "description": "Branch name for this repository.",
              },
              "mount_path": {
                "type": "string",
                "description":
                  'Mount path inside the session (e.g., "repos/core").',
              },
              "is_primary": {
                "type": "boolean",
                "description": "Whether this repo is the primary/active one.",
              },
            },
            "required": [
              "repo_id",
            ],
          },
        },
        "branch": {
          "type": "string",
          "description":
            "Optional branch name. Defaults to the repository default branch.",
        },
      },
      "required": [],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "container_status",
    "name": "container_status",
    "description":
      "Check if a container is running and list files in the container. Shows the current state of the development environment.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "container_commit",
    "name": "container_commit",
    "description":
      "Apply all changes to the space and stop the container. This saves all file modifications you made. Use this when you are done making changes and want to save them.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "repo_id": {
          "type": "string",
          "description":
            "Commit only this repository (optional for multi-repo sessions).",
        },
        "message": {
          "type": "string",
          "description":
            "A brief description of the changes being applied (optional)",
        },
      },
      "required": [],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "container_stop",
    "name": "container_stop",
    "description":
      "Stop the container and discard ALL changes. Use this if you want to abandon all modifications. Warning: All unsaved work will be lost!",
    "inputSchema": {
      "type": "object",
      "properties": {
        "reason": {
          "type": "string",
          "description": "Reason for stopping without saving (optional)",
        },
      },
      "required": [],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "create_repository",
    "name": "create_repository",
    "description":
      "Create a new Git-initialized repository for the space. Use this before container_start if no repository exists yet. Returns the repository ID which can be used with container_start.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description":
            'Repository name. Defaults to "main" if not specified.',
        },
        "description": {
          "type": "string",
          "description": "Optional description for the repository.",
        },
      },
      "required": [],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "repo_list",
    "name": "repo_list",
    "description":
      "List repositories mounted in the current container session.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "repo_status",
    "name": "repo_status",
    "description":
      "Show the active repository for the current container session.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "repo_switch",
    "name": "repo_switch",
    "description":
      "Switch the active repository in the current container session.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "repo_id": {
          "type": "string",
          "description": "Repository ID to make active.",
        },
      },
      "required": [
        "repo_id",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "file_read",
    "name": "file_read",
    "description":
      "Read the contents of a file in the space. Supports text files, images (returns base64), and PDFs.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "repo_id": {
          "type": "string",
          "description":
            "Repository ID to scope this path (optional, for multi-repo sessions).",
        },
        "mount_path": {
          "type": "string",
          "description":
            "Mounted path to scope this file operation (optional, for multi-repo sessions).",
        },
        "path": {
          "type": "string",
          "description": "The file path relative to space root",
        },
      },
      "required": [
        "path",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "file_write",
    "name": "file_write",
    "description":
      "Write content to a file in the space. Creates the file if it does not exist, updates if it exists.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "repo_id": {
          "type": "string",
          "description":
            "Repository ID to scope this path (optional, for multi-repo sessions).",
        },
        "mount_path": {
          "type": "string",
          "description":
            "Mounted path to scope this file operation (optional, for multi-repo sessions).",
        },
        "path": {
          "type": "string",
          "description": "The file path relative to space root",
        },
        "content": {
          "type": "string",
          "description": "The content to write to the file",
        },
      },
      "required": [
        "path",
        "content",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "file_write_binary",
    "name": "file_write_binary",
    "description":
      "Write binary content (base64 encoded) to a file. Use this for images, fonts, and other binary files.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "repo_id": {
          "type": "string",
          "description":
            "Repository ID to scope this path (optional, for multi-repo sessions).",
        },
        "mount_path": {
          "type": "string",
          "description":
            "Mounted path to scope this file operation (optional, for multi-repo sessions).",
        },
        "path": {
          "type": "string",
          "description": "The file path relative to space root",
        },
        "content_base64": {
          "type": "string",
          "description": "The binary content encoded as base64",
        },
      },
      "required": [
        "path",
        "content_base64",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "file_list",
    "name": "file_list",
    "description": "List files and directories in a path",
    "inputSchema": {
      "type": "object",
      "properties": {
        "repo_id": {
          "type": "string",
          "description":
            "Repository ID to scope this path (optional, for multi-repo sessions).",
        },
        "mount_path": {
          "type": "string",
          "description":
            "Mounted path to scope this file operation (optional, for multi-repo sessions).",
        },
        "path": {
          "type": "string",
          "description":
            "The directory path relative to space root. Empty string for root.",
        },
      },
      "required": [],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "file_delete",
    "name": "file_delete",
    "description": "Delete a file from the space",
    "inputSchema": {
      "type": "object",
      "properties": {
        "repo_id": {
          "type": "string",
          "description":
            "Repository ID to scope this path (optional, for multi-repo sessions).",
        },
        "mount_path": {
          "type": "string",
          "description":
            "Mounted path to scope this file operation (optional, for multi-repo sessions).",
        },
        "path": {
          "type": "string",
          "description": "The file path relative to space root",
        },
      },
      "required": [
        "path",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "file_mkdir",
    "name": "file_mkdir",
    "description": "Create a directory in the space.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "repo_id": {
          "type": "string",
          "description":
            "Repository ID to scope this path (optional, for multi-repo sessions).",
        },
        "mount_path": {
          "type": "string",
          "description":
            "Mounted path to scope this file operation (optional, for multi-repo sessions).",
        },
        "path": {
          "type": "string",
          "description": "The directory path relative to space root",
        },
      },
      "required": [
        "path",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "file_rename",
    "name": "file_rename",
    "description": "Rename or move a file/directory to a new path",
    "inputSchema": {
      "type": "object",
      "properties": {
        "repo_id": {
          "type": "string",
          "description":
            "Repository ID to scope this path (optional, for multi-repo sessions).",
        },
        "mount_path": {
          "type": "string",
          "description":
            "Mounted path to scope this file operation (optional, for multi-repo sessions).",
        },
        "old_path": {
          "type": "string",
          "description": "The current file/directory path",
        },
        "new_path": {
          "type": "string",
          "description": "The new file/directory path",
        },
      },
      "required": [
        "old_path",
        "new_path",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "file_copy",
    "name": "file_copy",
    "description": "Copy a file to a new location",
    "inputSchema": {
      "type": "object",
      "properties": {
        "repo_id": {
          "type": "string",
          "description":
            "Repository ID to scope this path (optional, for multi-repo sessions).",
        },
        "mount_path": {
          "type": "string",
          "description":
            "Mounted path to scope this file operation (optional, for multi-repo sessions).",
        },
        "source_path": {
          "type": "string",
          "description": "The source file path",
        },
        "dest_path": {
          "type": "string",
          "description": "The destination file path",
        },
      },
      "required": [
        "source_path",
        "dest_path",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "deploy_frontend",
    "name": "deploy_frontend",
    "description": "Deploy a frontend build to /apps/{name}/ from space files",
    "inputSchema": {
      "type": "object",
      "properties": {
        "app_name": {
          "type": "string",
          "description": "App name (used for /apps/{name}/)",
        },
        "dist_path": {
          "type": "string",
          "description": "Build output directory in the space (default: dist)",
        },
        "clear": {
          "type": "boolean",
          "description": "Delete existing app files before upload",
        },
        "description": {
          "type": "string",
          "description": "Optional app description",
        },
        "icon": {
          "type": "string",
          "description": "Optional app icon (emoji or URL)",
        },
      },
      "required": [
        "app_name",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "service_env_get",
    "name": "service_env_get",
    "description":
      "Get environment variables for a service slot or deployment artifact",
    "inputSchema": {
      "type": "object",
      "properties": {
        "service_name": {
          "type": "string",
          "description": "Stable service slot name or deployment artifact ref",
        },
      },
      "required": [
        "service_name",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "service_env_set",
    "name": "service_env_set",
    "description":
      "Replace environment variables for a service slot. Applies on the next deployment.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "service_name": {
          "type": "string",
          "description": "Stable service slot name",
        },
        "env": {
          "type": "array",
          "description": "Environment variables to set",
          "items": {
            "type": "object",
            "description": "Environment variable",
            "properties": {
              "name": {
                "type": "string",
                "description": "Variable name (e.g., API_KEY)",
              },
              "value": {
                "type": "string",
                "description": "Variable value",
              },
              "type": {
                "type": "string",
                "description": "Type: plain_text or secret_text",
                "enum": [
                  "plain_text",
                  "secret_text",
                ],
              },
            },
            "required": [
              "name",
              "value",
            ],
          },
        },
      },
      "required": [
        "service_name",
        "env",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "service_runtime_get",
    "name": "service_runtime_get",
    "description":
      "Get runtime configuration for a service slot or deployment artifact",
    "inputSchema": {
      "type": "object",
      "properties": {
        "service_name": {
          "type": "string",
          "description": "Stable service slot name or deployment artifact ref",
        },
      },
      "required": [
        "service_name",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "service_runtime_set",
    "name": "service_runtime_set",
    "description":
      "Set runtime configuration for a service slot. Applies on the next deployment.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "service_name": {
          "type": "string",
          "description": "Stable service slot name",
        },
        "compatibility_date": {
          "type": "string",
          "description": "Compatibility date (e.g., 2024-01-01)",
        },
        "compatibility_flags": {
          "type": "array",
          "description": "Compatibility flags (e.g., nodejs_compat)",
          "items": {
            "type": "string",
            "description": "Flag name",
          },
        },
        "cpu_ms": {
          "type": "number",
          "description": "CPU time limit in milliseconds (10-30000)",
        },
      },
      "required": [
        "service_name",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "domain_list",
    "name": "domain_list",
    "description": "List custom domains for a service",
    "inputSchema": {
      "type": "object",
      "properties": {
        "service_id": {
          "type": "string",
          "description": "Service ID",
        },
      },
      "required": [
        "service_id",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "domain_add",
    "name": "domain_add",
    "description":
      "Add a custom domain to a service. Returns DNS records to configure.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "service_id": {
          "type": "string",
          "description": "Service ID",
        },
        "domain": {
          "type": "string",
          "description": "Domain name (e.g., myapp.example.com)",
        },
      },
      "required": [
        "service_id",
        "domain",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "domain_verify",
    "name": "domain_verify",
    "description": "Verify DNS configuration for a custom domain",
    "inputSchema": {
      "type": "object",
      "properties": {
        "service_id": {
          "type": "string",
          "description": "Service ID",
        },
        "domain": {
          "type": "string",
          "description": "Domain name to verify",
        },
      },
      "required": [
        "service_id",
        "domain",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "domain_remove",
    "name": "domain_remove",
    "description": "Remove a custom domain from a service",
    "inputSchema": {
      "type": "object",
      "properties": {
        "service_id": {
          "type": "string",
          "description": "Service ID",
        },
        "domain": {
          "type": "string",
          "description": "Domain name to remove",
        },
      },
      "required": [
        "service_id",
        "domain",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "service_list",
    "name": "service_list",
    "description": "List service slots in the space.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "description": "Filter by status (optional)",
          "enum": [
            "pending",
            "building",
            "deployed",
            "failed",
            "stopped",
          ],
        },
        "type": {
          "type": "string",
          "description": "Filter by type (optional)",
          "enum": [
            "app",
            "service",
          ],
        },
      },
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "service_create",
    "name": "service_create",
    "description":
      "Create a new service slot (app or service). Deployments are created separately from this slot.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "Service slot name",
        },
        "type": {
          "type": "string",
          "description":
            "Deployment type: app (with UI) or service (backend only)",
          "enum": [
            "app",
            "service",
          ],
        },
        "description": {
          "type": "string",
          "description": "Description of the service",
        },
        "icon": {
          "type": "string",
          "description": "Emoji icon for the service",
        },
        "has_takos_client": {
          "type": "boolean",
          "description": "Whether this deployment has a Takos UI client",
        },
        "takos_client_entry": {
          "type": "string",
          "description": "Takos client entry point (e.g., platform, viewer)",
        },
      },
      "required": [
        "name",
        "type",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "service_delete",
    "name": "service_delete",
    "description":
      "Delete a service slot and clean up its deployment artifacts.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "service_id": {
          "type": "string",
          "description": "Service ID",
        },
        "confirm": {
          "type": "boolean",
          "description": "Confirm deletion (must be true)",
        },
      },
      "required": [
        "service_id",
        "confirm",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "deployment_history",
    "name": "deployment_history",
    "description": "List deployment history for a service.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "service_id": {
          "type": "string",
          "description": "Service ID",
        },
        "limit": {
          "type": "number",
          "description": "Maximum number of deployments to return",
        },
      },
      "required": [
        "service_id",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "deployment_get",
    "name": "deployment_get",
    "description": "Get a deployment and its masked env/binding details.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "service_id": {
          "type": "string",
          "description": "Service ID",
        },
        "deployment_id": {
          "type": "string",
          "description": "Deployment ID",
        },
      },
      "required": [
        "service_id",
        "deployment_id",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "deployment_rollback",
    "name": "deployment_rollback",
    "description":
      "Rollback a service to the previous deployment or to a target version.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "service_id": {
          "type": "string",
          "description": "Service ID",
        },
        "target_version": {
          "type": "number",
          "description": "Optional deployment version to rollback to",
        },
      },
      "required": [
        "service_id",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "runtime_exec",
    "name": "runtime_exec",
    "description":
      "Execute commands in takos-runtime (npm, esbuild, git, etc.). Commands are executed sequentially. Files persist in session directory.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "commands": {
          "type": "array",
          "description":
            'Commands to execute sequentially (e.g., ["npm install", "npm run build"])',
          "items": {
            "type": "string",
            "description": "Command to execute",
          },
        },
        "working_dir": {
          "type": "string",
          "description":
            "Working directory relative to space root (optional, defaults to root)",
        },
        "timeout": {
          "type": "number",
          "description":
            "Timeout in seconds (optional, default: 300, max: 1800)",
        },
        "env": {
          "type": "object",
          "description": "Environment variables for command execution",
        },
      },
      "required": [
        "commands",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "runtime_status",
    "name": "runtime_status",
    "description": "Check the status of a running runtime process",
    "inputSchema": {
      "type": "object",
      "properties": {
        "runtime_id": {
          "type": "string",
          "description": "Runtime process ID returned from runtime_exec",
        },
      },
      "required": [
        "runtime_id",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "key_value_get",
    "name": "key_value_get",
    "description": "Get a value from a key-value namespace",
    "inputSchema": {
      "type": "object",
      "properties": {
        "namespace": {
          "type": "string",
          "description": 'Key-value namespace name (e.g., "HOSTNAME_ROUTING")',
        },
        "key": {
          "type": "string",
          "description": "Key to retrieve",
        },
      },
      "required": [
        "namespace",
        "key",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "key_value_put",
    "name": "key_value_put",
    "description": "Store a value in a key-value namespace",
    "inputSchema": {
      "type": "object",
      "properties": {
        "namespace": {
          "type": "string",
          "description": "Key-value namespace name",
        },
        "key": {
          "type": "string",
          "description": "Key to store",
        },
        "value": {
          "type": "string",
          "description": "Value to store",
        },
        "expiration_ttl": {
          "type": "number",
          "description": "Time to live in seconds (optional)",
        },
      },
      "required": [
        "namespace",
        "key",
        "value",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "key_value_delete",
    "name": "key_value_delete",
    "description": "Delete a key from a key-value namespace",
    "inputSchema": {
      "type": "object",
      "properties": {
        "namespace": {
          "type": "string",
          "description": "Key-value namespace name",
        },
        "key": {
          "type": "string",
          "description": "Key to delete",
        },
      },
      "required": [
        "namespace",
        "key",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "key_value_list",
    "name": "key_value_list",
    "description":
      "List keys in a key-value namespace with optional prefix filter",
    "inputSchema": {
      "type": "object",
      "properties": {
        "namespace": {
          "type": "string",
          "description": "Key-value namespace name",
        },
        "prefix": {
          "type": "string",
          "description": "Key prefix to filter (optional)",
        },
        "limit": {
          "type": "number",
          "description":
            "Maximum number of keys to return (default: 100, max: 1000)",
        },
      },
      "required": [
        "namespace",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "sql_query",
    "name": "sql_query",
    "description":
      "Execute a SQL query on a SQL database. Use with caution - prefer read-only queries unless modification is explicitly needed.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sql": {
          "type": "string",
          "description": "SQL query to execute",
        },
        "params": {
          "type": "array",
          "description":
            "Query parameters (optional, for parameterized queries)",
          "items": {
            "type": "string",
            "description": "Parameter value",
          },
        },
      },
      "required": [
        "sql",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "sql_tables",
    "name": "sql_tables",
    "description": "List tables in the SQL database",
    "inputSchema": {
      "type": "object",
      "properties": {},
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "sql_describe",
    "name": "sql_describe",
    "description": "Describe a table schema in the SQL database",
    "inputSchema": {
      "type": "object",
      "properties": {
        "table": {
          "type": "string",
          "description": "Table name to describe",
        },
      },
      "required": [
        "table",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "object_store_upload",
    "name": "object_store_upload",
    "description":
      "Upload a file from the space working tree to an object store bucket",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket": {
          "type": "string",
          "description":
            "Object store bucket name (TENANT_SOURCE, TENANT_BUILDS, WORKER_BUNDLES)",
        },
        "key": {
          "type": "string",
          "description": "Object key (path) to store",
        },
        "file_path": {
          "type": "string",
          "description": "File path in the space to upload",
        },
        "content_type": {
          "type": "string",
          "description": "Content type (optional)",
        },
      },
      "required": [
        "bucket",
        "key",
        "file_path",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "object_store_download",
    "name": "object_store_download",
    "description":
      "Download an object from an object store bucket to a space file",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket": {
          "type": "string",
          "description": "Object store bucket name",
        },
        "key": {
          "type": "string",
          "description": "Object key (path) to download",
        },
        "dest_path": {
          "type": "string",
          "description": "Destination file path in the space",
        },
      },
      "required": [
        "bucket",
        "key",
        "dest_path",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "object_store_list",
    "name": "object_store_list",
    "description":
      "List objects in an object store bucket with optional prefix filter",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket": {
          "type": "string",
          "description": "Object store bucket name",
        },
        "prefix": {
          "type": "string",
          "description": "Prefix to filter objects (optional)",
        },
        "limit": {
          "type": "number",
          "description":
            "Maximum number of objects to return (default: 100, max: 1000)",
        },
      },
      "required": [
        "bucket",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "object_store_delete",
    "name": "object_store_delete",
    "description": "Delete an object from an object store bucket",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket": {
          "type": "string",
          "description": "Object store bucket name",
        },
        "key": {
          "type": "string",
          "description": "Object key (path) to delete",
        },
      },
      "required": [
        "bucket",
        "key",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "object_store_info",
    "name": "object_store_info",
    "description":
      "Get metadata about an object in an object store bucket (size, content-type, etc.)",
    "inputSchema": {
      "type": "object",
      "properties": {
        "bucket": {
          "type": "string",
          "description": "Object store bucket name",
        },
        "key": {
          "type": "string",
          "description": "Object key (path) to inspect",
        },
      },
      "required": [
        "bucket",
        "key",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "create_sql",
    "name": "create_sql",
    "description": "Create a new SQL database resource",
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "Database name (lowercase, alphanumeric, hyphens)",
        },
        "schema": {
          "type": "string",
          "description": "SQL schema to run after creation (optional)",
        },
      },
      "required": [
        "name",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "create_key_value",
    "name": "create_key_value",
    "description": "Create a new key-value resource",
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "Resource name",
        },
      },
      "required": [
        "name",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "create_object_store",
    "name": "create_object_store",
    "description": "Create a new object-store resource",
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "Object-store name (lowercase, alphanumeric, hyphens)",
        },
      },
      "required": [
        "name",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "list_resources",
    "name": "list_resources",
    "description":
      "List SQL, key-value, and object-store resources in the space",
    "inputSchema": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "description":
            "Resource type to list (optional, lists all if not specified)",
          "enum": [
            "sql",
            "key-value",
            "object-store",
          ],
        },
      },
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "remember",
    "name": "remember",
    "description":
      "Store important information in memory for future reference. Use this to save facts, procedures, or experiences that should be remembered.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "content": {
          "type": "string",
          "description": "The information to remember",
        },
        "type": {
          "type": "string",
          "description":
            'Memory type: "episode" (experiences/events), "semantic" (facts/knowledge), "procedural" (methods/preferences)',
          "enum": [
            "episode",
            "semantic",
            "procedural",
          ],
        },
        "importance": {
          "type": "number",
          "description":
            "Importance score from 0 to 1 (optional, default: 0.5)",
        },
        "category": {
          "type": "string",
          "description":
            'Category for organization (optional, e.g., "project", "user", "workflow")',
        },
      },
      "required": [
        "content",
        "type",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "recall",
    "name": "recall",
    "description":
      "Search memories for relevant information. Returns matching memories based on query.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Search query to find relevant memories",
        },
        "type": {
          "type": "string",
          "description": "Filter by memory type (optional)",
          "enum": [
            "episode",
            "semantic",
            "procedural",
          ],
        },
        "limit": {
          "type": "number",
          "description": "Maximum number of results (optional, default: 10)",
        },
      },
      "required": [
        "query",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "set_reminder",
    "name": "set_reminder",
    "description":
      "Set a reminder for future. Can be time-based, condition-based, or context-based.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "content": {
          "type": "string",
          "description": "What to remind about",
        },
        "trigger_type": {
          "type": "string",
          "description":
            'When to trigger: "time" (at specific time), "condition" (when condition is met), "context" (when topic comes up)',
          "enum": [
            "time",
            "condition",
            "context",
          ],
        },
        "trigger_value": {
          "type": "string",
          "description":
            "Trigger details - ISO timestamp for time, condition description, or context keywords",
        },
        "priority": {
          "type": "string",
          "description": 'Priority level (optional, default: "normal")',
          "enum": [
            "low",
            "normal",
            "high",
            "critical",
          ],
        },
      },
      "required": [
        "content",
        "trigger_type",
        "trigger_value",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "info_unit_search",
    "name": "info_unit_search",
    "description":
      "Search session-level agent info units (agent run logs summarized as memory).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Search query for relevant info units",
        },
        "limit": {
          "type": "number",
          "description":
            "Maximum number of results (optional, default: 5, max: 20)",
        },
        "min_score": {
          "type": "number",
          "description":
            "Minimum similarity score for vector search (optional, default: 0.5)",
        },
      },
      "required": [
        "query",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "repo_graph_search",
    "name": "repo_graph_search",
    "description":
      "Search info units and graph memory, optionally scoped to specific repositories.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Search query for relevant info units",
        },
        "repo_ids": {
          "type": "array",
          "items": {
            "type": "string",
            "description": "Repository ID to include in scope.",
          },
          "description": "Optional repository IDs to scope the search.",
        },
        "limit": {
          "type": "number",
          "description":
            "Maximum number of results (optional, default: 5, max: 20)",
        },
        "min_score": {
          "type": "number",
          "description":
            "Minimum similarity score for vector search (optional, default: 0.5)",
        },
      },
      "required": [
        "query",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "repo_graph_neighbors",
    "name": "repo_graph_neighbors",
    "description":
      "List neighboring graph nodes from a given node or info unit.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "node_id": {
          "type": "string",
          "description": "Graph node ID (preferred).",
        },
        "info_unit_id": {
          "type": "string",
          "description": "Info unit ID (will resolve to node).",
        },
        "depth": {
          "type": "number",
          "description": "Traversal depth (optional, default: 1, max: 3)",
        },
      },
      "required": [],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "repo_graph_lineage",
    "name": "repo_graph_lineage",
    "description":
      "Show lineage edges (generated_from/references) for a given info unit.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "info_unit_id": {
          "type": "string",
          "description": "Info unit ID to trace lineage.",
        },
        "depth": {
          "type": "number",
          "description": "Traversal depth (optional, default: 2, max: 3)",
        },
      },
      "required": [
        "info_unit_id",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "web_fetch",
    "name": "web_fetch",
    "description":
      "Fetch content from a URL. Returns the page content as text.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "url": {
          "type": "string",
          "description": "URL to fetch",
        },
        "extract": {
          "type": "string",
          "description":
            'What to extract: "text" (all text), "main" (main content), "links" (all links)',
          "enum": [
            "text",
            "main",
            "links",
          ],
        },
        "render": {
          "type": "boolean",
          "description": "Render mode is not part of core Takos.",
        },
        "timeout_ms": {
          "type": "number",
          "description":
            "Timeout for render mode in milliseconds (default: 30000)",
        },
      },
      "required": [
        "url",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "create_artifact",
    "name": "create_artifact",
    "description":
      "Create an artifact (code, document, report, etc.) as output of this run. Artifacts are displayed to the user and can be downloaded.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "description": "Artifact type",
          "enum": [
            "code",
            "config",
            "doc",
            "patch",
            "report",
            "other",
          ],
        },
        "title": {
          "type": "string",
          "description": "Title of the artifact",
        },
        "content": {
          "type": "string",
          "description": "Content of the artifact",
        },
      },
      "required": [
        "type",
        "title",
        "content",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "search",
    "name": "search",
    "description": "Search for files and content in the space",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "The search query",
        },
        "type": {
          "type": "string",
          "description":
            'Search type: "filename" for file names, "content" for file contents',
          "enum": [
            "filename",
            "content",
          ],
        },
      },
      "required": [
        "query",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "spawn_agent",
    "name": "spawn_agent",
    "description":
      "Spawn a sub-agent to execute an independent delegated task concurrently in a dedicated child thread. Prefer using this early for meaningful parallel side work, then use wait_agent when the parent run needs the child result.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "task": {
          "type": "string",
          "description":
            "Clear, self-contained instructions for the sub-agent to execute.",
        },
        "goal": {
          "type": "string",
          "description": "Higher-level goal for the delegated work (optional).",
        },
        "deliverable": {
          "type": "string",
          "description":
            "Expected output or artifact from the delegated work (optional).",
        },
        "constraints": {
          "type": "array",
          "description": "Constraints the sub-agent must respect (optional).",
          "items": {
            "type": "string",
            "description": "Constraint string",
          },
        },
        "context": {
          "type": "array",
          "description":
            "Relevant findings or facts to pass explicitly to the sub-agent (optional).",
          "items": {
            "type": "string",
            "description": "Context item",
          },
        },
        "acceptance_criteria": {
          "type": "array",
          "description":
            "Checks the delegated result should satisfy (optional).",
          "items": {
            "type": "string",
            "description": "Acceptance criterion",
          },
        },
        "product_hint": {
          "type": "string",
          "description": "Product hint for the delegated work (optional).",
          "enum": [
            "takos",
            "yurucommu",
            "roadtome",
          ],
        },
        "locale": {
          "type": "string",
          "description": "Preferred locale for the delegated work (optional).",
          "enum": [
            "ja",
            "en",
          ],
        },
        "agent_type": {
          "type": "string",
          "description":
            'Agent type for the sub-agent (optional, default: "default")',
        },
        "model": {
          "type": "string",
          "description":
            "LLM model for the sub-agent (optional, inherits space default if omitted)",
        },
      },
      "required": [
        "task",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "wait_agent",
    "name": "wait_agent",
    "description":
      "Wait for a child sub-agent run spawned by the current run. Returns terminal status and summarized results when complete, or a timeout status if still running.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "run_id": {
          "type": "string",
          "description": "Child run ID returned by spawn_agent",
        },
        "timeout_ms": {
          "type": "number",
          "description":
            "How long to wait in milliseconds (optional, default: 30000, max: 240000)",
        },
      },
      "required": [
        "run_id",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "mcp_add_server",
    "name": "mcp_add_server",
    "description":
      "Register an external MCP (Model Context Protocol) server so its tools become available in this space. If the server requires OAuth authentication, this tool will return an auth_url that the user must visit to grant access. Once authorized, the server's tools will be available in the next conversation turn.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "url": {
          "type": "string",
          "description": "The base URL of the MCP server (must be HTTPS)",
        },
        "name": {
          "type": "string",
          "description":
            "A short identifier for this server (alphanumeric + underscore, max 64 chars)",
        },
        "scope": {
          "type": "string",
          "description": "Optional OAuth scope(s) to request (space-separated)",
        },
      },
      "required": [
        "url",
        "name",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "mcp_list_servers",
    "name": "mcp_list_servers",
    "description":
      "List all registered MCP servers for this space, including their status.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "required": [],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "mcp_update_server",
    "name": "mcp_update_server",
    "description": "Rename or enable/disable a registered MCP server.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "MCP server ID",
        },
        "name": {
          "type": "string",
          "description": "Optional new server name",
        },
        "enabled": {
          "type": "boolean",
          "description": "Optional enabled status",
        },
      },
      "required": [
        "id",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "mcp_remove_server",
    "name": "mcp_remove_server",
    "description": "Remove a registered MCP server from this space by id.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "MCP server id",
        },
      },
      "required": [
        "id",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "space_files_list",
    "name": "space_files_list",
    "description":
      "List files and folders in the space storage. Space storage is a shared file store for the space (separate from the container filesystem). Use this to browse uploaded files, documents, and assets.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description":
            'Directory path to list (default: "/" for root). Example: "/docs", "/images"',
        },
      },
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "space_files_read",
    "name": "space_files_read",
    "description":
      "Read the content of a file from space storage. Returns text content for text files, or base64-encoded content for binary files. Supports reading by file ID or by path. Max file size: 50MB.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "file_id": {
          "type": "string",
          "description": "The file ID to read. Use this or path, not both.",
        },
        "path": {
          "type": "string",
          "description":
            'The file path to read (e.g. "/docs/readme.md"). Use this or file_id, not both.',
        },
      },
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "space_files_write",
    "name": "space_files_write",
    "description": "Replace the content of an existing space storage file.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "file_id": {
          "type": "string",
          "description": "The file ID to update. Use this or path, not both.",
        },
        "path": {
          "type": "string",
          "description":
            "The file path to update. Use this or file_id, not both.",
        },
        "content": {
          "type": "string",
          "description": "New file content",
        },
        "mime_type": {
          "type": "string",
          "description": "Optional MIME type override",
        },
      },
      "required": [
        "content",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "space_files_create",
    "name": "space_files_create",
    "description": "Create a new space storage file with content.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Path to create, e.g. /docs/plan.md",
        },
        "content": {
          "type": "string",
          "description": "File content",
        },
        "mime_type": {
          "type": "string",
          "description": "Optional MIME type",
        },
      },
      "required": [
        "path",
        "content",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "space_files_mkdir",
    "name": "space_files_mkdir",
    "description": "Create a space storage folder.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Folder path to create, e.g. /docs/specs",
        },
      },
      "required": [
        "path",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "space_files_delete",
    "name": "space_files_delete",
    "description": "Delete a space storage file or folder by ID or path.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "file_id": {
          "type": "string",
          "description":
            "The file or folder ID to delete. Use this or path, not both.",
        },
        "path": {
          "type": "string",
          "description":
            "The file or folder path to delete. Use this or file_id, not both.",
        },
      },
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "space_files_rename",
    "name": "space_files_rename",
    "description": "Rename a space storage file or folder.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "file_id": {
          "type": "string",
          "description":
            "The file or folder ID to rename. Use this or path, not both.",
        },
        "path": {
          "type": "string",
          "description":
            "The file or folder path to rename. Use this or file_id, not both.",
        },
        "new_name": {
          "type": "string",
          "description": "New base name",
        },
      },
      "required": [
        "new_name",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "space_files_move",
    "name": "space_files_move",
    "description": "Move a space storage file or folder into another folder.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "file_id": {
          "type": "string",
          "description":
            "The file or folder ID to move. Use this or path, not both.",
        },
        "path": {
          "type": "string",
          "description":
            "The file or folder path to move. Use this or file_id, not both.",
        },
        "parent_path": {
          "type": "string",
          "description": "Destination folder path",
        },
      },
      "required": [
        "parent_path",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "skill_list",
    "name": "skill_list",
    "description": "List custom skills configured for this space.",
    "inputSchema": {
      "type": "object",
      "properties": {},
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "skill_get",
    "name": "skill_get",
    "description": "Get a custom skill in this space by id.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "skill_id": {
          "type": "string",
          "description": "Skill id",
        },
      },
      "required": [
        "skill_id",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "skill_create",
    "name": "skill_create",
    "description": "Create a new custom skill in this space.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "Skill name",
        },
        "description": {
          "type": "string",
          "description": "Optional skill description",
        },
        "instructions": {
          "type": "string",
          "description": "Skill instructions",
        },
        "triggers": {
          "type": "array",
          "description": "Optional trigger phrases",
          "items": {
            "type": "string",
            "description": "Trigger phrase",
          },
        },
        "metadata": {
          "type": "object",
          "description":
            "Optional structured metadata for skill selection and execution planning.",
          "properties": {
            "locale": {
              "type": "string",
              "enum": [
                "ja",
                "en",
              ],
              "description": "Preferred locale for this custom skill.",
            },
            "category": {
              "type": "string",
              "enum": [
                "research",
                "writing",
                "planning",
                "slides",
                "software",
              ],
              "description": "Optional category hint for resolver scoring.",
            },
            "activation_tags": {
              "type": "array",
              "description":
                "Optional activation tags that help the resolver match this skill.",
              "items": {
                "type": "string",
                "description": "Activation tag",
              },
            },
            "execution_contract": {
              "type": "object",
              "description":
                "Optional execution contract hints for preferred tools and durable outputs.",
              "properties": {
                "preferred_tools": {
                  "type": "array",
                  "description": "Preferred tools for this skill.",
                  "items": {
                    "type": "string",
                    "description": "Preferred tool name",
                  },
                },
                "durable_output_hints": {
                  "type": "array",
                  "description":
                    "Durable outputs this skill prefers to create or update.",
                  "items": {
                    "type": "string",
                    "enum": [
                      "artifact",
                      "reminder",
                      "repo",
                      "app",
                      "workspace_file",
                    ],
                    "description": "Durable output hint",
                  },
                },
                "output_modes": {
                  "type": "array",
                  "description":
                    "Output modes this skill can satisfy. text and structured are accepted aliases for chat.",
                  "items": {
                    "type": "string",
                    "enum": [
                      "chat",
                      "text",
                      "structured",
                      "artifact",
                      "reminder",
                      "repo",
                      "app",
                      "workspace_file",
                    ],
                    "description": "Output mode",
                  },
                },
                "required_mcp_servers": {
                  "type": "array",
                  "description": "Required MCP server names.",
                  "items": {
                    "type": "string",
                    "description": "Required MCP server name",
                  },
                },
                "template_ids": {
                  "type": "array",
                  "description":
                    "Template identifiers associated with this skill.",
                  "items": {
                    "type": "string",
                    "description": "Template identifier",
                  },
                },
              },
            },
          },
        },
      },
      "required": [
        "name",
        "instructions",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "skill_update",
    "name": "skill_update",
    "description": "Update an existing custom skill in this space by id.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "skill_id": {
          "type": "string",
          "description": "Existing skill id",
        },
        "name": {
          "type": "string",
          "description": "Updated skill name",
        },
        "description": {
          "type": "string",
          "description": "Updated description",
        },
        "instructions": {
          "type": "string",
          "description": "Updated instructions",
        },
        "triggers": {
          "type": "array",
          "description": "Updated trigger phrases",
          "items": {
            "type": "string",
            "description": "Trigger phrase",
          },
        },
        "metadata": {
          "type": "object",
          "description":
            "Optional structured metadata for skill selection and execution planning.",
          "properties": {
            "locale": {
              "type": "string",
              "enum": [
                "ja",
                "en",
              ],
              "description": "Preferred locale for this custom skill.",
            },
            "category": {
              "type": "string",
              "enum": [
                "research",
                "writing",
                "planning",
                "slides",
                "software",
              ],
              "description": "Optional category hint for resolver scoring.",
            },
            "activation_tags": {
              "type": "array",
              "description":
                "Optional activation tags that help the resolver match this skill.",
              "items": {
                "type": "string",
                "description": "Activation tag",
              },
            },
            "execution_contract": {
              "type": "object",
              "description":
                "Optional execution contract hints for preferred tools and durable outputs.",
              "properties": {
                "preferred_tools": {
                  "type": "array",
                  "description": "Preferred tools for this skill.",
                  "items": {
                    "type": "string",
                    "description": "Preferred tool name",
                  },
                },
                "durable_output_hints": {
                  "type": "array",
                  "description":
                    "Durable outputs this skill prefers to create or update.",
                  "items": {
                    "type": "string",
                    "enum": [
                      "artifact",
                      "reminder",
                      "repo",
                      "app",
                      "workspace_file",
                    ],
                    "description": "Durable output hint",
                  },
                },
                "output_modes": {
                  "type": "array",
                  "description":
                    "Output modes this skill can satisfy. text and structured are accepted aliases for chat.",
                  "items": {
                    "type": "string",
                    "enum": [
                      "chat",
                      "text",
                      "structured",
                      "artifact",
                      "reminder",
                      "repo",
                      "app",
                      "workspace_file",
                    ],
                    "description": "Output mode",
                  },
                },
                "required_mcp_servers": {
                  "type": "array",
                  "description": "Required MCP server names.",
                  "items": {
                    "type": "string",
                    "description": "Required MCP server name",
                  },
                },
                "template_ids": {
                  "type": "array",
                  "description":
                    "Template identifiers associated with this skill.",
                  "items": {
                    "type": "string",
                    "description": "Template identifier",
                  },
                },
              },
            },
          },
        },
        "enabled": {
          "type": "boolean",
          "description": "Updated enabled flag",
        },
      },
      "required": [
        "skill_id",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "skill_toggle",
    "name": "skill_toggle",
    "description": "Enable or disable a custom skill in this space by id.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "skill_id": {
          "type": "string",
          "description": "Skill id",
        },
        "enabled": {
          "type": "boolean",
          "description": "Whether the skill should be enabled",
        },
      },
      "required": [
        "skill_id",
        "enabled",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "skill_delete",
    "name": "skill_delete",
    "description": "Delete a custom skill in this space by id.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "skill_id": {
          "type": "string",
          "description": "Skill id",
        },
      },
      "required": [
        "skill_id",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "skill_context",
    "name": "skill_context",
    "description":
      "List the agent-visible skill catalog, including managed skills and enabled custom skills.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "locale": {
          "type": "string",
          "description":
            "Optional locale for localized managed skill text (ja or en).",
          "enum": [
            "ja",
            "en",
          ],
        },
      },
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "skill_catalog",
    "name": "skill_catalog",
    "description":
      "List the full agent-visible skill catalog, including managed skills and enabled custom skills.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "locale": {
          "type": "string",
          "description":
            "Optional locale for localized managed skill text (ja or en).",
          "enum": [
            "ja",
            "en",
          ],
        },
      },
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "skill_describe",
    "name": "skill_describe",
    "description": "Describe one managed or custom skill in detail.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "skill_ref": {
          "type": "string",
          "description":
            "Skill reference. Managed skills use the managed skill id; custom skills should use the skill id. When source is omitted, Takos resolves managed first, then custom by id, then custom by name.",
        },
        "source": {
          "type": "string",
          "description": "Optional skill source hint.",
          "enum": [
            "managed",
            "custom",
          ],
        },
        "locale": {
          "type": "string",
          "description":
            "Optional locale for localized managed skill text (ja or en).",
          "enum": [
            "ja",
            "en",
          ],
        },
      },
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "store_search",
    "name": "store_search",
    "description":
      "Search the Takos store/catalog for public repositories and deployable apps.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description":
            "Search query. Leave empty to browse the current sort order.",
        },
        "type": {
          "type": "string",
          "description": "Catalog item type filter.",
          "enum": [
            "all",
            "repo",
            "deployable-app",
          ],
        },
        "sort": {
          "type": "string",
          "description": "Sort order for results.",
          "enum": [
            "trending",
            "new",
            "stars",
            "updated",
            "downloads",
          ],
        },
        "limit": {
          "type": "number",
          "description":
            "Maximum number of results to return (default: 10, max: 20).",
        },
        "category": {
          "type": "string",
          "description": "Optional category filter.",
        },
        "language": {
          "type": "string",
          "description": "Optional language filter.",
        },
        "license": {
          "type": "string",
          "description": "Optional license filter.",
        },
        "since": {
          "type": "string",
          "description": "Optional date filter in YYYY-MM-DD format.",
        },
        "tags": {
          "type": "string",
          "description": "Optional comma-separated tag filter.",
        },
        "certified_only": {
          "type": "boolean",
          "description": "Only return certified deployable apps.",
        },
      },
      "required": [],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "repo_fork",
    "name": "repo_fork",
    "description":
      "Fork a Takos repository into the current space so it becomes an owned code asset.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "repo_id": {
          "type": "string",
          "description": "Source repository ID to fork.",
        },
        "name": {
          "type": "string",
          "description": "Optional name for the fork in the current space.",
        },
      },
      "required": [
        "repo_id",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "toolbox",
    "name": "toolbox",
    "description":
      "Search and use the full tool/manual catalog. Use this proactively when the direct tools do not obviously cover the task: action=search to find tools or manuals, describe to inspect schemas or instructions, call to execute a tool, and families to list capability groups.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "description": "Toolbox operation to run.",
          "enum": [
            "search",
            "describe",
            "call",
            "families",
          ],
        },
        "query": {
          "type": "string",
          "description": "Natural language search query for action=search.",
        },
        "limit": {
          "type": "number",
          "description": "Maximum search results. Default: 10.",
        },
        "tool_name": {
          "type": "string",
          "description":
            "Tool name for action=describe or action=call. For action=describe this may also be a manual id or name returned by search.",
        },
        "tool_names": {
          "type": "array",
          "description": "Tool or manual names for action=describe.",
          "items": {
            "type": "string",
            "description": "Tool or manual name.",
          },
        },
        "arguments": {
          "type": "object",
          "description": "Arguments passed to the target tool for action=call.",
        },
      },
      "required": [
        "action",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "capability_search",
    "name": "capability_search",
    "description":
      "Search for tools or manuals by capability or intent. Use this early when you need to find the right tool quickly or verify whether a broader capability exists.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description":
            'Natural language query describing the capability you need (e.g., "upload file to object store", "create kv store").',
        },
        "limit": {
          "type": "number",
          "description": "Maximum number of results to return. Default: 10.",
        },
      },
      "required": [
        "query",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "capability_families",
    "name": "capability_families",
    "description":
      "List all tool/skill families and their sizes. Use this to explore what categories of capabilities are available.",
    "inputSchema": {
      "type": "object",
      "properties": {},
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "capability_describe",
    "name": "capability_describe",
    "description":
      "Get full descriptions and input schemas for tools discovered via capability_search. Use this before capability_invoke when arguments are not obvious.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tool_name": {
          "type": "string",
          "description":
            "Single tool or manual name to describe. Use tool_names for multiple entries.",
        },
        "tool_names": {
          "type": "array",
          "description":
            "Tool or manual names to describe. Keep this small and describe only candidates you may use.",
          "items": {
            "type": "string",
            "description": "Tool or manual name returned by capability_search.",
          },
        },
      },
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "capability_invoke",
    "name": "capability_invoke",
    "description":
      "Execute a tool discovered via capability_search or described via capability_describe. The tool is resolved and executed with the same permission checks as direct calls.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tool_name": {
          "type": "string",
          "description":
            "The name of the tool to execute (as returned by capability_search).",
        },
        "arguments": {
          "type": "object",
          "description":
            "Arguments to pass to the tool. Use capability_describe first when you need the tool's input schema.",
        },
      },
      "required": [
        "tool_name",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
  {
    "id": "memory_graph_recall",
    "name": "memory_graph_recall",
    "description":
      'Search structured memory claims, paths between claims, or evidence supporting a claim. Use mode "claims" to find facts, "path_search" to discover relationships, "evidence" to see supporting/contradicting references.',
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description":
            "Search query (for claims mode) or context description",
        },
        "mode": {
          "type": "string",
          "description":
            'Retrieval mode: "claims" (search facts), "path_search" (find relationships), "evidence" (get references)',
          "enum": [
            "claims",
            "path_search",
            "evidence",
          ],
        },
        "claim_id": {
          "type": "string",
          "description": "Claim ID for evidence or path_search mode",
        },
        "limit": {
          "type": "number",
          "description": "Max results (default 10)",
        },
      },
      "required": [
        "query",
        "mode",
      ],
    },
    "enabled": true,
    "type": "custom",
    "bundleDeploymentId": null,
  },
];

export function listCustomTools(): readonly SerializedCustomTool[] {
  return CUSTOM_TOOL_CATALOG;
}

export function getCustomTool(name: string): SerializedCustomTool | undefined {
  return CUSTOM_TOOL_CATALOG.find((tool) => tool.name === name);
}
