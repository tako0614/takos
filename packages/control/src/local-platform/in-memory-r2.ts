/**
 * In-memory implementation of Cloudflare R2 (S3-compatible object storage).
 *
 * Used for local development and testing where a real R2 bucket is not
 * available. All stored objects live in memory and are lost when the
 * process exits.
 */

import type {
  R2Bucket,
  R2Object,
  R2ObjectBody,
} from '../shared/types/bindings.ts';

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

function normalizeHttpMetadata(metadata?: Record<string, string> | Headers): Record<string, string> {
  if (!metadata) return {};
  if (metadata instanceof Headers) {
    return Object.fromEntries(metadata.entries());
  }
  return { ...metadata };
}

function createR2Object(
  key: string,
  bytes: ArrayBuffer,
  customMetadata: Record<string, string>,
  httpMetadata: Record<string, string>,
  storageClass = 'Standard',
): R2ObjectBody {
  const blob = new Blob([bytes]);
  const etag = `"${key}-${bytes.byteLength}"`;
  const object = {
    key,
    version: 'local',
    size: bytes.byteLength,
    etag,
    httpEtag: etag,
    uploaded: new Date(),
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

export function createInMemoryR2Bucket(): R2Bucket {
  const objects = new Map<string, {
    bytes: ArrayBuffer;
    customMetadata: Record<string, string>;
    httpMetadata: Record<string, string>;
    storageClass: string;
  }>();
  const multipartUploads = new Map<string, {
    key: string;
    customMetadata: Record<string, string>;
    httpMetadata: Record<string, string>;
    storageClass: string;
    parts: Map<number, { bytes: ArrayBuffer; etag: string }>;
  }>();

  async function toPartEtag(bytes: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `"${hex}"`;
  }

  async function toUploadedBytes(parts: Array<{ partNumber: number; etag: string }>, upload: {
    parts: Map<number, { bytes: ArrayBuffer; etag: string }>;
  }): Promise<ArrayBuffer> {
    const orderedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    const buffers: Uint8Array[] = [];
    const seen = new Set<number>();
    let totalLength = 0;

    for (const part of orderedParts) {
      if (seen.has(part.partNumber)) {
        throw new Error(`Multipart upload has duplicate part ${part.partNumber}`);
      }
      seen.add(part.partNumber);

      const storedPart = upload.parts.get(part.partNumber);
      if (!storedPart) {
        throw new Error(`Multipart upload is missing part ${part.partNumber}`);
      }
      if (storedPart.etag !== part.etag) {
        throw new Error(`Multipart upload part ${part.partNumber} etag mismatch`);
      }
      const bytes = new Uint8Array(storedPart.bytes);
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

  function requireMultipartUpload(uploadId: string, key: string) {
    const upload = multipartUploads.get(uploadId);
    if (!upload) {
      throw new Error(`Multipart upload ${uploadId} is not active`);
    }
    if (upload.key !== key) {
      throw new Error(`Multipart upload ${uploadId} belongs to a different key`);
    }
    return upload;
  }

  const bucket = {
    async head(key: string) {
      const record = objects.get(key);
      if (!record) return null;
      const object = createR2Object(key, record.bytes, record.customMetadata, record.httpMetadata, record.storageClass);
      return {
        ...object,
        body: null,
      } as unknown as R2Object;
    },
    async get(key: string, options?: { range?: { offset?: number; length?: number; suffix?: number } }) {
      const record = objects.get(key);
      if (!record) return null;
      let bytes = record.bytes;
      if (options?.range) {
        const offset = options.range.suffix
          ? Math.max(0, bytes.byteLength - options.range.suffix)
          : options.range.offset ?? 0;
        const end = options.range.length !== undefined
          ? Math.min(bytes.byteLength, offset + options.range.length)
          : bytes.byteLength;
        bytes = bytes.slice(offset, end);
      }
      return createR2Object(key, bytes, record.customMetadata, record.httpMetadata, record.storageClass);
    },
    async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null, options?: { customMetadata?: Record<string, string>; httpMetadata?: Record<string, string>; storageClass?: string }) {
      const bytes = await toBuffer(value);
      objects.set(key, {
        bytes,
        customMetadata: { ...(options?.customMetadata ?? {}) },
        httpMetadata: normalizeHttpMetadata(options?.httpMetadata),
        storageClass: options?.storageClass ?? 'Standard',
      });
      return (await bucket.head(key))!;
    },
    async delete(key: string | string[]) {
      if (Array.isArray(key)) {
        for (const item of key) objects.delete(item);
        return;
      }
      objects.delete(key);
    },
    async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
      const prefix = options?.prefix ?? '';
      const limit = options?.limit ?? 1000;
      const offset = options?.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
      const keys = Array.from(objects.keys())
        .filter((key) => key.startsWith(prefix))
        .sort();
      const page = keys.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      return {
        objects: await Promise.all(page.map(async (key) => (await bucket.head(key))!)),
        truncated: nextOffset < keys.length,
        cursor: nextOffset < keys.length ? String(nextOffset) : undefined,
        delimitedPrefixes: [],
      };
    },
    async createMultipartUpload(key: string, options?: { customMetadata?: Record<string, string>; httpMetadata?: Record<string, string> | Headers; storageClass?: string; ssecKey?: ArrayBuffer | string }) {
      const uploadId = crypto.randomUUID();
      multipartUploads.set(uploadId, {
        key,
        customMetadata: { ...(options?.customMetadata ?? {}) },
        httpMetadata: normalizeHttpMetadata(options?.httpMetadata),
        storageClass: options?.storageClass ?? 'Standard',
        parts: new Map<number, { bytes: ArrayBuffer; etag: string }>(),
      });

      return {
        key,
        uploadId,
        async uploadPart(partNumber: number, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob, _options?: { ssecKey?: ArrayBuffer | string }) {
          const bytes = await toBuffer(value);
          const etag = await toPartEtag(bytes);
          const upload = requireMultipartUpload(uploadId, key);
          upload.parts.set(partNumber, { bytes, etag });
          return { partNumber, etag };
        },
        async abort() {
          const upload = requireMultipartUpload(uploadId, key);
          upload.parts.clear();
          multipartUploads.delete(uploadId);
        },
        async complete(uploadedParts: Array<{ partNumber: number; etag: string }>) {
          const upload = requireMultipartUpload(uploadId, key);
          const bytes = await toUploadedBytes(uploadedParts, upload);
          upload.parts.clear();
          multipartUploads.delete(uploadId);
          return bucket.put(key, bytes, {
            customMetadata: upload.customMetadata,
            httpMetadata: upload.httpMetadata,
            storageClass: upload.storageClass,
          });
        },
      };
    },
    resumeMultipartUpload(key: string, uploadId: string) {
      requireMultipartUpload(uploadId, key);
      return {
        key,
        uploadId,
        async uploadPart(partNumber: number, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob, _options?: { ssecKey?: ArrayBuffer | string }) {
          const bytes = await toBuffer(value);
          const etag = await toPartEtag(bytes);
          const activeUpload = requireMultipartUpload(uploadId, key);
          activeUpload.parts.set(partNumber, { bytes, etag });
          return { partNumber, etag };
        },
        async abort() {
          const activeUpload = requireMultipartUpload(uploadId, key);
          activeUpload.parts.clear();
          multipartUploads.delete(uploadId);
        },
        async complete(uploadedParts: Array<{ partNumber: number; etag: string }>) {
          const activeUpload = requireMultipartUpload(uploadId, key);
          const bytes = await toUploadedBytes(uploadedParts, activeUpload);
          activeUpload.parts.clear();
          multipartUploads.delete(uploadId);
          return bucket.put(key, bytes, {
            customMetadata: activeUpload.customMetadata,
            httpMetadata: activeUpload.httpMetadata,
            storageClass: activeUpload.storageClass,
          });
        },
      };
    },
  };

  return bucket as unknown as R2Bucket;
}
