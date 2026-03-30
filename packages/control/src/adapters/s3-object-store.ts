import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type HeadObjectCommandOutput,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import type {
  R2Bucket,
  R2Object,
  R2ObjectBody,
} from '../shared/types/bindings.ts';
import type { R2Objects } from './r2-compat-types.ts';
import {
  toR2Object as toR2ObjectShared,
  toR2ObjectBody as toR2ObjectBodyShared,
  normaliseBody,
  type R2ObjectMeta,
} from './r2-adapter-shared.ts';

// ---------------------------------------------------------------------------
// Local type helpers – avoid adding @smithy/types or @cloudflare/workers-types
// as direct dependencies just for these interfaces.
// ---------------------------------------------------------------------------

/** Subset of @smithy/types SdkStreamMixin present on AWS SDK v3 response bodies. */
interface SdkStreamLike {
  transformToByteArray: () => Promise<Uint8Array>;
  transformToWebStream: () => ReadableStream;
}

/** AWS SDK error shape with metadata. */
interface AwsSdkError extends Error {
  name: string;
  $metadata?: { httpStatusCode?: number };
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
 * Map an S3 head / get response to provider-neutral metadata, then build R2Object.
 */
function s3ToR2Object(
  key: string,
  output: HeadObjectCommandOutput | GetObjectCommandOutput,
  range?: { offset: number; length: number },
): R2Object {
  const etag = (output.ETag ?? '').replace(/"/g, '');
  const meta: R2ObjectMeta = {
    key,
    etag,
    httpEtag: output.ETag ?? `"${etag}"`,
    size: output.ContentLength ?? 0,
    version: etag,
    uploaded: output.LastModified ?? new Date(),
    contentType: output.ContentType,
    customMetadata: (output.Metadata ?? {}) as Record<string, string>,
    range,
  };
  return toR2ObjectShared(meta);
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
  const sdkBody = body as Partial<SdkStreamLike>;
  if (typeof sdkBody.transformToByteArray === 'function') {
    const bytes: Uint8Array = await sdkBody.transformToByteArray();
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
async function s3ToR2ObjectBody(
  key: string,
  output: GetObjectCommandOutput,
  range?: { offset: number; length: number },
): Promise<R2ObjectBody> {
  const base = s3ToR2Object(key, output, range);
  const bytes = await consumeBody(output.Body);
  return toR2ObjectBodyShared(base, bytes);
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
        return s3ToR2Object(key, output);
      } catch (err: unknown) {
        const sdkErr = err as Partial<AwsSdkError>;
        if (sdkErr.name === 'NotFound' || sdkErr.$metadata?.httpStatusCode === 404) {
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

        return s3ToR2ObjectBody(key, output, rangeInfo);
      } catch (err: unknown) {
        const sdkErr = err as Partial<AwsSdkError>;
        if (
          sdkErr.name === 'NoSuchKey' ||
          sdkErr.$metadata?.httpStatusCode === 404
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
        return toR2ObjectShared({
          key: item.Key ?? '',
          etag,
          httpEtag: item.ETag ?? `"${etag}"`,
          size: item.Size ?? 0,
          version: etag,
          uploaded: item.LastModified ?? new Date(),
          customMetadata: {} as Record<string, string>,
        });
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
    async createMultipartUpload(
      key: string,
      options?: {
        customMetadata?: Record<string, string>;
        httpMetadata?: { contentType?: string; [k: string]: unknown } | Headers;
      },
    ) {
      const contentType =
        options?.httpMetadata instanceof Headers
          ? options.httpMetadata.get('content-type') ?? undefined
          : options?.httpMetadata?.contentType;

      const output = await getClient().send(
        new CreateMultipartUploadCommand({
          Bucket: config.bucket,
          Key: key,
          ...(contentType ? { ContentType: contentType } : {}),
          ...(options?.customMetadata
            ? { Metadata: options.customMetadata }
            : {}),
        }),
      );

      const uploadId = output.UploadId;
      if (!uploadId) {
        throw new Error('S3 CreateMultipartUpload did not return an UploadId');
      }

      return {
        key,
        uploadId,

        async uploadPart(
          partNumber: number,
          value: ReadableStream | ArrayBuffer | string,
        ): Promise<{ partNumber: number; etag: string }> {
          const body = await normaliseBody(value);
          const partOutput = await getClient().send(
            new UploadPartCommand({
              Bucket: config.bucket,
              Key: key,
              UploadId: uploadId,
              PartNumber: partNumber,
              Body: body,
            }),
          );

          const etag = (partOutput.ETag ?? '').replace(/"/g, '');
          if (!etag) {
            throw new Error(
              `S3 UploadPart did not return an ETag for part ${partNumber}`,
            );
          }

          return { partNumber, etag };
        },

        async complete(
          parts: Array<{ partNumber: number; etag: string }>,
        ): Promise<R2Object> {
          await getClient().send(
            new CompleteMultipartUploadCommand({
              Bucket: config.bucket,
              Key: key,
              UploadId: uploadId,
              MultipartUpload: {
                Parts: parts.map((p) => ({
                  PartNumber: p.partNumber,
                  ETag: `"${p.etag}"`,
                })),
              },
            }),
          );

          // Return the final object metadata via head
          const obj = await store.head(key);
          if (!obj) {
            throw new Error(
              `Object ${key} not found after completing multipart upload`,
            );
          }
          return obj;
        },

        async abort(): Promise<void> {
          await getClient().send(
            new AbortMultipartUploadCommand({
              Bucket: config.bucket,
              Key: key,
              UploadId: uploadId,
            }),
          );
        },
      };
    },
  };

  return store as unknown as R2Bucket;
}
