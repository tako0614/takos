import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { BigIntStats } from "node:fs";
import type { DurableObjectStorageBinding } from "../src/worker/shared/types/bindings.ts";
import {
  receiptBootstrapProgressKey,
  receiptNodeKey,
} from "../src/worker/runtime/durable-objects/run-receipt-index.ts";
import { receiptRetiredKey } from "../src/worker/runtime/durable-objects/run-receipt-maintenance.ts";
import {
  convertRunArchiveCandidate,
  verifyRunArchiveCandidate,
} from "./lib/run-archive-candidate.ts";

const MANIFEST_LIMIT = 32 * 1024 * 1024;
const KV_LIMIT = 8 * 1024 * 1024;
const OBJECT_LIMIT = 256 * 1024 * 1024;
const MAX_ENTRIES = 100_000;
const SHA = /^[a-f0-9]{64}$/;
const RUN_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const AUTHORITY = {
  namespace: "new-isolated-kv-and-object-store",
  inPlaceApply: false,
  deploymentQualified: false,
  historicalCompletenessProven: false,
  sqlReconciled: false,
  oldWritersQuiesced: false,
  otherInstanceDataIncluded: false,
};

type FileEntry = { path: string; bytes: number; sha256: string };
type Entry = FileEntry & { key: string };
type ObjectEntry = Entry & { metadata?: Record<string, unknown> };
type ExportManifest = {
  kind: "takos.run-archive-export@1";
  runId: string;
  sourceCommit: string;
  kv: Entry[];
  objects: ObjectEntry[];
  sqlWitness?: FileEntry;
};
type Verification = Awaited<ReturnType<typeof convertRunArchiveCandidate>>["verification"];
type CandidateManifest = {
  kind: "takos.run-archive-candidate@1";
  runId: string;
  sourceCommit: string;
  sourceExportDigest: string;
  source: Awaited<ReturnType<typeof convertRunArchiveCandidate>>["source"];
  verification: Verification;
  authority: typeof AUTHORITY;
  kv: Entry[];
  objects: ObjectEntry[];
  sqlWitness?: FileEntry;
};

function fail(message: string): never {
  throw new Error(message);
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function record(raw: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Invalid archive manifest object");
  const value = raw as Record<string, unknown>;
  if (required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) {
    fail("Invalid archive manifest fields");
  }
  return value;
}

function fileEntry(raw: unknown, maximum: number, keyed = false, metadata = false): Entry | FileEntry {
  const value = record(raw, ["path", "bytes", "sha256", ...(keyed ? ["key"] : [])],
    metadata ? ["metadata"] : []);
  if (typeof value.path !== "string" || value.path.length > 1024 ||
    !value.path.split("/").every((part) => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,254}$/.test(part)) ||
    typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 || value.bytes > maximum ||
    typeof value.sha256 !== "string" || !SHA.test(value.sha256) ||
    keyed && (typeof value.key !== "string" || !value.key || value.key.length > 256)) {
    fail("Invalid archive manifest file entry");
  }
  if (metadata && value.metadata !== undefined &&
    (!value.metadata || typeof value.metadata !== "object" || Array.isArray(value.metadata))) {
    fail("Invalid archive object metadata");
  }
  return value as unknown as Entry | FileEntry;
}

function entries(raw: unknown, maximum: number, metadata = false): ObjectEntry[] {
  if (!Array.isArray(raw) || raw.length > MAX_ENTRIES) fail("Archive export inventory exceeds its limit");
  const result = raw.map((entry) => fileEntry(entry, maximum, true, metadata) as ObjectEntry);
  if (new Set(result.map((entry) => entry.key)).size !== result.length ||
    new Set(result.map((entry) => entry.path)).size !== result.length) {
    fail("Archive export contains duplicate keys or paths");
  }
  return result;
}

function receiptKVKey(key: string): boolean {
  const hash = key.slice(-64);
  return SHA.test(hash) &&
    (key === receiptNodeKey(hash) || key === receiptRetiredKey(hash) || key === receiptBootstrapProgressKey(hash));
}

function parseManifest(raw: unknown, candidate: boolean): ExportManifest | CandidateManifest {
  const common = ["kind", "runId", "sourceCommit", "kv", "objects"];
  const value = record(raw, candidate
    ? [...common, "sourceExportDigest", "source", "verification", "authority"] : common, ["sqlWitness"]);
  if (value.kind !== (candidate ? "takos.run-archive-candidate@1" : "takos.run-archive-export@1") ||
    typeof value.runId !== "string" || !RUN_ID.test(value.runId) ||
    typeof value.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(value.sourceCommit)) {
    fail("Invalid archive manifest identity");
  }
  const kv = entries(value.kv, KV_LIMIT);
  const objects = entries(value.objects, OBJECT_LIMIT, true);
  if (kv.some((entry) => entry.key !== "bufferState" &&
    !/^notifier-v2\/chunks\/[a-f0-9]{64}$/.test(entry.key) &&
    !/^run-archive-v3\/(?:nodes|retired)\/[a-f0-9]{64}$/.test(entry.key) &&
    !receiptKVKey(entry.key))) {
    fail("Archive export contains an unknown KV key");
  }
  if (!kv.some((entry) => entry.key === "bufferState")) fail("Archive export is missing its committed head");
  const allPaths = [...kv, ...objects].map((entry) => entry.path);
  const sqlWitness = value.sqlWitness === undefined ? undefined : fileEntry(value.sqlWitness, OBJECT_LIMIT);
  if (sqlWitness) allPaths.push(sqlWitness.path);
  if (new Set(allPaths).size !== allPaths.length) fail("Archive export aliases inventory files");
  if (candidate && (typeof value.sourceExportDigest !== "string" || !SHA.test(value.sourceExportDigest) ||
    JSON.stringify(value.authority) !== JSON.stringify(AUTHORITY))) {
    fail("Candidate has an invalid source digest or authority boundary");
  }
  return { ...value, kv, objects, ...(sqlWitness ? { sqlWitness } : {}) } as unknown as
    ExportManifest | CandidateManifest;
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mode === right.mode && left.nlink === right.nlink &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

async function privateDirectory(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() ||
    process.platform !== "win32" && (info.mode & 0o077) !== 0 ||
    process.getuid && info.uid !== process.getuid()) {
    fail("Archive custody must be a private directory owned by the current operator");
  }
  return realpath(path);
}

async function containedPath(root: string, path: string): Promise<string> {
  const parts = path.split("/");
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]!);
    const info = await lstat(current);
    if (info.isSymbolicLink() || index < parts.length - 1 && !info.isDirectory()) {
      fail("Archive custody contains a symbolic link or invalid directory");
    }
  }
  if (await realpath(current) !== current) fail("Archive file escaped its private custody");
  return current;
}

class Custody {
  private seals = new Map<string, BigIntStats>();
  constructor(readonly root: string) {}

  async preflight(entry: FileEntry, maximum: number): Promise<void> {
    const physical = await containedPath(this.root, entry.path);
    const info = await lstat(physical, { bigint: true });
    if (!info.isFile() || info.nlink !== 1n || info.size !== BigInt(entry.bytes) ||
      info.size < 1n || info.size > BigInt(maximum) ||
      process.getuid && info.uid !== BigInt(process.getuid())) {
      fail("Invalid archive custody file");
    }
  }

  async read(path: string, maximum: number, expected?: FileEntry): Promise<Uint8Array> {
    const physical = await containedPath(this.root, path);
    const file = await open(physical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await file.stat({ bigint: true });
      if (!before.isFile() || before.nlink !== 1n || before.size < 1n ||
        before.size > BigInt(maximum) ||
        process.getuid && before.uid !== BigInt(process.getuid()) ||
        expected && before.size !== BigInt(expected.bytes)) fail("Invalid archive custody file");
      const previous = this.seals.get(physical);
      if (previous && !sameFile(previous, before)) fail("Archive source changed during conversion");
      const bytes = new Uint8Array(Number(before.size));
      let offset = 0;
      while (offset < bytes.length) {
        const part = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!part.bytesRead) fail("Archive custody file ended early");
        offset += part.bytesRead;
      }
      if ((await file.read(new Uint8Array(1), 0, 1, offset)).bytesRead ||
        !sameFile(before, await file.stat({ bigint: true })) ||
        !sameFile(before, await lstat(physical, { bigint: true }))) {
        fail("Archive source changed during conversion");
      }
      if (expected && sha256(bytes) !== expected.sha256) fail("Archive custody file digest mismatch");
      this.seals.set(physical, before);
      return bytes;
    } finally {
      await file.close();
    }
  }

  async recheck(): Promise<void> {
    await privateDirectory(this.root);
    for (const [path, seal] of this.seals) {
      const rel = relative(this.root, path).split(sep).join("/");
      const physical = await containedPath(this.root, rel);
      if (!sameFile(seal, await lstat(physical, { bigint: true }))) {
        fail("Archive source changed before candidate sealing");
      }
    }
  }
}

function parseJSON(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("Archive custody contains invalid JSON or UTF-8");
  }
}

function readOnlyStorage(custody: Custody, entries: Entry[]): DurableObjectStorageBinding {
  const index = new Map(entries.map((entry) => [entry.key, entry]));
  async function get<T>(key: string): Promise<T | undefined> {
    const entry = index.get(key);
    return entry ? parseJSON(await custody.read(entry.path, KV_LIMIT, entry)) as T : undefined;
  }
  return {
    get,
    put: async () => fail("Archive input storage is read-only"),
    delete: async () => fail("Archive input storage is read-only"),
    list: async <T>(options?: Record<string, unknown>) => {
      if (options && Object.keys(options).some((key) =>
        !["prefix", "limit", "start", "startAfter", "end", "reverse"].includes(key))) {
        fail("Unsupported archive storage listing option");
      }
      const prefix = typeof options?.prefix === "string" ? options.prefix : "";
      const limit = options?.limit ?? 1000;
      if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000 ||
        ["prefix", "start", "startAfter", "end"].some((key) =>
          options?.[key] !== undefined && typeof options[key] !== "string") ||
        options?.reverse !== undefined && typeof options.reverse !== "boolean") {
        fail("Invalid bounded archive storage listing option");
      }
      const selected = [...index.keys()].filter((key) => key.startsWith(prefix) &&
        (options?.start === undefined || key >= (options.start as string)) &&
        (options?.startAfter === undefined || key > (options.startAfter as string)) &&
        (options?.end === undefined || key < (options.end as string)))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0) * (options?.reverse ? -1 : 1)).slice(0, limit);
      const result = new Map<string, T>();
      let bytes = 0;
      for (const key of selected) {
        bytes += index.get(key)!.bytes;
        if (bytes > MANIFEST_LIMIT) fail("Archive storage listing exceeds its byte budget");
        result.set(key, (await get<T>(key))!);
      }
      return result;
    },
    getAlarm: async () => null,
    setAlarm: async () => undefined,
    deleteAlarm: async () => undefined,
  };
}

async function checkInventory(custody: Custody, kv: Entry[]): Promise<void> {
  // Verify one bounded file at a time; do not retain an entire exported tree.
  for (const entry of kv) parseJSON(await custody.read(entry.path, KV_LIMIT, entry));
}

async function pinnedManifest(path: string, expectedDigest: string, candidate: boolean) {
  if (!SHA.test(expectedDigest)) fail("An exact caller-selected manifest SHA-256 is required");
  const absolute = resolve(path);
  const custody = new Custody(await privateDirectory(dirname(absolute)));
  const bytes = await custody.read(relative(custody.root, absolute), MANIFEST_LIMIT);
  if (sha256(bytes) !== expectedDigest) fail("Caller-selected manifest digest mismatch");
  return { custody, manifest: parseManifest(parseJSON(bytes), candidate) };
}

async function writeExclusive(root: string, path: string, bytes: Uint8Array): Promise<FileEntry> {
  await writeFile(join(root, path), bytes, { flag: "wx", mode: 0o600 });
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}

export async function createArchiveCandidate(options: {
  input: string; expectedInputSha256: string; output: string;
}) {
  const { custody, manifest: raw } = await pinnedManifest(options.input, options.expectedInputSha256, false);
  const source = raw as ExportManifest;
  const output = resolve(options.output);
  const parent = await privateDirectory(dirname(output));
  if (parent !== dirname(output)) fail("Candidate parent must not resolve through a symbolic link");
  const relation = relative(custody.root, output);
  if (!relation || !relation.startsWith(".." + sep) && relation !== ".." && !isAbsolute(relation)) {
    fail("Candidate output must be separate from the retained source custody");
  }
  await checkInventory(custody, source.kv);
  for (const entry of source.objects) await custody.preflight(entry, OBJECT_LIMIT);
  if (source.sqlWitness) await custody.preflight(source.sqlWitness, OBJECT_LIMIT);
  const sourceObjects = new Map(source.objects.map((entry) => [entry.key, entry]));
  // mkdir is deliberately exclusive. Never adopt or overwrite an existing output.
  await mkdir(output, { mode: 0o700 });
  await mkdir(join(output, "kv"), { mode: 0o700 });
  await mkdir(join(output, "objects"), { mode: 0o700 });
  const target = new Custody(await privateDirectory(output));
  const written = new Map<string, FileEntry>();
  const result = await convertRunArchiveCandidate({
    runId: source.runId,
    storage: readOnlyStorage(custody, source.kv),
    objects: source.objects.map(({ key, bytes, sha256: digest }) => ({ key, bytes, sha256: digest })),
    readObject: async (key) => {
      const entry = sourceObjects.get(key);
      if (!entry) fail("Archive source inventory is missing an object");
      return custody.read(entry.path, OBJECT_LIMIT, entry);
    },
    writeObject: async (key, bytes) => {
      if (written.has(key) || written.size >= MAX_ENTRIES) fail("Candidate object inventory exceeds its limit");
      const path = "objects/" + sha256(key) + ".gz";
      written.set(key, await writeExclusive(output, path, bytes));
    },
    readCandidateObject: async (key) => {
      const entry = written.get(key);
      if (!entry) fail("Candidate readback is missing a written object");
      return target.read(entry.path, OBJECT_LIMIT, entry);
    },
  });
  const kv: Entry[] = [];
  for (const [key, value] of [...result.values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const entry = await writeExclusive(output, "kv/" + sha256(key) + ".json",
      new TextEncoder().encode(JSON.stringify(value)));
    kv.push({ key, ...entry });
  }
  const objects = result.objects.map((entry): ObjectEntry => {
    const file = written.get(entry.key);
    if (!file || file.bytes !== entry.bytes || file.sha256 !== entry.sha256) {
      fail("Candidate object inventory did not match its verified write");
    }
    const metadata = sourceObjects.get(entry.key)?.metadata;
    return { key: entry.key, ...file, ...(entry.key.includes("/usage/") && metadata ? { metadata } : {}) };
  });
  if (written.size !== objects.length ||
    new Set(objects.map((entry) => entry.key)).size !== written.size) {
    fail("Candidate contains an unaccounted object write");
  }
  let sqlWitness: FileEntry | undefined;
  if (source.sqlWitness) {
    sqlWitness = await writeExclusive(output, "sql-witness.bin",
      await custody.read(source.sqlWitness.path, OBJECT_LIMIT, source.sqlWitness));
  }
  const candidate: CandidateManifest = {
    kind: "takos.run-archive-candidate@1", runId: source.runId, sourceCommit: source.sourceCommit,
    sourceExportDigest: options.expectedInputSha256, source: result.source,
    verification: result.verification, authority: AUTHORITY, kv, objects,
    ...(sqlWitness ? { sqlWitness } : {}),
  };
  parseManifest(candidate, true);
  const candidateBytes = new TextEncoder().encode(JSON.stringify(candidate, null, 2) + "\n");
  if (candidateBytes.length > MANIFEST_LIMIT) fail("Candidate manifest exceeds its byte limit");
  await checkInventory(target, kv);
  const targetObjects = new Map(objects.map((entry) => [entry.key, entry]));
  await verifyRunArchiveCandidate({
    runId: source.runId, storage: readOnlyStorage(target, kv), objects,
    readObject: async (key) => {
      const entry = targetObjects.get(key);
      if (!entry) fail("Candidate inventory is missing an object");
      return target.read(entry.path, OBJECT_LIMIT, entry);
    },
    verification: result.verification,
  });
  if (sqlWitness) await target.read(sqlWitness.path, OBJECT_LIMIT, sqlWitness);
  await custody.recheck();
  await target.recheck();
  // A successful artifact exists only after conversion and both readbacks finish.
  const sealed = await writeExclusive(output, "manifest.json", candidateBytes);
  await target.read(sealed.path, MANIFEST_LIMIT, sealed);
  return { status: "verified-isolated-candidate", manifestSha256: sealed.sha256,
    eventCount: result.verification.eventCount, authority: AUTHORITY };
}

export async function verifyArchiveCandidate(options: { manifest: string; expectedManifestSha256: string }) {
  const { custody, manifest: raw } = await pinnedManifest(
    options.manifest, options.expectedManifestSha256, true,
  );
  const candidate = raw as CandidateManifest;
  await checkInventory(custody, candidate.kv);
  const objects = new Map(candidate.objects.map((entry) => [entry.key, entry]));
  await verifyRunArchiveCandidate({
    runId: candidate.runId, storage: readOnlyStorage(custody, candidate.kv), objects: candidate.objects,
    readObject: async (key) => {
      const entry = objects.get(key);
      if (!entry) fail("Candidate inventory is missing an object");
      return custody.read(entry.path, OBJECT_LIMIT, entry);
    },
    verification: candidate.verification,
  });
  if (candidate.sqlWitness) await custody.read(candidate.sqlWitness.path, OBJECT_LIMIT, candidate.sqlWitness);
  await custody.recheck();
  return { status: "verified-isolated-candidate", manifestSha256: options.expectedManifestSha256,
    eventCount: candidate.verification.eventCount, authority: AUTHORITY };
}

async function main(args: string[]): Promise<void> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]!;
    const value = args[index + 1];
    if (!["--input", "--output", "--expected-input-sha256", "--verify", "--expected-manifest-sha256"].includes(key) ||
      !value || value.startsWith("--") || parsed.has(key)) fail("Invalid archive candidate arguments");
    parsed.set(key, value);
  }
  if (parsed.has("--verify")) {
    if (parsed.size !== 2 || !parsed.has("--expected-manifest-sha256")) fail("Invalid verification arguments");
    console.log(JSON.stringify(await verifyArchiveCandidate({
      manifest: parsed.get("--verify")!, expectedManifestSha256: parsed.get("--expected-manifest-sha256")!,
    })));
  } else {
    if (parsed.size !== 3 || !parsed.has("--input") || !parsed.has("--output") ||
      !parsed.has("--expected-input-sha256")) fail("Invalid conversion arguments");
    console.log(JSON.stringify(await createArchiveCandidate({
      input: parsed.get("--input")!, output: parsed.get("--output")!,
      expectedInputSha256: parsed.get("--expected-input-sha256")!,
    })));
  }
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Archive candidate failed");
    process.exitCode = 1;
  }
}
