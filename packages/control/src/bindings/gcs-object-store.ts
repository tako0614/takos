import { Storage } from '@google-cloud/storage';
import type { FileMetadata, GetFilesOptions } from '@google-cloud/storage';
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
// Cloudflare R2 sub-types (not re-exported from bindings, defined locally)
// ---------------------------------------------------------------------------

/** Matches the Cloudflare R2Checksums interface for GCS interop. */
interface R2ChecksumsLike {
  readonly md5?: ArrayBuffer;
  readonly sha1?: ArrayBuffer;
  readonly sha256?: ArrayBuffer;
  readonly sha384?: ArrayBuffer;
  readonly sha512?: ArrayBuffer;
  toJSON(): Record<string, string | undefined>;
}

/** Matches the Cloudflare R2HTTPMetadata interface for GCS interop. */
interface R2HTTPMetadataLike {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}

/** Matches the Cloudflare R2Range type for GCS interop. */
interface R2RangeLike {
  offset: number;
  length?: number;
}

/** Build an empty R2Checksums-compatible object. */
function emptyChecksums(): R2ChecksumsLike {
  return {
    toJSON() {
      return {};
    },
  };
}

/** Type guard for GCS SDK errors that carry a numeric `code` property. */
function isGcsError(err: unknown): err is Error & { code: number } {
  return err instanceof Error && typeof (err as unknown as Record<string, unknown>).code === 'number';
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
  metadata: FileMetadata,
  range?: R2RangeLike,
): R2Object {
  const rawEtag = typeof metadata.etag === 'string' ? metadata.etag : '';
  const etag = rawEtag.replace(/"/g, '');
  const size = typeof metadata.size === 'string'
    ? Number.parseInt(metadata.size, 10)
    : typeof metadata.size === 'number'
      ? metadata.size
      : 0;

  const httpMetadata: R2HTTPMetadataLike = {
    contentType: typeof metadata.contentType === 'string' ? metadata.contentType : undefined,
  };

  const generation = typeof metadata.generation === 'string'
    ? metadata.generation
    : typeof metadata.generation === 'number'
      ? String(metadata.generation)
      : undefined;

  return {
    key,
    version: etag || generation || 'unknown',
    size,
    etag,
    httpEtag: rawEtag || `"${etag}"`,
    checksums: emptyChecksums(),
    uploaded: metadata.updated ? new Date(metadata.updated) : new Date(),
    httpMetadata,
    customMetadata: (metadata.metadata ?? {}) as Record<string, string>,
    ...(range ? { range } : {}),
    writeHttpMetadata(_headers: Headers) {
      // no-op – Cloudflare-specific helper
    },
  } as unknown as R2Object;
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
  metadata: FileMetadata,
  range?: R2RangeLike,
): R2ObjectBody {
  const base = toR2Object(key, metadata, range);
  const contentType =
    (base as unknown as { httpMetadata?: R2HTTPMetadataLike }).httpMetadata?.contentType
    ?? 'application/octet-stream';

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
      return new Blob([bytes], { type: contentType });
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
        return toR2Object(key, metadata);
      } catch (err: unknown) {
        if (isGcsError(err) && err.code === 404) {
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
            const [sizeMeta] = await file.getMetadata();
            const fileSize = typeof sizeMeta.size === 'string'
              ? Number.parseInt(sizeMeta.size, 10)
              : typeof sizeMeta.size === 'number'
                ? sizeMeta.size
                : 0;
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

        let rangeInfo: R2RangeLike | undefined;
        if (options?.range) {
          const offset = options.range.offset ?? 0;
          const length = options.range.length ?? buffer.length;
          rangeInfo = { offset, length };
        }

        return toR2ObjectBody(key, buffer, metadata, rangeInfo);
      } catch (err: unknown) {
        if (isGcsError(err) && err.code === 404) {
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
        } catch (err: unknown) {
          // Ignore 404 on delete (matches S3/R2 behavior)
          if (!isGcsError(err) || err.code !== 404) throw err;
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
            getBucket().file(k).delete().catch((err: unknown) => {
              if (!isGcsError(err) || err.code !== 404) throw err;
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
      const queryOptions: GetFilesOptions & { autoPaginate: boolean } = {
        autoPaginate: false,
        ...(options?.prefix ? { prefix: options.prefix } : {}),
        ...(options?.limit ? { maxResults: options.limit } : {}),
        ...(options?.cursor ? { pageToken: options.cursor } : {}),
        ...(options?.delimiter ? { delimiter: options.delimiter } : {}),
      };

      const [files, nextQuery, apiResponse] = await getBucket().getFiles(queryOptions);

      const objects: R2Object[] = files.map((file) =>
        toR2Object(file.name, file.metadata),
      );

      const nextPageToken = (nextQuery as Partial<Pick<GetFilesOptions, 'pageToken'>> | undefined)?.pageToken;
      const truncated = !!nextPageToken;
      const cursor = truncated ? nextPageToken : undefined;

      const apiPrefixes = (apiResponse as { prefixes?: string[] } | undefined)?.prefixes ?? [];

      return {
        objects,
        truncated,
        ...(cursor ? { cursor } : {}),
        delimitedPrefixes: apiPrefixes,
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
