import { describe, expect, it } from 'vitest';
import { createInMemoryR2Bucket } from '../in-memory-bindings.ts';

describe('createInMemoryR2Bucket multipart upload', () => {
  it('reassembles parts, preserves metadata, and supports resuming', async () => {
    const bucket = createInMemoryR2Bucket();
    const upload = await bucket.createMultipartUpload('docs/report.txt', {
      customMetadata: { owner: 'alice' },
      httpMetadata: new Headers({
        'content-type': 'text/plain',
        'cache-control': 'max-age=60',
      }),
      storageClass: 'InfrequentAccess',
    });

    const resumed = bucket.resumeMultipartUpload('docs/report.txt', upload.uploadId);
    const firstPart = await upload.uploadPart(1, 'hello ');
    const secondPart = await resumed.uploadPart(2, new Uint8Array([119, 111, 114, 108, 100]));

    const completed = await resumed.complete([secondPart, firstPart]);
    expect(completed.key).toBe('docs/report.txt');

    const head = await bucket.head('docs/report.txt');
    expect(head).not.toBeNull();
    expect(head).toMatchObject({
      customMetadata: { owner: 'alice' },
      httpMetadata: {
        'cache-control': 'max-age=60',
        'content-type': 'text/plain',
      },
      storageClass: 'InfrequentAccess',
    });

    const stored = await bucket.get('docs/report.txt');
    expect(await stored?.text()).toBe('hello world');
  });

  it('aborts multipart uploads and prevents completion', async () => {
    const bucket = createInMemoryR2Bucket();
    const upload = await bucket.createMultipartUpload('docs/aborted.txt');

    const part = await upload.uploadPart(1, 'discard me');
    await upload.abort();

    expect(() => bucket.resumeMultipartUpload('docs/aborted.txt', upload.uploadId)).toThrow(/not active/i);
    await expect(upload.complete([part])).rejects.toThrow(/not active/i);
    await expect(bucket.head('docs/aborted.txt')).resolves.toBeNull();
  });
});
