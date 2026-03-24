import { Storage } from '@google-cloud/storage';
import type {
  R2Bucket,
  R2Object,
  R2ObjectBody,
} from '../../shared/types/bindings.ts';

// R2Objects is not re-exported from bindings, define inline to match the Cloudflare shape.
interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type GcsObjectStoreConfig = {
  bucket: string;
  projectId?: string;
  keyFilePath?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lazyStorage(config: GcsObjectStoreConfig): () => Storage {
  let storage: Storage | undefined;
  return () => {
    if (!storage) {
      storage = new Storage({
        ...(config.projectId ? { projectId: config.projectId } : {}),
        ...(config.keyFilePath ? { keyFilename: config.keyFilePath } : {}),
      });
    }
    return storage;
  };
}

/**
 * Build the common R2Object-shaped metadata from a GCS file metadata response.
 */
function toR2Object(
  key: string,
  metadata: Record<string, unknown>,
  range?: { offset: number; length: number },
): R2Object {
  const etag = ((metadata.etag as string) ?? '').replace(/"/g, '');
  const size = typeof metadata.size === 'string'
    ? Number.parseInt(metadata.size, 10)
    : typeof metadata.size === 'number'
      ? metadata.size
      : 0;

  const obj: R2Object = {
    key,
    version: etag || (metadata.generation as string) || 'unknown',
    size,
    etag,
    httpEtag: metadata.etag as string ?? `"${etag}"`,
    checksums: {} as any,
    uploaded: metadata.updated ? new Date(metadata.updated as string) : new Date(),
    httpMetadata: {
      contentType: metadata.contentType,
    } as any,
    customMetadata: (metadata.metadata ?? {}) as Record<string, string>,
    writeHttpMetadata(_headers: Headers) {
      // no-op – Cloudflare-specific helper
    },
  } as unknown as R2Object;

  if (range) {
    (obj as any).range = range;
  }

  return obj;
}

/**
 * Consume a GCS download buffer and return its contents as an ArrayBuffer.
 */
function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * Wrap a GCS download result as an R2ObjectBody.
 */
function toR2ObjectBody(
  key: string,
  buffer: Buffer,
  metadata: Record<string, unknown>,
  range?: { offset: number; length: number },
): R2ObjectBody {
  const base = toR2Object(key, metadata, range);

  let bodyUsed = false;
  const bytes = bufferToArrayBuffer(buffer);

  const bodyStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });

  const objectBody: R2ObjectBody = {
    ...base,
    body: bodyStream,
    get bodyUsed() {
      return bodyUsed;
    },
    async arrayBuffer() {
      bodyUsed = true;
      return bytes;
    },
    async text() {
      bodyUsed = true;
      return new TextDecoder().decode(bytes);
    },
    async json<T = unknown>(): Promise<T> {
      bodyUsed = true;
      const t = new TextDecoder().decode(bytes);
      return JSON.parse(t) as T;
    },
    async blob() {
      bodyUsed = true;
      const ct =
        (base as any).httpMetadata?.contentType ?? 'application/octet-stream';
      return new Blob([bytes], { type: ct });
    },
    writeHttpMetadata(_headers: Headers) {
      // no-op
    },
  } as unknown as R2ObjectBody;

  return objectBody;
}

/**
 * Normalise the value passed to put() into a Buffer that GCS file.save() accepts.
 */
async function normaliseBody(
  value: ReadableStream | ArrayBuffer | string | null | Blob,
): Promise<Buffer | string | undefined> {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    const ab = await value.arrayBuffer();
    return Buffer.from(ab);
  }
  // ReadableStream – collect into a Buffer
  const reader = (value as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createGcsObjectStore(config: GcsObjectStoreConfig): R2Bucket {
  const getStorage = lazyStorage(config);

  function getBucket() {
    return getStorage().bucket(config.bucket);
  }

  const store = {
    // ----- head -----
    async head(key: string): Promise<R2Object | null> {
      try {
        const file = getBucket().file(key);
        const [metadata] = await file.getMetadata();
        return toR2Object(key, metadata as Record<string, unknown>);
      } catch (err: any) {
        if (err?.code === 404) {
          return null;
        }
        throw err;
      }
    },

    // ----- get -----
    async get(
      key: string,
      options?: {
        range?: { offset?: number; length?: number; suffix?: number };
      },
    ): Promise<R2ObjectBody | null> {
      try {
        const file = getBucket().file(key);

        // Build download options for range requests
        const downloadOptions: Record<string, unknown> = {};
        if (options?.range) {
          if (options.range.suffix !== undefined) {
            // GCS doesn't have a direct suffix option; compute start from metadata
            const [metadata] = await file.getMetadata();
            const fileSize = typeof (metadata as any).size === 'string'
              ? Number.parseInt((metadata as any).size, 10)
              : (metadata as any).size ?? 0;
            const start = Math.max(0, fileSize - options.range.suffix);
            downloadOptions.start = start;
            downloadOptions.end = fileSize - 1;
          } else {
            const start = options.range.offset ?? 0;
            downloadOptions.start = start;
            if (options.range.length !== undefined) {
              downloadOptions.end = start + options.range.length - 1;
            }
          }
        }

        const [buffer] = await file.download(downloadOptions);
        const [metadata] = await file.getMetadata();

        let rangeInfo: { offset: number; length: number } | undefined;
        if (options?.range) {
          const offset = options.range.offset ?? 0;
          const length = options.range.length ?? buffer.length;
          rangeInfo = { offset, length };
        }

        return toR2ObjectBody(key, buffer, metadata as Record<string, unknown>, rangeInfo);
      } catch (err: any) {
        if (err?.code === 404) {
          return null;
        }
        throw err;
      }
    },

    // ----- put -----
    async put(
      key: string,
      value: ReadableStream | ArrayBuffer | string | null | Blob,
      options?: {
        httpMetadata?: { contentType?: string; [k: string]: unknown };
        customMetadata?: Record<string, string>;
      },
    ): Promise<R2Object | null> {
      const body = await normaliseBody(value);
      const file = getBucket().file(key);

      const saveOptions: Record<string, unknown> = {};
      if (options?.httpMetadata?.contentType) {
        saveOptions.contentType = options.httpMetadata.contentType;
      }
      if (options?.customMetadata) {
        saveOptions.metadata = options.customMetadata;
      }

      await file.save(body ?? '', saveOptions);

      // Return metadata via head
      return store.head(key);
    },

    // ----- delete -----
    async delete(keys: string | string[]): Promise<void> {
      if (typeof keys === 'string') {
        try {
          await getBucket().file(keys).delete();
        } catch (err: any) {
          // Ignore 404 on delete (matches S3/R2 behavior)
          if (err?.code !== 404) throw err;
        }
        return;
      }

      if (keys.length === 0) return;

      // Delete in parallel batches
      const BATCH = 100;
      for (let i = 0; i < keys.length; i += BATCH) {
        const batch = keys.slice(i, i + BATCH);
        await Promise.all(
          batch.map((k) =>
            getBucket().file(k).delete().catch((err: any) => {
              if (err?.code !== 404) throw err;
            }),
          ),
        );
      }
    },

    // ----- list -----
    async list(
      options?: {
        prefix?: string;
        limit?: number;
        cursor?: string;
        delimiter?: string;
        include?: unknown[];
      },
    ): Promise<R2Objects> {
      const queryOptions: Record<string, unknown> = {
        autoPaginate: false,
      };
      if (options?.prefix) queryOptions.prefix = options.prefix;
      if (options?.limit) queryOptions.maxResults = options.limit;
      if (options?.cursor) queryOptions.pageToken = options.cursor;
      if (options?.delimiter) queryOptions.delimiter = options.delimiter;

      const [files, nextQuery, apiResponse] = await getBucket().getFiles(queryOptions);

      const objects: R2Object[] = files.map((file) => {
        const metadata = file.metadata as Record<string, unknown>;
        const etag = ((metadata.etag as string) ?? '').replace(/"/g, '');
        const size = typeof metadata.size === 'string'
          ? Number.parseInt(metadata.size, 10)
          : typeof metadata.size === 'number'
            ? metadata.size
            : 0;

        return {
          key: file.name,
          version: etag || (metadata.generation as string) || 'unknown',
          size,
          etag,
          httpEtag: metadata.etag as string ?? `"${etag}"`,
          checksums: {},
          uploaded: metadata.updated ? new Date(metadata.updated as string) : new Date(),
          httpMetadata: {
            contentType: metadata.contentType,
          },
          customMetadata: (metadata.metadata ?? {}) as Record<string, string>,
          writeHttpMetadata(_headers: Headers) {
            // no-op
          },
        } as unknown as R2Object;
      });

      const truncated = !!(nextQuery && (nextQuery as any).pageToken);
      const cursor = truncated ? (nextQuery as any).pageToken as string : undefined;

      return {
        objects,
        truncated,
        ...(cursor ? { cursor } : {}),
        delimitedPrefixes: ((apiResponse as any)?.prefixes ?? []) as string[],
      };
    },

    // ----- createMultipartUpload -----
    createMultipartUpload(
      _key: string,
      _options?: unknown,
    ): never {
      throw new Error('createMultipartUpload is not supported');
    },
  };

  return store as unknown as R2Bucket;
}
