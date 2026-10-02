import { createHash } from "node:crypto";
import { mkdir, open, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

export type NativeProofReportFamily =
  | "nativeHttpSchemaProofReportChunk"
  | "nativeUsageProofReportChunk";

export const MAX_PROOF_LOG_LINE_BYTES = 2048;
const MAX_SERIALIZED_REPORT_BYTES = 8 * 1024 * 1024;
const DEFAULT_WRITE_TIMEOUT_MS = 5000;
const EXPECTED_RESULTS: Record<NativeProofReportFamily, string> = {
  nativeHttpSchemaProofReportChunk: "NATIVE_HTTP_SCHEMA_ADMISSION_OK",
  nativeUsageProofReportChunk: "NATIVE_D1_SCHEMA_TERMINAL_USAGE_RECOVERY_OK",
};

function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function validFamily(value: string): value is NativeProofReportFamily {
  return value === "nativeHttpSchemaProofReportChunk" || value === "nativeUsageProofReportChunk";
}

function reportDigest(serializedReport: string): string {
  return createHash("sha256").update(serializedReport, "utf8").digest("hex");
}

function validateSerializedReport(serializedReport: string): number {
  ensure(typeof serializedReport === "string" && serializedReport.length > 0, "native proof report must be a non-empty string");
  const bytes = Buffer.byteLength(serializedReport, "utf8");
  ensure(bytes <= MAX_SERIALIZED_REPORT_BYTES, `native proof report exceeds ${MAX_SERIALIZED_REPORT_BYTES} bytes`);
  try {
    JSON.parse(serializedReport);
  } catch {
    throw new Error("native proof report must contain valid JSON");
  }
  return bytes;
}

function chunkEscapedPayload(serializedReport: string, family: NativeProofReportFamily, sha256: string): string[] {
  // Reserve maximum safe-integer widths for both numeric header fields. This
  // keeps chunk sizing independent of the eventual chunk count.
  const header = JSON.stringify({
    [family]: { sha256, index: Number.MAX_SAFE_INTEGER, chunks: Number.MAX_SAFE_INTEGER, data: "" },
  });
  const payloadBudget = MAX_PROOF_LOG_LINE_BYTES - Buffer.byteLength(header, "utf8") - 1;
  ensure(payloadBudget > 0, "native proof report chunk header exceeds the line limit");

  const chunks: string[] = [];
  let current = "";
  let currentEscapedBytes = 0;
  for (const character of serializedReport) {
    const escaped = JSON.stringify(character).slice(1, -1);
    const escapedBytes = Buffer.byteLength(escaped, "utf8");
    ensure(escapedBytes <= payloadBudget, "a serialized character cannot fit in a proof log line");
    if (currentEscapedBytes + escapedBytes > payloadBudget) {
      chunks.push(current);
      current = "";
      currentEscapedBytes = 0;
    }
    current += character;
    currentEscapedBytes += escapedBytes;
  }
  if (current.length > 0) chunks.push(current);
  ensure(chunks.length > 0, "native proof report produced no chunks");
  return chunks;
}

export function buildNativeProofReportChunks(family: NativeProofReportFamily, serializedReport: string): string[] {
  ensure(validFamily(family), "unsupported native proof report family");
  validateSerializedReport(serializedReport);
  const sha256 = reportDigest(serializedReport);
  const dataChunks = chunkEscapedPayload(serializedReport, family, sha256);
  const lines = dataChunks.map((data, index) => `${JSON.stringify({
    [family]: { sha256, index, chunks: dataChunks.length, data },
  })}\n`);
  for (const line of lines) {
    ensure(Buffer.byteLength(line, "utf8") <= MAX_PROOF_LOG_LINE_BYTES, "proof log chunk exceeded its final byte limit");
  }
  return lines;
}

export async function emitNativeProofReportChunks(
  family: NativeProofReportFamily,
  serializedReport: string,
  write: (line: string) => Promise<number> = async (line) => Bun.write(Bun.stdout, line),
  timeoutMs = DEFAULT_WRITE_TIMEOUT_MS,
): Promise<void> {
  ensure(Number.isFinite(timeoutMs) && timeoutMs > 0, "proof report write timeout must be finite and positive");
  const lines = buildNativeProofReportChunks(family, serializedReport);
  const deadline = Date.now() + timeoutMs;
  for (const line of lines) {
    const expectedBytes = Buffer.byteLength(line, "utf8");
    const remainingMs = deadline - Date.now();
    ensure(remainingMs > 0, "native proof report writes exceeded the total deadline");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const written = await Promise.race([
        write(line),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("native proof report write timed out")), remainingMs);
        }),
      ]);
      ensure(written === expectedBytes, `native proof report write was short (${String(written)}/${expectedBytes} bytes)`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export async function retainNativeProofReport(
  root: string,
  family: NativeProofReportFamily,
  nonce: string,
  serializedReport: string,
): Promise<string> {
  ensure(validFamily(family), "unsupported native proof report family");
  ensure(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(nonce), "native proof nonce must be a UUID");
  const bytes = validateSerializedReport(serializedReport);
  let report: unknown;
  try {
    report = JSON.parse(serializedReport);
  } catch {
    throw new Error("native proof report must contain valid JSON");
  }
  ensure(typeof report === "object" && report !== null, "native proof report must be a JSON object");
  const candidate = report as { status?: unknown; result?: unknown };
  ensure(candidate.status === "passed", "native proof report status must be passed");
  ensure(candidate.result === EXPECTED_RESULTS[family], `native proof report result must be ${EXPECTED_RESULTS[family]}`);

  const requestedRoot = resolve(root);
  const physicalRoot = await realpath(requestedRoot);
  ensure(physicalRoot === requestedRoot, "native proof root must be a canonical physical path");
  const expectedTmp = join(physicalRoot, "tmp");
  const tmp = join(requestedRoot, "tmp");
  try {
    await mkdir(tmp, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  ensure(await realpath(tmp) === expectedTmp, "native proof tmp resolves outside the owning checkout");

  const expectedBase = join(physicalRoot, "tmp/native-proof-reports");
  const base = join(requestedRoot, "tmp/native-proof-reports");
  try {
    await mkdir(base, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  ensure(await realpath(base) === expectedBase, "native proof report directory resolves outside the owning checkout");

  const path = join(base, `${family}-${nonce}.json`);
  const sha256 = reportDigest(serializedReport);
  const envelope = { schemaVersion: 1, family, sha256, bytes, serializedReport };
  const envelopeBytes = Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8");
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(envelopeBytes);
    await file.sync();
  } finally {
    await file.close();
  }

  const readbackBytes = await readFile(path);
  ensure(readbackBytes.equals(envelopeBytes), "native proof report envelope readback differed from the written bytes");
  const readback = JSON.parse(readbackBytes.toString("utf8")) as typeof envelope;
  ensure(readback.schemaVersion === 1 && readback.family === family && readback.sha256 === sha256 &&
    readback.bytes === bytes && readback.serializedReport === serializedReport,
  "native proof report envelope readback validation failed");
  ensure(Buffer.byteLength(readback.serializedReport, "utf8") === bytes && reportDigest(readback.serializedReport) === sha256,
    "native proof report content readback validation failed");
  return path;
}
