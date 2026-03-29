/**
 * File-backed persistent implementation of Cloudflare R2 (S3-compatible object storage).
 *
 * Stores bucket contents as base64-encoded JSON on disk so that objects
 * survive process restarts. Intended for local development and testing
 * where a real R2 bucket is not available.
 */

import { createHash } from 'node:crypto';
import type { R2Bucket, R2Object, R2ObjectBody } from '../shared/types/bindings.ts';
import { readJsonFile, writeJsonFile } from './persistent-shared.ts';

type BucketRecord = {
  key: string;
  bodyBase64: string;
  uploadedAt: string;
  customMetadata: Record<string, string>;
  httpMetadata: Record<string, string>;
  storageClass: string;
};

type MultipartPartRecord = {
  bodyBase64: string;
  etag: string;
};

type MultipartUploadRecord = {
  key: string;
  customMetadata: Record<string, string>;
  httpMetadata: Record<string, string>;
  storageClass: string;
  parts: Record<string, MultipartPartRecord>;
};

type BucketState = {
  objects: Record<string, BucketRecord>;
  uploads: Record<string, MultipartUploadRecord>;
};

type LegacyBucketState = Record<string, Omit<BucketRecord, 'storageClass'> & { storageClass?: string }>;

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function encodeBase64(bytes: ArrayBuffer): string {
  return Buffer.from(bytes).toString('base64');
}

function decodeBase64(value: string): ArrayBuffer {
  const buffer = Buffer.from(value, 'base64');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function normalizeHttpMetadata(metadata?: Record<string, string> | Headers): Record<string, string> {
  if (!metadata) return {};
  if (metadata instanceof Headers) {
    return Object.fromEntries(metadata.entries());
  }
  return { ...metadata };
}

function normalizeBucketState(raw: BucketState | LegacyBucketState): BucketState {
  if ('objects' in raw && 'uploads' in raw) {
    return {
      objects: Object.fromEntries(
        Object.entries(raw.objects).map(([key, record]) => [
          key,
          {
            ...record,
            storageClass: record.storageClass ?? 'Standard',
          },
        ]),
      ),
      uploads: raw.uploads ?? {},
    };
  }

  return {
    objects: Object.fromEntries(
      Object.entries(raw).map(([key, record]) => [
        key,
        {
          ...record,
          storageClass: record.storageClass ?? 'Standard',
        },
      ]),
    ),
    uploads: {},
  };
}

function toPartEtag(bytes: ArrayBuffer): string {
  const digest = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  return `"${digest}"`;
}

async function toBuffer(
  value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
): Promise<ArrayBuffer> {
  if (value === null) return new ArrayBuffer(0);
  if (typeof value === 'string') return new TextEncoder().encode(value).buffer;
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  }
  if (value instanceof Blob) return value.arrayBuffer();
  return new Response(value).arrayBuffer();
}

function createR2Object(
  key: string,
  bytes: ArrayBuffer,
  customMetadata: Record<string, string>,
  httpMetadata: Record<string, string>,
  uploadedAt: string,
  storageClass = 'Standard',
): R2ObjectBody {
  const blob = new Blob([bytes]);
  const etag = `"${hashKey(key)}-${bytes.byteLength}"`;
  const uploaded = new Date(uploadedAt);
  const object = {
    key,
    version: 'local',
    size: bytes.byteLength,
    etag,
    httpEtag: etag,
    uploaded,
    checksums: { toJSON: () => ({}) },
    httpMetadata,
    customMetadata,
    storageClass,
    range: undefined,
    body: blob.stream(),
    bodyUsed: false,
    async arrayBuffer() {
      return bytes.slice(0);
    },
    async bytes() {
      return new Uint8Array(bytes.slice(0));
    },
    async text() {
      return new TextDecoder().decode(bytes);
    },
    async json<T>() {
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
    },
    async blob() {
      return blob;
    },
    writeHttpMetadata(headers: Headers) {
      for (const [name, value] of Object.entries(httpMetadata)) {
        headers.set(name, value);
      }
    },
  };

  return object as unknown as R2ObjectBody;
}

function requireMultipartUpload(state: BucketState, uploadId: string, key: string): MultipartUploadRecord {
  const upload = state.uploads[uploadId];
  if (!upload) {
    throw new Error(`Multipart upload ${uploadId} is not active`);
  }
  if (upload.key !== key) {
    throw new Error(`Multipart upload ${uploadId} belongs to a different key`);
  }
  return upload;
}

function toUploadedBytes(
  parts: Array<{ partNumber: number; etag: string }>,
  upload: MultipartUploadRecord,
): ArrayBuffer {
  const orderedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  const buffers: Uint8Array[] = [];
  const seen = new Set<number>();
  let totalLength = 0;

  for (const part of orderedParts) {
    if (seen.has(part.partNumber)) {
      throw new Error(`Multipart upload has duplicate part ${part.partNumber}`);
    }
    seen.add(part.partNumber);

    const storedPart = upload.parts[String(part.partNumber)];
    if (!storedPart) {
      throw new Error(`Multipart upload is missing part ${part.partNumber}`);
    }
    if (storedPart.etag !== part.etag) {
      throw new Error(`Multipart upload part ${part.partNumber} etag mismatch`);
    }

    const bytes = new Uint8Array(decodeBase64(storedPart.bodyBase64));
    buffers.push(bytes);
    totalLength += bytes.byteLength;
  }

  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const buffer of buffers) {
    merged.set(buffer, offset);
    offset += buffer.byteLength;
  }

  return merged.buffer;
}

export function createPersistentR2Bucket(filePath: string): R2Bucket {
  let cache: BucketState | null = null;

  async function loadState(): Promise<BucketState> {
    if (cache) return cache;
    const raw = await readJsonFile<BucketState | LegacyBucketState>(filePath, { objects: {}, uploads: {} });
    cache = normalizeBucketState(raw);
    return cache;
  }

  async function flushState(): Promise<void> {
    if (!cache) return;
    await writeJsonFile(filePath, cache);
  }

  async function putObject(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: { customMetadata?: Record<string, string>; httpMetadata?: Record<string, string> | Headers; storageClass?: string },
  ) {
    const state = await loadState();
    const bytes = await toBuffer(value);
    state.objects[key] = {
      key,
      bodyBase64: encodeBase64(bytes),
      uploadedAt: new Date().toISOString(),
      customMetadata: { ...(options?.customMetadata ?? {}) },
      httpMetadata: normalizeHttpMetadata(options?.httpMetadata),
      storageClass: options?.storageClass ?? 'Standard',
    };
    await flushState();
    return (await bucket.head(key))!;
  }

  function createMultipartUploadHandle(key: string, uploadId: string) {
    return {
      key,
      uploadId,
      async uploadPart(
        partNumber: number,
        value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
        _options?: { ssecKey?: ArrayBuffer | string },
      ) {
        const state = await loadState();
        const bytes = await toBuffer(value);
        const upload = requireMultipartUpload(state, uploadId, key);
        const etag = toPartEtag(bytes);
        upload.parts[String(partNumber)] = {
          bodyBase64: encodeBase64(bytes),
          etag,
        };
        await flushState();
        return { partNumber, etag };
      },
      async abort() {
        const state = await loadState();
        requireMultipartUpload(state, uploadId, key);
        delete state.uploads[uploadId];
        await flushState();
      },
      async complete(uploadedParts: Array<{ partNumber: number; etag: string }>) {
        const state = await loadState();
        const upload = requireMultipartUpload(state, uploadId, key);
        const bytes = toUploadedBytes(uploadedParts, upload);
        delete state.uploads[uploadId];
        await flushState();
        return putObject(key, bytes, {
          customMetadata: upload.customMetadata,
          httpMetadata: upload.httpMetadata,
          storageClass: upload.storageClass,
        });
      },
    };
  }

  const bucket = {
    async head(key: string) {
      const state = await loadState();
      const record = state.objects[key];
      if (!record) return null;
      const object = createR2Object(
        record.key,
        decodeBase64(record.bodyBase64),
        record.customMetadata,
        record.httpMetadata,
        record.uploadedAt,
        record.storageClass,
      );
      return {
        ...object,
        body: null,
      } as unknown as R2Object;
    },
    async get(key: string, options?: { range?: { offset?: number; length?: number; suffix?: number } }) {
      const state = await loadState();
      const record = state.objects[key];
      if (!record) return null;

      let bytes = decodeBase64(record.bodyBase64);
      if (options?.range) {
        const offset = options.range.suffix
          ? Math.max(0, bytes.byteLength - options.range.suffix)
          : options.range.offset ?? 0;
        const end = options.range.length !== undefined
          ? Math.min(bytes.byteLength, offset + options.range.length)
          : bytes.byteLength;
        bytes = bytes.slice(offset, end);
      }

      return createR2Object(
        record.key,
        bytes,
        record.customMetadata,
        record.httpMetadata,
        record.uploadedAt,
        record.storageClass,
      );
    },
    async put(
      key: string,
      value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
      options?: { customMetadata?: Record<string, string>; httpMetadata?: Record<string, string> | Headers; storageClass?: string },
    ) {
      return putObject(key, value, options);
    },
    async delete(key: string | string[]) {
      const state = await loadState();
      const keys = Array.isArray(key) ? key : [key];
      for (const item of keys) delete state.objects[item];
      await flushState();
    },
    async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
      const state = await loadState();
      const prefix = options?.prefix ?? '';
      const limit = options?.limit ?? 1000;
      const offset = options?.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
      const keys = Object.keys(state.objects)
        .filter((key) => key.startsWith(prefix))
        .sort((a, b) => a.localeCompare(b));
      const page = keys.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      return {
        objects: await Promise.all(page.map(async (key) => (await bucket.head(key))!)),
        truncated: nextOffset < keys.length,
        cursor: nextOffset < keys.length ? String(nextOffset) : undefined,
        delimitedPrefixes: [],
      };
    },
    async createMultipartUpload(
      key: string,
      options?: { customMetadata?: Record<string, string>; httpMetadata?: Record<string, string> | Headers; storageClass?: string; ssecKey?: ArrayBuffer | string },
    ) {
      const state = await loadState();
      const uploadId = crypto.randomUUID();
      state.uploads[uploadId] = {
        key,
        customMetadata: { ...(options?.customMetadata ?? {}) },
        httpMetadata: normalizeHttpMetadata(options?.httpMetadata),
        storageClass: options?.storageClass ?? 'Standard',
        parts: {},
      };
      await flushState();
      return createMultipartUploadHandle(key, uploadId);
    },
    resumeMultipartUpload(key: string, uploadId: string) {
      const state = cache ?? { objects: {}, uploads: {} };
      if (cache) {
        requireMultipartUpload(state, uploadId, key);
      }
      return createMultipartUploadHandle(key, uploadId);
    },
  };

  return bucket as unknown as R2Bucket;
}
