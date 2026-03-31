import type { ToolDefinition, ToolHandler, ToolContext } from '../../tool-definitions.ts';
import { validateR2Key, validateStoragePath } from './validators.ts';
import { computeSHA256 } from '../../../../shared/utils/hash.ts';
import { getDb, files } from '../../../../infra/db/index.ts';
import { eq, and } from 'drizzle-orm';
import { generateId } from '../../../../shared/utils/index.ts';

export const R2_UPLOAD: ToolDefinition = {
  name: 'r2_upload',
  description: 'Upload a file from workspace to R2 bucket',
  category: 'storage',
  parameters: {
    type: 'object',
    properties: {
      bucket: {
        type: 'string',
        description: 'R2 bucket name (TENANT_SOURCE, TENANT_BUILDS, WORKER_BUNDLES)',
      },
      key: {
        type: 'string',
        description: 'Object key (path) to store',
      },
      file_path: {
        type: 'string',
        description: 'File path in workspace to upload',
      },
      content_type: {
        type: 'string',
        description: 'Content type (optional)',
      },
    },
    required: ['bucket', 'key', 'file_path'],
  },
};

export const R2_DOWNLOAD: ToolDefinition = {
  name: 'r2_download',
  description: 'Download an object from R2 bucket to workspace file',
  category: 'storage',
  parameters: {
    type: 'object',
    properties: {
      bucket: {
        type: 'string',
        description: 'R2 bucket name',
      },
      key: {
        type: 'string',
        description: 'Object key (path) to download',
      },
      dest_path: {
        type: 'string',
        description: 'Destination file path in workspace',
      },
    },
    required: ['bucket', 'key', 'dest_path'],
  },
};

export const R2_LIST: ToolDefinition = {
  name: 'r2_list',
  description: 'List objects in R2 bucket with optional prefix filter',
  category: 'storage',
  parameters: {
    type: 'object',
    properties: {
      bucket: {
        type: 'string',
        description: 'R2 bucket name',
      },
      prefix: {
        type: 'string',
        description: 'Prefix to filter objects (optional)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of objects to return (default: 100, max: 1000)',
      },
    },
    required: ['bucket'],
  },
};

export const R2_DELETE: ToolDefinition = {
  name: 'r2_delete',
  description: 'Delete an object from R2 bucket',
  category: 'storage',
  parameters: {
    type: 'object',
    properties: {
      bucket: {
        type: 'string',
        description: 'R2 bucket name',
      },
      key: {
        type: 'string',
        description: 'Object key (path) to delete',
      },
    },
    required: ['bucket', 'key'],
  },
};

export const R2_INFO: ToolDefinition = {
  name: 'r2_info',
  description: 'Get metadata about an object in R2 bucket (size, content-type, etc.)',
  category: 'storage',
  parameters: {
    type: 'object',
    properties: {
      bucket: {
        type: 'string',
        description: 'R2 bucket name',
      },
      key: {
        type: 'string',
        description: 'Object key (path) to inspect',
      },
    },
    required: ['bucket', 'key'],
  },
};

export const r2UploadHandler: ToolHandler = async (args, context) => {
  const bucketName = args.bucket as string;
  const key = validateR2Key(args.key as string, context);
  const filePath = validateStoragePath(args.file_path as string, 'file_path');
  const contentType = args.content_type as string | undefined;

  const bucket = getR2Bucket(bucketName, context);

  if (!context.storage) {
    throw new Error('Workspace storage not configured');
  }

  const db = getDb(context.db);
  const file = await db.select({ id: files.id })
    .from(files).where(and(eq(files.accountId, context.spaceId), eq(files.path, filePath))).get();

  if (!file) {
    throw new Error(`File not found: ${filePath}`);
  }

  const r2Key = `spaces/${context.spaceId}/files/${file.id}`;
  const object = await context.storage.get(r2Key);

  if (!object) {
    throw new Error(`File content not found: ${filePath}`);
  }

  const content = await object.arrayBuffer();

  const MAX_UPLOAD_SIZE = 10 * 1024 * 1024 * 1024; // 10GB
  if (content.byteLength > MAX_UPLOAD_SIZE) {
    throw new Error(
      `File too large: ${(content.byteLength / 1024 / 1024).toFixed(1)}MB exceeds limit of 10GB`
    );
  }

  const options: { httpMetadata?: { contentType: string } } = {};
  if (contentType) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*$/.test(
        contentType
      )
    ) {
      throw new Error('Invalid content-type format');
    }
    options.httpMetadata = { contentType };
  }

  await bucket.put(key, content, options);

  return `Uploaded: ${filePath} ↁE${bucketName}/${key}`;
};

export const r2DownloadHandler: ToolHandler = async (args, context) => {
  const bucketName = args.bucket as string;
  const key = validateR2Key(args.key as string, context);
  const destPath = validateStoragePath(args.dest_path as string, 'dest_path');

  const bucket = getR2Bucket(bucketName, context);

  const object = await bucket.get(key);

  if (!object) {
    throw new Error(`Object not found: ${bucketName}/${key}`);
  }

  const MAX_DOWNLOAD_SIZE = 10 * 1024 * 1024 * 1024; // 10GB
  if (object.size > MAX_DOWNLOAD_SIZE) {
    throw new Error(
      `Object too large: ${(object.size / 1024 / 1024).toFixed(1)}MB exceeds limit of 10GB`
    );
  }

  const content = await object.arrayBuffer();

  if (!context.storage) {
    throw new Error('Workspace storage not configured');
  }

  const hash = await computeSHA256(content);
  const size = content.byteLength;
  const now = new Date().toISOString();

  const db = getDb(context.db);
  const existingFile = await db.select({ id: files.id })
    .from(files).where(and(eq(files.accountId, context.spaceId), eq(files.path, destPath))).get();

  let fileId: string;

  if (existingFile) {
    fileId = existingFile.id;
    await db.update(files).set({ sha256: hash, size, updatedAt: now })
      .where(eq(files.id, fileId));
  } else {
    fileId = generateId();
    await db.insert(files).values({
      id: fileId,
      accountId: context.spaceId,
      path: destPath,
      sha256: hash,
      size,
      origin: 'system',
      kind: 'source',
      visibility: 'private',
      createdAt: now,
      updatedAt: now,
    });
  }

  const r2Key = `spaces/${context.spaceId}/files/${fileId}`;
  await context.storage.put(r2Key, content);

  return `Downloaded: ${bucketName}/${key} ↁE${destPath}`;
};

export const r2ListHandler: ToolHandler = async (args, context) => {
  const bucketName = args.bucket as string;
  const prefix = args.prefix as string | undefined;
  const limit = Math.min((args.limit as number) || 100, 1000);

  const bucket = getR2Bucket(bucketName, context);

  const options: { prefix?: string; limit: number } = { limit };
  if (prefix) {
    options.prefix = validateStoragePath(prefix, 'prefix');
  }

  const result = await bucket.list(options);
  const objects = result.objects;

  if (objects.length === 0) {
    return prefix
      ? `No objects found with prefix: ${prefix}`
      : `No objects found in bucket: ${bucketName}`;
  }

  const lines = objects.map((obj: { key: string; size: number; uploaded?: Date }) => {
    const sizeKB = (obj.size / 1024).toFixed(1);
    const modified = obj.uploaded ? obj.uploaded.toISOString().split('T')[0] : '-';
    return `${obj.key} (${sizeKB} KB, ${modified})`;
  });

  let output = `Objects in ${bucketName}:\n${lines.join('\n')}`;
  if (result.truncated) {
    output += `\n\n(More objects available, showing first ${objects.length})`;
  }
  return output;
};

export const r2DeleteHandler: ToolHandler = async (args, context) => {
  const bucketName = args.bucket as string;
  const key = validateR2Key(args.key as string, context);

  const bucket = getR2Bucket(bucketName, context);

  await bucket.delete(key);

  return `Deleted: ${bucketName}/${key}`;
};

export const r2InfoHandler: ToolHandler = async (args, context) => {
  const bucketName = args.bucket as string;
  const key = validateR2Key(args.key as string, context);

  const bucket = getR2Bucket(bucketName, context);

  const object = await bucket.head(key);

  if (!object) {
    throw new Error(`Object not found: ${bucketName}/${key}`);
  }

  const sizeKB = (object.size / 1024).toFixed(2);
  const sizeMB = (object.size / (1024 * 1024)).toFixed(2);
  const uploaded = object.uploaded ? object.uploaded.toISOString() : '-';
  const contentType = object.httpMetadata?.contentType || 'unknown';
  const etag = object.etag || '-';

  let output = `Object: ${bucketName}/${key}\n`;
  output += `Size: ${object.size} bytes (${sizeKB} KB / ${sizeMB} MB)\n`;
  output += `Content-Type: ${contentType}\n`;
  output += `Uploaded: ${uploaded}\n`;
  output += `ETag: ${etag}`;

  if (object.customMetadata && Object.keys(object.customMetadata).length > 0) {
    output += '\n\nCustom Metadata:\n';
    for (const [k, v] of Object.entries(object.customMetadata)) {
      output += `  ${k}: ${v}\n`;
    }
  }

  return output;
};

function getR2Bucket(name: string, context: ToolContext) {
  const { env } = context;
  const bucket = name === 'TENANT_SOURCE' ? env.TENANT_SOURCE
    : name === 'TENANT_BUILDS' ? env.TENANT_BUILDS
    : name === 'WORKER_BUNDLES' ? env.WORKER_BUNDLES
    : null;
  if (!bucket) {
    throw new Error(`R2 bucket not found: ${name}`);
  }
  return bucket;
}

export const R2_TOOLS: ToolDefinition[] = [
  R2_UPLOAD,
  R2_DOWNLOAD,
  R2_LIST,
  R2_DELETE,
  R2_INFO,
];

export const R2_HANDLERS: Record<string, ToolHandler> = {
  r2_upload: r2UploadHandler,
  r2_download: r2DownloadHandler,
  r2_list: r2ListHandler,
  r2_delete: r2DeleteHandler,
  r2_info: r2InfoHandler,
};
