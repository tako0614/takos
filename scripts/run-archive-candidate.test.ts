import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import {
  link,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createArchiveCandidate,
  verifyArchiveCandidate,
} from "./run-archive-candidate.ts";

const RUN_ID = "run-test";
const SOURCE_COMMIT = "9b2c2fc20a8d8d7d8f20fdb2f732d1a2b3c4d5e6";
const EVENT_KEY = `runs/${RUN_ID}/events/000001.jsonl.gz`;
const USAGE_KEY = `runs/${RUN_ID}/usage/000001.jsonl.gz`;

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function event(event_id: number) {
  return {
    event_id,
    type: "run.progress",
    data: JSON.stringify({ sequence: event_id }),
    created_at: "2026-10-01T00:00:00.000Z",
  };
}

async function ownedTemp(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  await chmod(path, 0o700);
  return path;
}

type Fixture = {
  outer: string;
  inputDir: string;
  inputPath: string;
  inputBytes: Uint8Array;
  inputSha256: string;
  objectBytes: Uint8Array;
  usageBytes: Uint8Array;
  sqlBytes: Uint8Array;
  output: string;
};

async function fixture(): Promise<Fixture> {
  const outer = await ownedTemp("takos-run-archive-candidate-test-");
  const inputDir = join(outer, "source");
  await mkdir(inputDir, { mode: 0o700 });
  const objectBytes = gzipSync(JSON.stringify(event(1)) + "\n");
  const secondObjectBytes = gzipSync(JSON.stringify(event(2)) + "\n");
  const usageBytes = gzipSync(JSON.stringify({ runId: RUN_ID, usage: { inputTokens: 3, outputTokens: 5 } }) + "\n");
  const sqlBytes = new TextEncoder().encode("opaque sql export witness\n");
  const files = [
    { key: "bufferState", path: "kv/buffer-state.json", bytes: new TextEncoder().encode(JSON.stringify({
      schemaVersion: 1,
      eventBuffer: [],
      eventIdCounter: 2,
      runId: RUN_ID,
      r2SegmentIndex: 3,
      r2SegmentBuffer: [],
      r2LastFlushedSegmentIndex: 2,
      usageSegmentIndex: 2,
      usageSegmentBuffer: [],
      usageLastFlushedSegmentIndex: 1,
      emitDedupKeys: [],
    })),
    },
    { key: EVENT_KEY, path: "objects/events-000001.jsonl.gz", bytes: objectBytes },
    { key: "runs/" + RUN_ID + "/events/000002.jsonl.gz",
      path: "objects/events-000002.jsonl.gz", bytes: secondObjectBytes },
    { key: USAGE_KEY, path: "objects/usage-000001.jsonl.gz", bytes: usageBytes },
  ];
  const kv = [{ key: files[0]!.key, path: files[0]!.path, bytes: files[0]!.bytes.length,
    sha256: sha256(files[0]!.bytes) }];
  const objects = files.slice(1).map((file) => ({
    key: file.key,
    path: file.path,
    bytes: file.bytes.length,
    sha256: sha256(file.bytes),
    ...(file.key === USAGE_KEY ? { metadata: { httpMetadata: { contentType: "application/gzip" }, customMetadata: { witness: "retained" } } } : {}),
  }));
  const sqlWitness = { path: "sql/witness.bin", bytes: sqlBytes.length, sha256: sha256(sqlBytes) };
  for (const file of [...files.map(({ path, bytes }) => ({ path, bytes })), { path: sqlWitness.path, bytes: sqlBytes }]) {
    const absolute = join(inputDir, file.path);
    await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
    await writeFile(absolute, file.bytes, { mode: 0o600, flag: "wx" });
  }
  const inputManifest = new TextEncoder().encode(JSON.stringify({
    kind: "takos.run-archive-export@1",
    runId: RUN_ID,
    sourceCommit: SOURCE_COMMIT,
    kv,
    objects,
    sqlWitness,
  }, null, 2) + "\n");
  const inputPath = join(inputDir, "manifest.json");
  await writeFile(inputPath, inputManifest, { mode: 0o600, flag: "wx" });
  return {
    outer, inputDir, inputPath, inputBytes: inputManifest, inputSha256: sha256(inputManifest),
    objectBytes, usageBytes, sqlBytes, output: join(outer, "candidate"),
  };
}

async function cleanup(value: Fixture): Promise<void> {
  await rm(value.outer, { recursive: true, force: true });
}

async function expectPrivateSingleLink(path: string): Promise<void> {
  const info = await lstat(path, { bigint: true });
  expect(info.isFile()).toBe(true);
  expect(Number(info.mode & 0o777n)).toBe(0o600);
  expect(info.nlink).toBe(1n);
}

test("creates and verifies an isolated candidate while retaining exact source custody", async () => {
  const value = await fixture();
  try {
    const originalManifest = await readFile(value.inputPath);
    const originalObject = await readFile(join(value.inputDir, "objects/events-000001.jsonl.gz"));
    const originalUsage = await readFile(join(value.inputDir, "objects/usage-000001.jsonl.gz"));
    const originalSql = await readFile(join(value.inputDir, "sql/witness.bin"));
    for (const path of [
      value.inputPath,
      join(value.inputDir, "kv/buffer-state.json"),
      join(value.inputDir, "objects/events-000001.jsonl.gz"),
      join(value.inputDir, "objects/usage-000001.jsonl.gz"),
      join(value.inputDir, "sql/witness.bin"),
    ]) await expectPrivateSingleLink(path);

    const created = await createArchiveCandidate({
      input: value.inputPath,
      expectedInputSha256: value.inputSha256,
      output: value.output,
    });

    expect(created.status).toBe("verified-isolated-candidate");
    expect(created.authority).toMatchObject({
      namespace: "new-isolated-kv-and-object-store",
      inPlaceApply: false,
      deploymentQualified: false,
      historicalCompletenessProven: false,
      sqlReconciled: false,
      oldWritersQuiesced: false,
      otherInstanceDataIncluded: false,
    });
    const outputInfo = await lstat(value.output);
    expect(outputInfo.isDirectory()).toBe(true);
    expect(outputInfo.mode & 0o077).toBe(0);

    const manifestPath = join(value.output, "manifest.json");
    const manifestBytes = await readFile(manifestPath);
    expect(sha256(manifestBytes)).toBe(created.manifestSha256);
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    expect(manifest.kind).toBe("takos.run-archive-candidate@1");
    expect(manifest.sourceExportDigest).toBe(value.inputSha256);
    expect(manifest.sqlWitness).toEqual({
      path: "sql-witness.bin", bytes: value.sqlBytes.length, sha256: sha256(value.sqlBytes),
    });
    expect(await readFile(join(value.output, manifest.sqlWitness.path))).toEqual(Buffer.from(value.sqlBytes));

    const usage = manifest.objects.find((entry: { key: string }) => entry.key === USAGE_KEY);
    expect(usage.metadata).toEqual({
      httpMetadata: { contentType: "application/gzip" },
      customMetadata: { witness: "retained" },
    });
    expect(await readFile(join(value.output, usage.path))).toEqual(Buffer.from(value.usageBytes));

    const eventObject = manifest.objects.find((entry: { key: string }) => entry.key === EVENT_KEY);
    const convertedEventBytes = await readFile(join(value.output, eventObject.path));
    expect(eventObject.key).toBe(EVENT_KEY);
    expect(eventObject.sha256).toBe(sha256(convertedEventBytes));
    expect(eventObject.sha256).not.toBe(sha256(value.objectBytes));
    expect(convertedEventBytes).not.toEqual(value.objectBytes);

    await expectPrivateSingleLink(manifestPath);
    for (const entry of [...manifest.kv, ...manifest.objects, manifest.sqlWitness]) {
      await expectPrivateSingleLink(join(value.output, entry.path));
    }
    expect(await verifyArchiveCandidate({ manifest: manifestPath, expectedManifestSha256: created.manifestSha256 }))
      .toMatchObject({ status: "verified-isolated-candidate", manifestSha256: created.manifestSha256 });

    expect(await readFile(value.inputPath)).toEqual(originalManifest);
    expect(await readFile(join(value.inputDir, "objects/events-000001.jsonl.gz"))).toEqual(originalObject);
    expect(await readFile(join(value.inputDir, "objects/usage-000001.jsonl.gz"))).toEqual(originalUsage);
    expect(await readFile(join(value.inputDir, "sql/witness.bin"))).toEqual(originalSql);
    expect(sha256(await readFile(value.inputPath))).toBe(value.inputSha256);
  } finally {
    await cleanup(value);
  }
});

test("requires the caller-pinned source digest before creating output", async () => {
  const value = await fixture();
  try {
    await expect(createArchiveCandidate({ input: value.inputPath, expectedInputSha256: "0".repeat(64), output: value.output }))
      .rejects.toThrow("Caller-selected manifest digest mismatch");
    await expect(lstat(value.output)).rejects.toThrow();
  } finally {
    await cleanup(value);
  }
});

test("leaves a pre-existing output marker untouched and refuses output within source custody", async () => {
  const value = await fixture();
  try {
    await mkdir(value.output, { mode: 0o700 });
    const marker = join(value.output, "operator-owned.txt");
    await writeFile(marker, "keep me", { mode: 0o600 });
    await expect(createArchiveCandidate({ input: value.inputPath, expectedInputSha256: value.inputSha256, output: value.output }))
      .rejects.toThrow();
    expect(await readFile(marker, "utf8")).toBe("keep me");

    const inside = join(value.inputDir, "new-candidate");
    await expect(createArchiveCandidate({ input: value.inputPath, expectedInputSha256: value.inputSha256, output: inside }))
      .rejects.toThrow("Candidate output must be separate");
    await expect(lstat(inside)).rejects.toThrow();
  } finally {
    await cleanup(value);
  }
});

test("refuses an output parent with unsafe permissions before changing marker or source", async () => {
  const value = await fixture();
  try {
    const outputParent = join(value.outer, "operator-output-parent");
    await mkdir(outputParent, { mode: 0o700 });
    const marker = join(outputParent, "operator-marker.txt");
    await writeFile(marker, "leave this marker intact\n", { mode: 0o600 });
    await chmod(outputParent, 0o755);
    const sourceBefore = await readFile(value.inputPath);
    const objectBefore = await readFile(join(value.inputDir, "objects/events-000001.jsonl.gz"));
    const output = join(outputParent, "candidate");

    await expect(createArchiveCandidate({ input: value.inputPath, expectedInputSha256: value.inputSha256, output }))
      .rejects.toThrow();
    await expect(lstat(output)).rejects.toThrow();
    expect(await readFile(marker, "utf8")).toBe("leave this marker intact\n");
    expect(await readFile(value.inputPath)).toEqual(sourceBefore);
    expect(await readFile(join(value.inputDir, "objects/events-000001.jsonl.gz"))).toEqual(objectBefore);
  } finally {
    await cleanup(value);
  }
});

test("refuses a symlinked output parent without changing its target marker or source", async () => {
  const value = await fixture();
  try {
    const realParent = join(value.outer, "real-output-parent");
    const linkedParent = join(value.outer, "linked-output-parent");
    await mkdir(realParent, { mode: 0o700 });
    const marker = join(realParent, "operator-marker.txt");
    await writeFile(marker, "leave symlink target intact\n", { mode: 0o600 });
    await symlink(realParent, linkedParent);
    const sourceBefore = await readFile(value.inputPath);
    const output = join(linkedParent, "candidate");

    await expect(createArchiveCandidate({ input: value.inputPath, expectedInputSha256: value.inputSha256, output }))
      .rejects.toThrow();
    await expect(lstat(output)).rejects.toThrow();
    expect(await readFile(marker, "utf8")).toBe("leave symlink target intact\n");
    expect(await readFile(value.inputPath)).toEqual(sourceBefore);
  } finally {
    await cleanup(value);
  }
});

test("rejects symlinked and hardlinked source custody files", async () => {
  for (const linked of ["symlink", "hardlink"] as const) {
    const value = await fixture();
    try {
      const source = join(value.inputDir, "objects/events-000001.jsonl.gz");
      const held = join(value.outer, "held-object.gz");
      await writeFile(held, await readFile(source), { mode: 0o600 });
      await rm(source);
      if (linked === "symlink") await symlink(held, source);
      else await link(held, source);
      await expect(createArchiveCandidate({ input: value.inputPath, expectedInputSha256: value.inputSha256, output: value.output }))
        .rejects.toThrow();
      await expect(lstat(value.output)).rejects.toThrow();
    } finally {
      await cleanup(value);
    }
  }
});

test("rejects path traversal and duplicate catalog keys before materializing a candidate", async () => {
  for (const mutate of ["escape", "duplicate-key"] as const) {
    const value = await fixture();
    try {
      const raw = JSON.parse((await readFile(value.inputPath)).toString("utf8"));
      if (mutate === "escape") raw.kv[0].path = "../outside.json";
      else raw.objects[1].key = raw.objects[0].key;
      const bytes = Buffer.from(JSON.stringify(raw) + "\n");
      await writeFile(value.inputPath, bytes, { mode: 0o600 });
      await expect(createArchiveCandidate({ input: value.inputPath, expectedInputSha256: sha256(bytes), output: value.output }))
        .rejects.toThrow();
      await expect(lstat(value.output)).rejects.toThrow();
    } finally {
      await cleanup(value);
    }
  }
});

test("does not seal a manifest when an inventoried R2 object fails its digest", async () => {
  const value = await fixture();
  try {
    const objectPath = join(value.inputDir, "objects/events-000001.jsonl.gz");
    const damaged = Buffer.from(value.objectBytes);
    damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 1;
    await writeFile(objectPath, damaged, { mode: 0o600 });
    await expect(createArchiveCandidate({ input: value.inputPath, expectedInputSha256: value.inputSha256, output: value.output }))
      .rejects.toThrow("Archive custody file digest mismatch");
    await expect(lstat(join(value.output, "manifest.json"))).rejects.toThrow();
  } finally {
    await cleanup(value);
  }
});

test("verifier rejects a modified manifest body and a stale caller-selected digest", async () => {
  const value = await fixture();
  try {
    const created = await createArchiveCandidate({ input: value.inputPath, expectedInputSha256: value.inputSha256, output: value.output });
    const manifestPath = join(value.output, "manifest.json");
    const original = await readFile(manifestPath);
    await expect(verifyArchiveCandidate({ manifest: manifestPath, expectedManifestSha256: "0".repeat(64) }))
      .rejects.toThrow("Caller-selected manifest digest mismatch");

    const changed = Buffer.from(original.toString("utf8").replace('"inPlaceApply": false', '"inPlaceApply": true'));
    expect(changed).not.toEqual(original);
    await writeFile(manifestPath, changed, { mode: 0o600 });
    await expect(verifyArchiveCandidate({ manifest: manifestPath, expectedManifestSha256: created.manifestSha256 }))
      .rejects.toThrow("Caller-selected manifest digest mismatch");

    await expect(verifyArchiveCandidate({ manifest: manifestPath, expectedManifestSha256: sha256(changed) }))
      .rejects.toThrow("Candidate has an invalid source digest or authority boundary");
  } finally {
    await cleanup(value);
  }
});

test("CLI refuses an unrecognized production apply argument", () => {
  const result = spawnSync(process.execPath, [join(import.meta.dir, "run-archive-candidate.ts"), "--apply"], {
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Invalid archive candidate arguments");
});
