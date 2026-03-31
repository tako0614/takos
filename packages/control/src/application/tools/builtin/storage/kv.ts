import type { ToolDefinition, ToolHandler, ToolContext } from '../../tool-definitions.ts';
import { validateKVKey } from './validators.ts';

export const KV_GET: ToolDefinition = {
  name: 'kv_get',
  description: 'Get a value from KV namespace',
  category: 'storage',
  parameters: {
    type: 'object',
    properties: {
      namespace: {
        type: 'string',
        description: 'KV namespace name (e.g., "HOSTNAME_ROUTING")',
      },
      key: {
        type: 'string',
        description: 'Key to retrieve',
      },
    },
    required: ['namespace', 'key'],
  },
};

export const KV_PUT: ToolDefinition = {
  name: 'kv_put',
  description: 'Store a value in KV namespace',
  category: 'storage',
  parameters: {
    type: 'object',
    properties: {
      namespace: {
        type: 'string',
        description: 'KV namespace name',
      },
      key: {
        type: 'string',
        description: 'Key to store',
      },
      value: {
        type: 'string',
        description: 'Value to store',
      },
      expiration_ttl: {
        type: 'number',
        description: 'Time to live in seconds (optional)',
      },
    },
    required: ['namespace', 'key', 'value'],
  },
};

export const KV_DELETE: ToolDefinition = {
  name: 'kv_delete',
  description: 'Delete a key from KV namespace',
  category: 'storage',
  parameters: {
    type: 'object',
    properties: {
      namespace: {
        type: 'string',
        description: 'KV namespace name',
      },
      key: {
        type: 'string',
        description: 'Key to delete',
      },
    },
    required: ['namespace', 'key'],
  },
};

export const KV_LIST: ToolDefinition = {
  name: 'kv_list',
  description: 'List keys in a KV namespace with optional prefix filter',
  category: 'storage',
  parameters: {
    type: 'object',
    properties: {
      namespace: {
        type: 'string',
        description: 'KV namespace name',
      },
      prefix: {
        type: 'string',
        description: 'Key prefix to filter (optional)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of keys to return (default: 100, max: 1000)',
      },
    },
    required: ['namespace'],
  },
};

export const kvGetHandler: ToolHandler = async (args, context) => {
  const namespace = args.namespace as string;
  const key = validateKVKey(args.key as string);

  const kv = getKVNamespace(namespace, context);

  const value = await kv.get(key);

  if (value === null) {
    return `Key not found: ${key}`;
  }

  return `Value: ${value}`;
};

export const kvPutHandler: ToolHandler = async (args, context) => {
  const namespace = args.namespace as string;
  const key = validateKVKey(args.key as string);
  const value = args.value as string;
  const expirationTtl = args.expiration_ttl as number | undefined;

  if (typeof value !== 'string') {
    throw new Error('Invalid value: must be a string');
  }
  if (value.length > 1024 * 1024) {
    throw new Error('Invalid value: exceeds maximum size of 1MB');
  }

  const kv = getKVNamespace(namespace, context);

  const options: { expirationTtl?: number } = {};
  if (expirationTtl) {
    if (expirationTtl < 60 || expirationTtl > 365 * 24 * 60 * 60) {
      throw new Error('Invalid TTL: must be between 60 seconds and 1 year');
    }
    options.expirationTtl = expirationTtl;
  }

  await kv.put(key, value, options);

  return `Stored: ${key}`;
};

export const kvDeleteHandler: ToolHandler = async (args, context) => {
  const namespace = args.namespace as string;
  const key = validateKVKey(args.key as string);

  const kv = getKVNamespace(namespace, context);

  await kv.delete(key);

  return `Deleted: ${key}`;
};

export const kvListHandler: ToolHandler = async (args, context) => {
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
    return prefix ? `No keys found with prefix: ${prefix}` : 'No keys found in namespace';
  }

  const lines = keys.map((keyItem: { name: string; expiration?: number }) => {
    let line = keyItem.name;
    if (keyItem.expiration) {
      const exp = new Date(keyItem.expiration * 1000).toISOString();
      line += ` (expires: ${exp})`;
    }
    return line;
  });

  let output = `Keys in ${namespace}:\n${lines.join('\n')}`;
  if (!result.list_complete) {
    output += `\n\n(More keys available, showing first ${keys.length})`;
  }
  return output;
};

function getKVNamespace(name: string, context: ToolContext) {
  const { env } = context;
  const kv = name === 'HOSTNAME_ROUTING' ? env.HOSTNAME_ROUTING : null;
  if (!kv) {
    throw new Error(`KV namespace not found: ${name}`);
  }
  return kv;
}

export const KV_TOOLS: ToolDefinition[] = [KV_GET, KV_PUT, KV_DELETE, KV_LIST];

export const KV_HANDLERS: Record<string, ToolHandler> = {
  kv_get: kvGetHandler,
  kv_put: kvPutHandler,
  kv_delete: kvDeleteHandler,
  kv_list: kvListHandler,
};
