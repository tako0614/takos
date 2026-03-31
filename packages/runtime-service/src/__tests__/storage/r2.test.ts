import * as fs from 'fs/promises';
import * as os from 'os';
import path from 'path';
// [Deno] vi.mock removed - manually stub imports from '../../shared/config.ts'
import { downloadSpaceFiles, uploadSpaceFiles, s3Client } from '../../storage/r2.ts';

import { assertEquals } from 'jsr:@std/assert';
import { stub, assertSpyCalls } from 'jsr:@std/testing/mock';

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}


  Deno.test('r2 symlink boundary hardening - skips upload paths that symlink outside base directory', async () => {
  try {
  const workspaceDir = await createTempDir('takos-r2-upload-ws-');
    const outsideDir = await createTempDir('takos-r2-upload-outside-');
    const outsideFile = path.join(outsideDir, 'outside.txt');
    const symlinkPath = path.join(workspaceDir, 'escape.txt');

    try {
      await fs.writeFile(outsideFile, 'outside');
      await fs.symlink(outsideFile, symlinkPath);

      const sendSpy = stub(s3Client, 'send');
      const logs: string[] = [];

      const uploaded = await uploadSpaceFiles('ws-upload', workspaceDir, ['escape.txt'], logs);

      assertEquals(uploaded, 0);
      assertSpyCalls(sendSpy, 0);
      assertEquals(logs.some((line) => line.includes('symlink escape attempt')), true);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  } finally {
  /* TODO: restore mocks manually */ void 0;
  }
})
  Deno.test('r2 symlink boundary hardening - skips download paths that traverse through escaping symlink components', async () => {
  try {
  const workspaceDir = await createTempDir('takos-r2-download-ws-');
    const outsideDir = await createTempDir('takos-r2-download-outside-');
    const escapeLink = path.join(workspaceDir, 'escape-dir');

    try {
      await fs.symlink(outsideDir, escapeLink);

      stub(s3Client, 'send') = async (command: object) => {
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
      } as any;

      const logs: string[] = [];
      const downloaded = await downloadSpaceFiles('ws-download', workspaceDir, logs);
      const outsideFile = path.join(outsideDir, 'evil.txt');
      const outsideFileExists = await fs.stat(outsideFile).then(() => true).catch(() => false);

      assertEquals(downloaded, 0);
      assertEquals(outsideFileExists, false);
      assertEquals(logs.some((line) => line.includes('symlink escape attempt')), true);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  } finally {
  /* TODO: restore mocks manually */ void 0;
  }
})