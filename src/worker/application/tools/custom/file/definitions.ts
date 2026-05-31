import type { ToolDefinition } from "../../tool-definitions.ts";

export const FILE_READ: ToolDefinition = {
  name: "file_read",
  description:
    "Read the contents of a file in the space. Supports text files, images (returns base64), and PDFs.",
  category: "file",
  parameters: {
    type: "object",
    properties: {
      repo_id: {
        type: "string",
        description:
          "Repository ID to scope this path (optional, for multi-repo sessions).",
      },
      mount_path: {
        type: "string",
        description:
          "Mounted path to scope this file operation (optional, for multi-repo sessions).",
      },
      path: {
        type: "string",
        description: "The file path relative to space root",
      },
    },
    required: ["path"],
  },
};

export const FILE_WRITE: ToolDefinition = {
  name: "file_write",
  description:
    "Write content to a file in the space. Creates the file if it does not exist, updates if it exists.",
  category: "file",
  parameters: {
    type: "object",
    properties: {
      repo_id: {
        type: "string",
        description:
          "Repository ID to scope this path (optional, for multi-repo sessions).",
      },
      mount_path: {
        type: "string",
        description:
          "Mounted path to scope this file operation (optional, for multi-repo sessions).",
      },
      path: {
        type: "string",
        description: "The file path relative to space root",
      },
      content: {
        type: "string",
        description: "The content to write to the file",
      },
    },
    required: ["path", "content"],
  },
};

export const FILE_WRITE_BINARY: ToolDefinition = {
  name: "file_write_binary",
  description:
    "Write binary content (base64 encoded) to a file. Use this for images, fonts, and other binary files.",
  category: "file",
  parameters: {
    type: "object",
    properties: {
      repo_id: {
        type: "string",
        description:
          "Repository ID to scope this path (optional, for multi-repo sessions).",
      },
      mount_path: {
        type: "string",
        description:
          "Mounted path to scope this file operation (optional, for multi-repo sessions).",
      },
      path: {
        type: "string",
        description: "The file path relative to space root",
      },
      content_base64: {
        type: "string",
        description: "The binary content encoded as base64",
      },
    },
    required: ["path", "content_base64"],
  },
};

export const FILE_LIST: ToolDefinition = {
  name: "file_list",
  description: "List files and directories in a path",
  category: "file",
  parameters: {
    type: "object",
    properties: {
      repo_id: {
        type: "string",
        description:
          "Repository ID to scope this path (optional, for multi-repo sessions).",
      },
      mount_path: {
        type: "string",
        description:
          "Mounted path to scope this file operation (optional, for multi-repo sessions).",
      },
      path: {
        type: "string",
        description:
          "The directory path relative to space root. Empty string for root.",
      },
    },
    required: [],
  },
};

export const FILE_DELETE: ToolDefinition = {
  name: "file_delete",
  description: "Delete a file from the space",
  category: "file",
  parameters: {
    type: "object",
    properties: {
      repo_id: {
        type: "string",
        description:
          "Repository ID to scope this path (optional, for multi-repo sessions).",
      },
      mount_path: {
        type: "string",
        description:
          "Mounted path to scope this file operation (optional, for multi-repo sessions).",
      },
      path: {
        type: "string",
        description: "The file path relative to space root",
      },
    },
    required: ["path"],
  },
};

export const FILE_MKDIR: ToolDefinition = {
  name: "file_mkdir",
  description: "Create a directory in the space.",
  category: "file",
  parameters: {
    type: "object",
    properties: {
      repo_id: {
        type: "string",
        description:
          "Repository ID to scope this path (optional, for multi-repo sessions).",
      },
      mount_path: {
        type: "string",
        description:
          "Mounted path to scope this file operation (optional, for multi-repo sessions).",
      },
      path: {
        type: "string",
        description: "The directory path relative to space root",
      },
    },
    required: ["path"],
  },
};

export const FILE_RENAME: ToolDefinition = {
  name: "file_rename",
  description: "Rename or move a file/directory to a new path",
  category: "file",
  parameters: {
    type: "object",
    properties: {
      repo_id: {
        type: "string",
        description:
          "Repository ID to scope this path (optional, for multi-repo sessions).",
      },
      mount_path: {
        type: "string",
        description:
          "Mounted path to scope this file operation (optional, for multi-repo sessions).",
      },
      old_path: {
        type: "string",
        description: "The current file/directory path",
      },
      new_path: {
        type: "string",
        description: "The new file/directory path",
      },
    },
    required: ["old_path", "new_path"],
  },
};

export const FILE_COPY: ToolDefinition = {
  name: "file_copy",
  description: "Copy a file to a new location",
  category: "file",
  parameters: {
    type: "object",
    properties: {
      repo_id: {
        type: "string",
        description:
          "Repository ID to scope this path (optional, for multi-repo sessions).",
      },
      mount_path: {
        type: "string",
        description:
          "Mounted path to scope this file operation (optional, for multi-repo sessions).",
      },
      source_path: {
        type: "string",
        description: "The source file path",
      },
      dest_path: {
        type: "string",
        description: "The destination file path",
      },
    },
    required: ["source_path", "dest_path"],
  },
};

export const FILE_TOOLS: ToolDefinition[] = [
  FILE_READ,
  FILE_WRITE,
  FILE_WRITE_BINARY,
  FILE_LIST,
  FILE_DELETE,
  FILE_MKDIR,
  FILE_RENAME,
  FILE_COPY,
];
