import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  buildNativeProofReportChunks,
  emitNativeProofReportChunks,
  MAX_PROOF_LOG_LINE_BYTES,
  retainNativeProofReport,
  type NativeProofReportFamily,
} from "./native-proof-report";

const REPOSITORY_ROOT = resolve(import.meta.dir, "../..");
const TEST_TMP = join(REPOSITORY_ROOT, "tmp");
const roots: string[] = [];

async function freshRoot(): Promise<string> {
  await mkdir(TEST_TMP, { recursive: true });
  const root = await mkdtemp(join(TEST_TMP, "native-proof-report-test-"));
  roots.push(root);
  return root;
}

async function expectMissing(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`expected path to be absent: ${path}`);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function reassemble(lines: string[], family: NativeProofReportFamily): { data: string; digest: string } {
  const records = lines.map((line) => JSON.parse(line) as Record<string, { data: string; index: number; chunks: number; sha256: string }>);
  const chunks = records.map((record) => record[family]!);
  expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, index) => index));
  expect(chunks.every((chunk) => chunk.chunks === chunks.length)).toBe(true);
  expect(chunks.every((chunk) => chunk.sha256 === chunks[0]!.sha256)).toBe(true);
  return { data: chunks.map((chunk) => chunk.data).join(""), digest: chunks[0]!.sha256 };
}

describe("native proof report chunks", () => {
  test("bounds final UTF-8 lines and reassembles escaped, non-ASCII, and non-BMP JSON exactly", () => {
    const serialized = JSON.stringify({
      status: "passed",
      text: "日本語🙂🚀\\\"\n\t\u0000".repeat(1800),
      nested: { value: "é漢字𐐷".repeat(2400) },
    });
    const lines = buildNativeProofReportChunks("nativeHttpSchemaProofReportChunk", serialized);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.endsWith("\n") && Buffer.byteLength(line, "utf8") <= MAX_PROOF_LOG_LINE_BYTES)).toBe(true);
    expect(reassemble(lines, "nativeHttpSchemaProofReportChunk")).toEqual({ data: serialized, digest: sha256(serialized) });
  });

  test("rejects empty, malformed, and oversized serialized input", () => {
    expect(() => buildNativeProofReportChunks("nativeUsageProofReportChunk", "")).toThrow("non-empty");
    expect(() => buildNativeProofReportChunks("nativeUsageProofReportChunk", "{" )).toThrow("valid JSON");
    expect(() => buildNativeProofReportChunks("nativeUsageProofReportChunk", JSON.stringify("x".repeat(8 * 1024 * 1024)))).toThrow("exceeds");
  });

  test("writes sequentially, awaits completion, and rejects errors, short writes, zero writes, and timeout", async () => {
    const serialized = JSON.stringify({ payload: "a".repeat(9000) });
    const lines = buildNativeProofReportChunks("nativeUsageProofReportChunk", serialized);
    const completed: number[] = [];
    await emitNativeProofReportChunks("nativeUsageProofReportChunk", serialized, async (line) => {
      const index = lines.indexOf(line);
      expect(completed).toEqual(lines.slice(0, index).map((_, prior) => prior));
      await Promise.resolve();
      completed.push(index);
      return Buffer.byteLength(line, "utf8");
    });
    expect(completed).toEqual(lines.map((_, index) => index));

    await expect(emitNativeProofReportChunks("nativeUsageProofReportChunk", serialized, async () => { throw new Error("writer failed"); }))
      .rejects.toThrow("writer failed");
    await expect(emitNativeProofReportChunks("nativeUsageProofReportChunk", serialized, async () => 0))
      .rejects.toThrow("short");
    await expect(emitNativeProofReportChunks("nativeUsageProofReportChunk", serialized, async (line) => Buffer.byteLength(line) - 1))
      .rejects.toThrow("short");
    await expect(emitNativeProofReportChunks("nativeUsageProofReportChunk", serialized, () => new Promise<number>(() => {}), 20))
      .rejects.toThrow("timed out");
  });

  test("survives a pressured child Bun pipe while emitting more than 64 KiB", async () => {
    const modulePath = join(import.meta.dir, "native-proof-report.ts");
    const source = `import { emitNativeProofReportChunks } from ${JSON.stringify(modulePath)}; await emitNativeProofReportChunks("nativeHttpSchemaProofReportChunk", JSON.stringify({ payload: "x".repeat(256 * 1024) }));`;
    const child = Bun.spawn([process.execPath, "-e", source], { stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => child.kill(), 7000);
    try {
      await Bun.sleep(75);
      const outputPromise = new Response(child.stdout).text();
      const [stdout, exitCode, stderr] = await Promise.all([
        outputPromise,
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(exitCode, stderr).toBe(0);
      expect(Buffer.byteLength(stdout, "utf8")).toBeGreaterThan(64 * 1024);
      const lines = stdout.trimEnd().split("\n").map((line) => `${line}\n`);
      expect(lines.every((line) => Buffer.byteLength(line, "utf8") <= MAX_PROOF_LOG_LINE_BYTES)).toBe(true);
      const rebuilt = reassemble(lines, "nativeHttpSchemaProofReportChunk").data;
      expect(rebuilt).toBe(JSON.stringify({ payload: "x".repeat(256 * 1024) }));
    } finally {
      clearTimeout(timeout);
      if (child.exitCode === null) child.kill();
    }
  });
});

describe("retained native proof report", () => {
  test("stores and verifies the complete envelope and refuses a duplicate nonce without changing bytes", async () => {
    const root = await freshRoot();
    const report = JSON.stringify({ status: "passed", result: "NATIVE_HTTP_SCHEMA_ADMISSION_OK", payload: "日本語🙂" });
    const nonce = randomUUID();
    const path = await retainNativeProofReport(root, "nativeHttpSchemaProofReportChunk", nonce, report);
    const bytesBefore = await readFile(path);
    const envelope = JSON.parse(bytesBefore.toString("utf8")) as {
      schemaVersion: number; family: string; sha256: string; bytes: number; serializedReport: string;
    };
    expect(envelope).toEqual({
      schemaVersion: 1,
      family: "nativeHttpSchemaProofReportChunk",
      sha256: sha256(report),
      bytes: Buffer.byteLength(report, "utf8"),
      serializedReport: report,
    });
    await expect(retainNativeProofReport(root, "nativeHttpSchemaProofReportChunk", nonce, report)).rejects.toThrow();
    expect(await readFile(path)).toEqual(bytesBefore);
  });

  test("requires the matching passed result and validates UUIDs", async () => {
    const root = await freshRoot();
    await expect(retainNativeProofReport(root, "nativeUsageProofReportChunk", randomUUID(), JSON.stringify({ status: "failed", result: "NATIVE_D1_SCHEMA_TERMINAL_USAGE_RECOVERY_OK" })))
      .rejects.toThrow("status must be passed");
    await expect(retainNativeProofReport(root, "nativeUsageProofReportChunk", randomUUID(), JSON.stringify({ status: "passed", result: "NATIVE_HTTP_SCHEMA_ADMISSION_OK" })))
      .rejects.toThrow("result must be");
    await expect(retainNativeProofReport(root, "nativeUsageProofReportChunk", "not-a-uuid", JSON.stringify({ status: "passed", result: "NATIVE_D1_SCHEMA_TERMINAL_USAGE_RECOVERY_OK" })))
      .rejects.toThrow("UUID");
  });

  test("rejects tmp and report-base symlink escapes before writing outside the checkout", async () => {
    const root = await freshRoot();
    const foreign = await freshRoot();
    const nonce = randomUUID();
    const report = JSON.stringify({ status: "passed", result: "NATIVE_HTTP_SCHEMA_ADMISSION_OK" });
    await symlink(foreign, join(root, "tmp"));
    await expect(retainNativeProofReport(root, "nativeHttpSchemaProofReportChunk", nonce, report)).rejects.toThrow("tmp resolves outside");
    await expectMissing(join(foreign, "native-proof-reports"));
    await expectMissing(join(foreign, `native-proof-reports/nativeHttpSchemaProofReportChunk-${nonce}.json`));
  });

  test("rejects a symlinked root before writing to its physical target", async () => {
    const physicalRoot = await freshRoot();
    const linkedRoot = join(TEST_TMP, `native-proof-report-root-link-${randomUUID()}`);
    roots.push(linkedRoot);
    await symlink(physicalRoot, linkedRoot);
    const report = JSON.stringify({ status: "passed", result: "NATIVE_HTTP_SCHEMA_ADMISSION_OK" });
    await expect(retainNativeProofReport(linkedRoot, "nativeHttpSchemaProofReportChunk", randomUUID(), report))
      .rejects.toThrow("canonical physical path");
    await expectMissing(join(physicalRoot, "tmp"));
  });

  test("rejects a symlinked report base before writing to its target", async () => {
    const root = await freshRoot();
    const foreign = await freshRoot();
    const nonce = randomUUID();
    const report = JSON.stringify({ status: "passed", result: "NATIVE_HTTP_SCHEMA_ADMISSION_OK" });
    await mkdir(join(root, "tmp"));
    await symlink(foreign, join(root, "tmp/native-proof-reports"));
    await expect(retainNativeProofReport(root, "nativeHttpSchemaProofReportChunk", nonce, report)).rejects.toThrow("directory resolves outside");
    expect(await readFile(join(foreign, `nativeHttpSchemaProofReportChunk-${nonce}.json`)).catch(() => null)).toBeNull();
  });
});
