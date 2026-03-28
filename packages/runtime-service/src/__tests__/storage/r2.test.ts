import * as fs from 'fs/promises';
import * as os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/config.js', () => ({
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET: 'test-bucket',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret',
  S3_BUCKET: 'test-bucket',
  MAX_R2_DOWNLOAD_FILE_BYTES: 1024 * 1024,
  MAX_R2_DOWNLOAD_TOTAL_BYTES: 1024 * 1024 * 4,
  MAX_LOG_LINES: 100_000,
}));

import { downloadSpaceFiles, uploadSpaceFiles, s3Client } from '../../storage/r2.js';

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('r2 symlink boundary hardening', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips upload paths that symlink outside base directory', async () => {
    const workspaceDir = await createTempDir('takos-r2-upload-ws-');
    const outsideDir = await createTempDir('takos-r2-upload-outside-');
    const outsideFile = path.join(outsideDir, 'outside.txt');
    const symlinkPath = path.join(workspaceDir, 'escape.txt');

    try {
      await fs.writeFile(outsideFile, 'outside');
      await fs.symlink(outsideFile, symlinkPath);

      const sendSpy = vi.spyOn(s3Client, 'send');
      const logs: string[] = [];

      const uploaded = await uploadSpaceFiles('ws-upload', workspaceDir, ['escape.txt'], logs);

      expect(uploaded).toBe(0);
      expect(sendSpy).not.toHaveBeenCalled();
      expect(logs.some((line) => line.includes('symlink escape attempt'))).toBe(true);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('skips download paths that traverse through escaping symlink components', async () => {
    const workspaceDir = await createTempDir('takos-r2-download-ws-');
    const outsideDir = await createTempDir('takos-r2-download-outside-');
    const escapeLink = path.join(workspaceDir, 'escape-dir');

    try {
      await fs.symlink(outsideDir, escapeLink);

      vi.spyOn(s3Client, 'send').mockImplementation(async (command: object) => {
        const commandName = (command as { constructor?: { name?: string } }).constructor?.name;

        if (commandName === 'ListObjectsV2Command') {
          return {
            Contents: [
              {
                Key: 'workspaces/ws-download/files/object-1',
                Size: 5,
              },
            ],
            NextContinuationToken: undefined,
          };
        }

        if (commandName === 'GetObjectCommand') {
          return {
            Body: {
              transformToByteArray: async () => Buffer.from('hello'),
            },
            Metadata: {
              'file-path': 'escape-dir/evil.txt',
            },
          };
        }

        throw new Error(`Unexpected command: ${commandName}`);
      });

      const logs: string[] = [];
      const downloaded = await downloadSpaceFiles('ws-download', workspaceDir, logs);
      const outsideFile = path.join(outsideDir, 'evil.txt');
      const outsideFileExists = await fs.stat(outsideFile).then(() => true).catch(() => false);

      expect(downloaded).toBe(0);
      expect(outsideFileExists).toBe(false);
      expect(logs.some((line) => line.includes('symlink escape attempt'))).toBe(true);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });
});
