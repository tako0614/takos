import { Buffer } from "node:buffer";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { assertEquals } from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";

const originalTakosApiUrl = Deno.env.get("TAKOS_API_URL");
if (!originalTakosApiUrl) {
  Deno.env.set("TAKOS_API_URL", "https://takos.jp");
}
const {
  createS3ClientConfig,
  downloadSpaceFiles,
  isObjectStorageConfigured,
  s3Client,
  uploadSpaceFiles,
} = await import(new URL("../../storage/r2.ts", import.meta.url).href);
if (!originalTakosApiUrl) {
  Deno.env.delete("TAKOS_API_URL");
}

function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

Deno.test("r2 client config - omits static credentials so AWS default provider chain can resolve them", () => {
  const config = createS3ClientConfig({
    region: "ap-northeast-1",
    endpoint: "",
    accessKeyId: "",
    secretAccessKey: "",
  });

  assertEquals(config.region, "ap-northeast-1");
  assertEquals("endpoint" in config, false);
  assertEquals("credentials" in config, false);
});

Deno.test("r2 client config - preserves static credentials for S3-compatible storage", () => {
  const config = createS3ClientConfig({
    region: "auto",
    endpoint: "https://example.r2.cloudflarestorage.com",
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
  });

  assertEquals(config.region, "auto");
  assertEquals(config.endpoint, "https://example.r2.cloudflarestorage.com");
  assertEquals(config.credentials, {
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
  });
});

Deno.test("r2 configured check - accepts explicit bucket and region without static credentials", () => {
  assertEquals(
    isObjectStorageConfigured({
      bucket: "takos-runtime",
      region: "ap-northeast-1",
      endpoint: "",
      accessKeyId: "",
      secretAccessKey: "",
      hasExplicitConfig: true,
    }),
    true,
  );
});

Deno.test("r2 configured check - rejects partial static credentials", () => {
  assertEquals(
    isObjectStorageConfigured({
      bucket: "takos-runtime",
      region: "ap-northeast-1",
      endpoint: "https://example.r2.cloudflarestorage.com",
      accessKeyId: "access-key",
      secretAccessKey: "",
      hasExplicitConfig: true,
    }),
    false,
  );
});

Deno.test("r2 symlink boundary hardening - skips upload paths that symlink outside base directory", async () => {
  const workspaceDir = await createTempDir("takos-r2-upload-ws-");
  const outsideDir = await createTempDir("takos-r2-upload-outside-");
  const outsideFile = path.join(outsideDir, "outside.txt");
  const symlinkPath = path.join(workspaceDir, "escape.txt");
  const sendSpy = stub(s3Client, "send");

  try {
    await fs.writeFile(outsideFile, "outside");
    await fs.symlink(outsideFile, symlinkPath);

    const logs: string[] = [];
    const uploaded = await uploadSpaceFiles("ws-upload", workspaceDir, [
      "escape.txt",
    ], logs);

    assertEquals(uploaded, 0);
    assertSpyCalls(sendSpy, 0);
    assertEquals(
      logs.some((line) => line.includes("symlink escape attempt")),
      true,
    );
  } finally {
    sendSpy.restore();
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

Deno.test("r2 symlink boundary hardening - skips download paths that traverse through escaping symlink components", async () => {
  const workspaceDir = await createTempDir("takos-r2-download-ws-");
  const outsideDir = await createTempDir("takos-r2-download-outside-");
  const outsideFile = path.join(outsideDir, "evil.txt");
  const escapeLink = path.join(workspaceDir, "escape-dir");
  const sendStub = stub(
    s3Client,
    "send",
    ((command: { constructor?: { name?: string } }) => {
      const commandName = command.constructor?.name;

      if (commandName === "ListObjectsV2Command") {
        return Promise.resolve({
          Contents: [
            {
              Key: "workspaces/ws-download/files/object-1",
              Size: 5,
            },
          ],
          NextContinuationToken: undefined,
        });
      }

      if (commandName === "GetObjectCommand") {
        return Promise.resolve({
          Body: {
            transformToByteArray: () => Promise.resolve(Buffer.from("hello")),
          },
          Metadata: {
            "file-path": "escape-dir/evil.txt",
          },
        });
      }

      return Promise.reject(new Error(`Unexpected command: ${commandName}`));
    }) as typeof s3Client.send,
  );

  try {
    await fs.symlink(outsideDir, escapeLink);

    const logs: string[] = [];
    const downloaded = await downloadSpaceFiles(
      "ws-download",
      workspaceDir,
      logs,
    );
    const outsideFileExists = await fs.stat(outsideFile).then(() => true).catch(
      () => false,
    );

    assertEquals(downloaded, 0);
    assertEquals(outsideFileExists, false);
    assertEquals(
      logs.some((line) => line.includes("symlink escape attempt")),
      true,
    );
  } finally {
    sendStub.restore();
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});
