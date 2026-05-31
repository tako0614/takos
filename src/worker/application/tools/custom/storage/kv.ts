import type {
  ToolContext,
  ToolDefinition,
  ToolHandler,
} from "../../tool-definitions.ts";
import { validateKVKey } from "./validators.ts";

export const KEY_VALUE_GET: ToolDefinition = {
  name: "key_value_get",
  description: "Get a value from a key-value namespace",
  category: "storage",
  parameters: {
    type: "object",
    properties: {
      namespace: {
        type: "string",
        description: 'Key-value namespace name (e.g., "HOSTNAME_ROUTING")',
      },
      key: {
        type: "string",
        description: "Key to retrieve",
      },
    },
    required: ["namespace", "key"],
  },
};

export const KEY_VALUE_PUT: ToolDefinition = {
  name: "key_value_put",
  description: "Store a value in a key-value namespace",
  category: "storage",
  parameters: {
    type: "object",
    properties: {
      namespace: {
        type: "string",
        description: "Key-value namespace name",
      },
      key: {
        type: "string",
        description: "Key to store",
      },
      value: {
        type: "string",
        description: "Value to store",
      },
      expiration_ttl: {
        type: "number",
        description: "Time to live in seconds (optional)",
      },
    },
    required: ["namespace", "key", "value"],
  },
};

export const KEY_VALUE_DELETE: ToolDefinition = {
  name: "key_value_delete",
  description: "Delete a key from a key-value namespace",
  category: "storage",
  parameters: {
    type: "object",
    properties: {
      namespace: {
        type: "string",
        description: "Key-value namespace name",
      },
      key: {
        type: "string",
        description: "Key to delete",
      },
    },
    required: ["namespace", "key"],
  },
};

export const KEY_VALUE_LIST: ToolDefinition = {
  name: "key_value_list",
  description: "List keys in a key-value namespace with optional prefix filter",
  category: "storage",
  parameters: {
    type: "object",
    properties: {
      namespace: {
        type: "string",
        description: "Key-value namespace name",
      },
      prefix: {
        type: "string",
        description: "Key prefix to filter (optional)",
      },
      limit: {
        type: "number",
        description:
          "Maximum number of keys to return (default: 100, max: 1000)",
      },
    },
    required: ["namespace"],
  },
};

export const keyValueGetHandler: ToolHandler = async (args, context) => {
  const namespace = args.namespace as string;
  const key = validateKVKey(args.key as string);

  const kv = getKVNamespace(namespace, context);

  const value = await kv.get(key);

  if (value === null) {
    return `Key not found: ${key}`;
  }

  return `Value: ${value}`;
};

export const keyValuePutHandler: ToolHandler = async (args, context) => {
  const namespace = args.namespace as string;
  const key = validateKVKey(args.key as string);
  const value = args.value as string;
  const expirationTtl = args.expiration_ttl as number | undefined;

  if (typeof value !== "string") {
    throw new Error("Invalid value: must be a string");
  }
  if (value.length > 1024 * 1024) {
    throw new Error("Invalid value: exceeds maximum size of 1MB");
  }

  const kv = getKVNamespace(namespace, context);

  const options: { expirationTtl?: number } = {};
  if (expirationTtl) {
    if (expirationTtl < 60 || expirationTtl > 365 * 24 * 60 * 60) {
      throw new Error("Invalid TTL: must be between 60 seconds and 1 year");
    }
    options.expirationTtl = expirationTtl;
  }

  await kv.put(key, value, options);

  return `Stored: ${key}`;
};

export const keyValueDeleteHandler: ToolHandler = async (args, context) => {
  const namespace = args.namespace as string;
  const key = validateKVKey(args.key as string);

  const kv = getKVNamespace(namespace, context);

  await kv.delete(key);

  return `Deleted: ${key}`;
};

export const keyValueListHandler: ToolHandler = async (args, context) => {
  const namespace = args.namespace as string;
  const prefix = args.prefix as string | undefined;
  const limit = Math.min((args.limit as number) || 100, 1000);

  const kv = getKVNamespace(namespace, context);

  const options: { prefix?: string; limit: number } = { limit };
  if (prefix) {
    options.prefix = prefix;
  }

  const result = await kv.list(options);
  const keys = result.keys;

  if (keys.length === 0) {
    return prefix
      ? `No keys found with prefix: ${prefix}`
      : "No keys found in namespace";
  }

  const lines = keys.map((keyItem: { name: string; expiration?: number }) => {
    let line = keyItem.name;
    if (keyItem.expiration) {
      const exp = new Date(keyItem.expiration * 1000).toISOString();
      line += ` (expires: ${exp})`;
    }
    return line;
  });

  let output = `Keys in ${namespace}:\n${lines.join("\n")}`;
  if (!result.list_complete) {
    output += `\n\n(More keys available, showing first ${keys.length})`;
  }
  return output;
};

function getKVNamespace(name: string, context: ToolContext) {
  const { env } = context;
  const kv = name === "HOSTNAME_ROUTING" ? env.HOSTNAME_ROUTING : null;
  if (!kv) {
    throw new Error(`Key-value namespace not found: ${name}`);
  }
  return kv;
}

export const KEY_VALUE_TOOLS: ToolDefinition[] = [
  KEY_VALUE_GET,
  KEY_VALUE_PUT,
  KEY_VALUE_DELETE,
  KEY_VALUE_LIST,
];

export const KEY_VALUE_HANDLERS: Record<string, ToolHandler> = {
  key_value_get: keyValueGetHandler,
  key_value_put: keyValuePutHandler,
  key_value_delete: keyValueDeleteHandler,
  key_value_list: keyValueListHandler,
};
