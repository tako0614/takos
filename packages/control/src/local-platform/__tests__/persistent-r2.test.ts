import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { createPersistentR2Bucket } from '../persistent-r2.ts';
import { removeLocalDataDir } from '../persistent-shared.ts';

const tempDirs: string[] = [];

async function createBucketFile(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'takos-persistent-r2-'));
  tempDirs.push(tempDir);
  return path.join(tempDir, 'bucket.json');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeLocalDataDir(dir)));
});

describe('createPersistentR2Bucket multipart upload', () => {
  it('reassembles parts, preserves metadata, and supports resuming across adapter reloads', async () => {
    const filePath = await createBucketFile();
    const firstBucket = createPersistentR2Bucket(filePath);
    const upload = await firstBucket.createMultipartUpload('docs/report.txt', {
      customMetadata: { owner: 'alice' },
      httpMetadata: new Headers({
        'content-type': 'text/plain',
        'cache-control': 'max-age=60',
      }),
      storageClass: 'InfrequentAccess',
    });

    const firstPart = await upload.uploadPart(1, 'hello ');

    const secondBucket = createPersistentR2Bucket(filePath);
    const resumed = secondBucket.resumeMultipartUpload('docs/report.txt', upload.uploadId);
    const secondPart = await resumed.uploadPart(2, new Uint8Array([119, 111, 114, 108, 100]));

    const completed = await resumed.complete([secondPart, firstPart]);
    expect(completed.key).toBe('docs/report.txt');

    const reloadedBucket = createPersistentR2Bucket(filePath);
    const head = await reloadedBucket.head('docs/report.txt');
    expect(head).not.toBeNull();
    expect(head).toMatchObject({
      customMetadata: { owner: 'alice' },
      httpMetadata: {
        'cache-control': 'max-age=60',
        'content-type': 'text/plain',
      },
      storageClass: 'InfrequentAccess',
    });

    const stored = await reloadedBucket.get('docs/report.txt');
    expect(await stored?.text()).toBe('hello world');
  });

  it('aborts multipart uploads and prevents later part uploads after adapter reload', async () => {
    const filePath = await createBucketFile();
    const firstBucket = createPersistentR2Bucket(filePath);
    const upload = await firstBucket.createMultipartUpload('docs/aborted.txt');

    await upload.uploadPart(1, 'discard me');
    await upload.abort();

    const reloadedBucket = createPersistentR2Bucket(filePath);
    const resumed = reloadedBucket.resumeMultipartUpload('docs/aborted.txt', upload.uploadId);

    await expect(resumed.uploadPart(1, 'discard me')).rejects.toThrow(/not active/i);
    await expect(reloadedBucket.head('docs/aborted.txt')).resolves.toBeNull();
  });
});
