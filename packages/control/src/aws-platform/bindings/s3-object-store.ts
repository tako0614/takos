import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  type HeadObjectCommandOutput,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
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

export type S3ObjectStoreConfig = {
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lazyClient(config: S3ObjectStoreConfig): () => S3Client {
  let client: S3Client | undefined;
  return () => {
    if (!client) {
      client = new S3Client({
        region: config.region,
        ...(config.endpoint ? { endpoint: config.endpoint } : {}),
        ...(config.accessKeyId && config.secretAccessKey
          ? {
              credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
              },
            }
          : {}),
      });
    }
    return client;
  };
}

/**
 * Build the common R2Object-shaped metadata from an S3 head / get response.
 */
function toR2Object(
  key: string,
  output: HeadObjectCommandOutput | GetObjectCommandOutput,
  range?: { offset: number; length: number },
): R2Object {
  const etag = (output.ETag ?? '').replace(/"/g, '');
  const size = output.ContentLength ?? 0;

  const obj: R2Object = {
    key,
    version: etag,
    size,
    etag,
    httpEtag: output.ETag ?? `"${etag}"`,
    checksums: {} as any,
    uploaded: output.LastModified ?? new Date(),
    httpMetadata: {
      contentType: output.ContentType,
    } as any,
    customMetadata: (output.Metadata ?? {}) as Record<string, string>,
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
 * Consume an S3 body (a Readable / ReadableStream / Blob / string) and return
 * its contents as an ArrayBuffer.
 */
async function consumeBody(
  body: GetObjectCommandOutput['Body'],
): Promise<ArrayBuffer> {
  if (!body) return new ArrayBuffer(0);

  // The AWS SDK v3 body is a Readable (Node) or ReadableStream (browser).
  // transformToByteArray() is available on the SdkStream wrapper.
  if (typeof (body as any).transformToByteArray === 'function') {
    const bytes: Uint8Array = await (body as any).transformToByteArray();
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  }

  // Fallback: try to collect from an async iterable (Node stream).
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged.buffer;
}

/**
 * Wrap an S3 GetObjectCommand output as an R2ObjectBody.
 */
function toR2ObjectBody(
  key: string,
  output: GetObjectCommandOutput,
  range?: { offset: number; length: number },
): R2ObjectBody {
  const base = toR2Object(key, output, range);

  let bodyUsed = false;
  let buffered: ArrayBuffer | undefined;

  async function getBuffer(): Promise<ArrayBuffer> {
    if (bodyUsed && buffered === undefined) {
      throw new Error('Body has already been consumed');
    }
    if (buffered !== undefined) return buffered;
    bodyUsed = true;
    buffered = await consumeBody(output.Body);
    return buffered;
  }

  // Build a ReadableStream from the S3 body if one is available.
  let bodyStream: ReadableStream<Uint8Array>;
  const rawBody = output.Body;
  if (rawBody && typeof (rawBody as any).transformToWebStream === 'function') {
    bodyStream = (rawBody as any).transformToWebStream() as ReadableStream<Uint8Array>;
  } else {
    // Fallback: wrap into a ReadableStream that pulls from getBuffer().
    bodyStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const ab = await getBuffer();
        controller.enqueue(new Uint8Array(ab));
        controller.close();
      },
    });
  }

  const objectBody: R2ObjectBody = {
    ...base,
    body: bodyStream,
    get bodyUsed() {
      return bodyUsed;
    },
    async arrayBuffer() {
      return getBuffer();
    },
    async text() {
      const ab = await getBuffer();
      return new TextDecoder().decode(ab);
    },
    async json<T = unknown>(): Promise<T> {
      const t = await objectBody.text();
      return JSON.parse(t) as T;
    },
    async blob() {
      const ab = await getBuffer();
      const ct =
        (base as any).httpMetadata?.contentType ?? 'application/octet-stream';
      return new Blob([ab], { type: ct });
    },
    writeHttpMetadata(_headers: Headers) {
      // no-op
    },
  } as unknown as R2ObjectBody;

  return objectBody;
}

/**
 * Build a Range header string from R2-style range options.
 */
function buildRangeHeader(
  range: { offset?: number; length?: number; suffix?: number },
): string | undefined {
  if (range.suffix !== undefined) {
    return `bytes=-${range.suffix}`;
  }
  const start = range.offset ?? 0;
  if (range.length !== undefined) {
    return `bytes=${start}-${start + range.length - 1}`;
  }
  return `bytes=${start}-`;
}

/**
 * Normalise the value passed to put() into a format that S3 PutObjectCommand
 * can accept (Buffer | Uint8Array | string | ReadableStream).
 */
async function normaliseBody(
  value: ReadableStream | ArrayBuffer | string | null | Blob,
): Promise<Buffer | Uint8Array | string | undefined> {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (value instanceof Uint8Array) return value;
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

export function createS3ObjectStore(config: S3ObjectStoreConfig): R2Bucket {
  const getClient = lazyClient(config);

  const store = {
    // ----- head -----
    async head(key: string): Promise<R2Object | null> {
      try {
        const output = await getClient().send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        );
        return toR2Object(key, output);
      } catch (err: any) {
        if (err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404) {
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
        const rangeHeader =
          options?.range ? buildRangeHeader(options.range) : undefined;

        const output = await getClient().send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: key,
            ...(rangeHeader ? { Range: rangeHeader } : {}),
          }),
        );

        let rangeInfo: { offset: number; length: number } | undefined;
        if (options?.range) {
          const offset = options.range.offset ?? 0;
          const length =
            options.range.length ?? (output.ContentLength ?? 0);
          rangeInfo = { offset, length };
        }

        return toR2ObjectBody(key, output, rangeInfo);
      } catch (err: any) {
        if (
          err?.name === 'NoSuchKey' ||
          err?.$metadata?.httpStatusCode === 404
        ) {
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

      await getClient().send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ...(options?.httpMetadata?.contentType
            ? { ContentType: options.httpMetadata.contentType as string }
            : {}),
          ...(options?.customMetadata
            ? { Metadata: options.customMetadata }
            : {}),
        }),
      );

      // S3 PutObject doesn't return full metadata, so issue a head to return
      // the canonical R2Object shape.
      return store.head(key);
    },

    // ----- delete -----
    async delete(keys: string | string[]): Promise<void> {
      if (typeof keys === 'string') {
        await getClient().send(
          new DeleteObjectCommand({ Bucket: config.bucket, Key: keys }),
        );
        return;
      }

      if (keys.length === 0) return;

      // S3 DeleteObjects supports up to 1 000 keys per call.
      const BATCH = 1000;
      for (let i = 0; i < keys.length; i += BATCH) {
        const batch = keys.slice(i, i + BATCH);
        await getClient().send(
          new DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: {
              Objects: batch.map((k) => ({ Key: k })),
              Quiet: true,
            },
          }),
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
      const output = await getClient().send(
        new ListObjectsV2Command({
          Bucket: config.bucket,
          ...(options?.prefix ? { Prefix: options.prefix } : {}),
          ...(options?.limit ? { MaxKeys: options.limit } : {}),
          ...(options?.cursor
            ? { ContinuationToken: options.cursor }
            : {}),
          ...(options?.delimiter ? { Delimiter: options.delimiter } : {}),
        }),
      );

      const objects: R2Object[] = (output.Contents ?? []).map((item) => {
        const etag = (item.ETag ?? '').replace(/"/g, '');
        return {
          key: item.Key ?? '',
          version: etag,
          size: item.Size ?? 0,
          etag,
          httpEtag: item.ETag ?? `"${etag}"`,
          checksums: {},
          uploaded: item.LastModified ?? new Date(),
          httpMetadata: {},
          customMetadata: {},
          writeHttpMetadata(_headers: Headers) {
            // no-op
          },
        } as unknown as R2Object;
      });

      const truncated = output.IsTruncated ?? false;

      return {
        objects,
        truncated,
        ...(truncated && output.NextContinuationToken
          ? { cursor: output.NextContinuationToken }
          : {}),
        delimitedPrefixes: (output.CommonPrefixes ?? [])
          .map((p) => p.Prefix ?? '')
          .filter(Boolean),
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
