import { assertEquals, assertExists } from "@std/assert";
import { stub } from "@std/testing/mock";
import {
  buildArchiveDownloadUrl,
  extractRepositoryZipFiles,
  fetchRepositoryArchive,
} from "../../../application/services/platform/remote-repo-archive.ts";

Deno.test("remote repo archive - builds GitHub archive URL", () => {
  assertEquals(
    buildArchiveDownloadUrl("https://github.com/acme/demo.git", "main"),
    "https://codeload.github.com/acme/demo/zip/main",
  );
});

Deno.test("remote repo archive - builds GitLab archive URL for nested groups", () => {
  assertEquals(
    buildArchiveDownloadUrl(
      "https://gitlab.com/acme/platform/demo.git",
      "release/v1",
    ),
    "https://gitlab.com/acme/platform/demo/-/archive/release%2Fv1/demo-release%2Fv1.zip",
  );
});

Deno.test("remote repo archive - extracts repository-relative file paths from zip", async () => {
  const jszip = await import("npm:jszip");
  const JSZip = "default" in jszip ? jszip.default : jszip;
  const zip = new JSZip();
  zip.file("demo-main/.takosumi.yml", "apiVersion: v1\n");
  zip.file("demo-main/dist/worker.js", "export default {};\n");

  const archiveData = await zip.generateAsync({ type: "arraybuffer" });
  const files = await extractRepositoryZipFiles(archiveData);

  assertEquals(Array.from(files.keys()).sort(), [
    ".takosumi.yml",
    "dist/worker.js",
  ]);
});

Deno.test("remote repo archive - fetches and extracts supported host archives", async () => {
  const jszip = await import("npm:jszip");
  const JSZip = "default" in jszip ? jszip.default : jszip;
  const zip = new JSZip();
  zip.file("demo-main/.takosumi.yml", "apiVersion: v1\n");
  const archiveData = await zip.generateAsync({ type: "uint8array" });

  const fetchStub = stub(globalThis, "fetch", async (input) => {
    assertEquals(
      String(input),
      "https://codeload.github.com/acme/demo/zip/main",
    );
    const archiveBody = new Uint8Array(archiveData.byteLength);
    archiveBody.set(archiveData);
    return new Response(new Blob([archiveBody.buffer]), { status: 200 });
  });

  try {
    const files = await fetchRepositoryArchive(
      "https://github.com/acme/demo.git",
      "main",
    );
    assertExists(files);
    assertEquals(
      new TextDecoder().decode(files.get(".takosumi.yml")),
      "apiVersion: v1\n",
    );
  } finally {
    fetchStub.restore();
  }
});
