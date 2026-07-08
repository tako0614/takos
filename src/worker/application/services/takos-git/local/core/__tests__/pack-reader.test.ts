import { test } from "bun:test";
import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "@takos/test/assert";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { zlibSync } from "fflate";

import { inflateRawAt, inflateZlibAt } from "../inflate-raw.ts";
import { applyDelta, readPack, type UnpackedObject } from "../pack-reader.ts";
import { concatBytes, hexToBytes, sha1 } from "../sha1.ts";
import { hashObject } from "../object.ts";
import { deflate } from "../object-store.ts";
import { encodePackObjectHeader } from "../pack-common.ts";

// --- helpers ---------------------------------------------------------------

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function gitAvailable(): boolean {
  try {
    return Bun.spawnSync(["git", "--version"]).exitCode === 0;
  } catch {
    return false;
  }
}

function runGit(cwd: string, args: string[]): Uint8Array {
  const res = Bun.spawnSync(
    [
      "git",
      "-c",
      "user.name=Pack Test",
      "-c",
      "user.email=pack@test.local",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "gc.auto=0",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  if (res.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${res.exitCode})\n${res.stderr.toString()}`,
    );
  }
  return new Uint8Array(res.stdout);
}

/** Raw object content as git stores it (no `"<type> <size>\0"` header). */
function catFileContent(cwd: string, type: string, sha: string): Uint8Array {
  return runGit(cwd, ["cat-file", type, sha]);
}

function catFileType(cwd: string, sha: string): string {
  return new TextDecoder().decode(runGit(cwd, ["cat-file", "-t", sha])).trim();
}

/**
 * Build a valid v2 packfile from a mix of full objects and REF_DELTA entries,
 * so the REF_DELTA / thin-pack / chain paths can be exercised deterministically
 * without relying on git's delta heuristics.
 */
type PackInput =
  | { kind: "full"; type: number; content: Uint8Array }
  | { kind: "ref"; baseSha: string; delta: Uint8Array };

async function buildPack(inputs: PackInput[]): Promise<Uint8Array> {
  const header = new Uint8Array(12);
  header.set([0x50, 0x41, 0x43, 0x4b], 0); // "PACK"
  new DataView(header.buffer).setUint32(4, 2, false);
  new DataView(header.buffer).setUint32(8, inputs.length, false);

  const chunks: Uint8Array[] = [header];
  for (const input of inputs) {
    if (input.kind === "full") {
      chunks.push(encodePackObjectHeader(input.type, input.content.length));
      chunks.push(await deflate(input.content));
    } else {
      chunks.push(encodePackObjectHeader(7, input.delta.length)); // REF_DELTA
      chunks.push(hexToBytes(input.baseSha));
      chunks.push(await deflate(input.delta));
    }
  }
  const body = concatBytes(...chunks);
  const trailer = hexToBytes(await sha1(body));
  return concatBytes(body, trailer);
}

/** Encode a git delta (little-endian size varints + copy/insert opcodes). */
function encodeDelta(
  srcSize: number,
  targetSize: number,
  ops: Array<
    | { copy: { offset: number; size: number } }
    | { insert: Uint8Array }
  >,
): Uint8Array {
  const out: number[] = [];
  const pushVarint = (n: number) => {
    do {
      let b = n & 0x7f;
      n = Math.floor(n / 128);
      if (n > 0) b |= 0x80;
      out.push(b);
    } while (n > 0);
  };
  pushVarint(srcSize);
  pushVarint(targetSize);
  for (const op of ops) {
    if ("copy" in op) {
      const { offset, size } = op.copy;
      let cmd = 0x80;
      const tail: number[] = [];
      const offBytes = [offset & 0xff, (offset >> 8) & 0xff, (offset >> 16) & 0xff, (offset >> 24) & 0xff];
      for (let i = 0; i < 4; i++) {
        if (offBytes[i] !== 0) {
          cmd |= 1 << i;
          tail.push(offBytes[i]);
        }
      }
      const szBytes = [size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff];
      for (let i = 0; i < 3; i++) {
        if (szBytes[i] !== 0) {
          cmd |= 1 << (4 + i);
          tail.push(szBytes[i]);
        }
      }
      out.push(cmd, ...tail);
    } else {
      const data = op.insert;
      if (data.length === 0 || data.length > 127) {
        throw new Error("insert length must be 1..127");
      }
      out.push(data.length, ...data);
    }
  }
  return new Uint8Array(out);
}

// --- inflate: output correctness vs fflate ---------------------------------

test("inflateZlibAt output matches fflate across sizes", () => {
  const cases: Uint8Array[] = [
    new Uint8Array(0),
    new Uint8Array([0x42]),
    (() => {
      const b = new Uint8Array(4096);
      crypto.getRandomValues(b);
      return b;
    })(),
    new Uint8Array(9000).fill(0x41), // highly compressible run
    (() => {
      const b = new Uint8Array(20000);
      for (let i = 0; i < b.length; i++) b[i] = (i * 31 + (i >> 3)) & 0xff;
      return b;
    })(),
  ];

  for (const original of cases) {
    for (const level of [0, 1, 6, 9] as const) {
      const compressed = zlibSync(original, { level });
      const { output, bytesConsumed } = inflateZlibAt(compressed, 0);
      assert(bytesEqual(output, original), `output mismatch (level ${level})`);
      assertEquals(bytesConsumed, compressed.length, `consumed mismatch (level ${level})`);
    }
  }
});

test("inflateRawAt bytesConsumed is exact for two concatenated zlib streams", () => {
  const first = new Uint8Array(1500);
  crypto.getRandomValues(first);
  const second = new TextEncoder().encode("second stream ".repeat(400));

  const s1 = zlibSync(first, { level: 6 });
  const s2 = zlibSync(second, { level: 9 });
  const combined = concatBytes(s1, s2);

  const r1 = inflateZlibAt(combined, 0);
  assert(bytesEqual(r1.output, first));
  assertEquals(r1.bytesConsumed, s1.length);

  const r2 = inflateZlibAt(combined, r1.bytesConsumed);
  assert(bytesEqual(r2.output, second));
  assertEquals(r2.bytesConsumed, s2.length);
  assertEquals(r1.bytesConsumed + r2.bytesConsumed, combined.length);
});

test("inflateRawAt round-trips fflate raw output start offset", () => {
  // A zlib stream embedded after arbitrary prefix bytes.
  const payload = new TextEncoder().encode("offset test payload ".repeat(50));
  const stream = zlibSync(payload, { level: 6 });
  const prefix = new Uint8Array([1, 2, 3, 4, 5]);
  const combined = concatBytes(prefix, stream);
  const { output, bytesConsumed } = inflateZlibAt(combined, prefix.length);
  assert(bytesEqual(output, payload));
  assertEquals(bytesConsumed, stream.length);
});

test("inflateZlibAt rejects a bad zlib header", () => {
  assertThrows(() => inflateRawAt(new Uint8Array([0xff, 0xff, 0xff]), 0));
  assertThrows(() => inflateZlibAt(new Uint8Array([0x00, 0x00]), 0));
});

// --- applyDelta unit tests -------------------------------------------------

test("applyDelta reconstructs via copy + insert", () => {
  const base = new TextEncoder().encode("Hello, brave new world!");
  // target = "Hello, " + "cruel " + "world!"
  const insert = new TextEncoder().encode("cruel ");
  const targetStr = "Hello, cruel world!";
  const delta = encodeDelta(base.length, targetStr.length, [
    { copy: { offset: 0, size: 7 } }, // "Hello, "
    { insert },
    { copy: { offset: base.length - 6, size: 6 } }, // "world!"
  ]);
  const out = applyDelta(base, delta);
  assertEquals(new TextDecoder().decode(out), targetStr);
});

test("applyDelta handles size-0 copy meaning 0x10000", () => {
  const base = new Uint8Array(0x10000 + 10).fill(0x7a);
  for (let i = 0; i < 10; i++) base[0x10000 + i] = 0x30 + i;
  const delta = encodeDelta(base.length, 0x10000, [
    { copy: { offset: 0, size: 0 } }, // size 0 => 65536
  ]);
  const out = applyDelta(base, delta);
  assertEquals(out.length, 0x10000);
  assert(bytesEqual(out, base.subarray(0, 0x10000)));
});

test("applyDelta rejects source-size mismatch", () => {
  const base = new Uint8Array([1, 2, 3]);
  const delta = encodeDelta(99, 3, [{ insert: new Uint8Array([1, 2, 3]) }]);
  assertThrows(() => applyDelta(base, delta), "source size");
});

test("applyDelta rejects target-size mismatch", () => {
  const base = new Uint8Array([1, 2, 3, 4]);
  const delta = encodeDelta(4, 999, [{ copy: { offset: 0, size: 4 } }]);
  assertThrows(() => applyDelta(base, delta));
});

// --- pack header validation ------------------------------------------------

test("readPack rejects bad magic and version", async () => {
  const bad = new Uint8Array(12);
  bad.set([0x4e, 0x4f, 0x50, 0x45], 0); // "NOPE"
  await assertRejects(() => readPack(bad), "magic");

  const wrongVersion = new Uint8Array(12);
  wrongVersion.set([0x50, 0x41, 0x43, 0x4b], 0);
  new DataView(wrongVersion.buffer).setUint32(4, 3, false);
  await assertRejects(() => readPack(wrongVersion), "version");
});

// --- hand-built REF_DELTA, chains, and thin packs --------------------------

test("readPack resolves an in-pack REF_DELTA", async () => {
  const base = new TextEncoder().encode("the quick brown fox jumps over the lazy dog\n");
  const baseSha = await hashObject("blob", base);
  const targetStr = "the quick red fox jumps over the lazy dog\n";
  const insert = new TextEncoder().encode("red");
  const delta = encodeDelta(base.length, targetStr.length, [
    { copy: { offset: 0, size: 10 } }, // "the quick "
    { insert },
    { copy: { offset: 15, size: base.length - 15 } }, // " fox ... dog\n"
  ]);

  const pack = await buildPack([
    { kind: "full", type: 3, content: base },
    { kind: "ref", baseSha, delta },
  ]);

  const objects = await readPack(pack);
  assertEquals(objects.length, 2);
  const target = objects.find((o) => o.sha !== baseSha)!;
  assertEquals(target.type, "blob");
  assertEquals(new TextDecoder().decode(target.content), targetStr);
  assertEquals(target.sha, await hashObject("blob", target.content));
});

test("readPack resolves a delta-on-delta chain", async () => {
  const base = new TextEncoder().encode("A".repeat(200));
  const baseSha = await hashObject("blob", base);

  const mid = new TextEncoder().encode("A".repeat(200) + "-mid");
  const midSha = await hashObject("blob", mid);
  const delta1 = encodeDelta(base.length, mid.length, [
    { copy: { offset: 0, size: base.length } },
    { insert: new TextEncoder().encode("-mid") },
  ]);

  const finalStr = "A".repeat(200) + "-mid-final";
  const delta2 = encodeDelta(mid.length, finalStr.length, [
    { copy: { offset: 0, size: mid.length } },
    { insert: new TextEncoder().encode("-final") },
  ]);

  const pack = await buildPack([
    { kind: "full", type: 3, content: base },
    { kind: "ref", baseSha, delta: delta1 },
    { kind: "ref", baseSha: midSha, delta: delta2 },
  ]);

  const objects = await readPack(pack);
  assertEquals(objects.length, 3);
  const finalObj = objects.find(
    (o) => new TextDecoder().decode(o.content) === finalStr,
  )!;
  assert(finalObj !== undefined, "chain final object present");
  assertEquals(finalObj.type, "blob");
  assertEquals(finalObj.sha, await hashObject("blob", finalObj.content));
});

test("readPack resolves a thin-pack REF_DELTA via resolveExternalBase", async () => {
  const base = new TextEncoder().encode("external base content ".repeat(30));
  const baseSha = await hashObject("blob", base);
  const targetStr = "EXTERNAL base content " + "external base content ".repeat(29);
  const delta = encodeDelta(base.length, targetStr.length, [
    { insert: new TextEncoder().encode("EXTERNAL") },
    { copy: { offset: 8, size: base.length - 8 } },
  ]);

  // Thin pack: the base object is NOT in the pack.
  const pack = await buildPack([{ kind: "ref", baseSha, delta }]);

  let asked: string | null = null;
  const objects = await readPack(pack, {
    resolveExternalBase: async (sha) => {
      asked = sha;
      return sha === baseSha ? base : null;
    },
  });

  assertEquals(asked, baseSha);
  assertEquals(objects.length, 1);
  assertEquals(objects[0].type, "blob");
  assertEquals(new TextDecoder().decode(objects[0].content), targetStr);
  assertEquals(objects[0].sha, await hashObject("blob", objects[0].content));
});

test("readPack throws on a thin pack with no resolver", async () => {
  const base = new TextEncoder().encode("no resolver base");
  const baseSha = await hashObject("blob", base);
  const delta = encodeDelta(base.length, base.length, [
    { copy: { offset: 0, size: base.length } },
  ]);
  const pack = await buildPack([{ kind: "ref", baseSha, delta }]);
  await assertRejects(() => readPack(pack), "not in pack");
});

// --- real git round trips --------------------------------------------------

const GIT = gitAvailable();

function mkRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pack-reader-"));
  runGit(dir, ["init", "-q"]);
  return dir;
}

async function verifyAgainstRepo(
  repo: string,
  objects: UnpackedObject[],
): Promise<void> {
  for (const obj of objects) {
    // sha must exist in the repo, its type must match, and the raw content
    // must be byte-identical to what git stores.
    const type = catFileType(repo, obj.sha);
    assertEquals(type, obj.type, `type for ${obj.sha}`);
    const content = catFileContent(repo, obj.type, obj.sha);
    assert(bytesEqual(content, obj.content), `content mismatch for ${obj.sha}`);
    // Independently recompute the git object id.
    assertEquals(await hashObject(obj.type, obj.content), obj.sha);
  }
}

test("readPack unpacks a real git pack (blobs, trees, commits)", async () => {
  if (!GIT) return;
  const repo = mkRepo();
  try {
    writeFileSync(join(repo, "a.txt"), "first file\n");
    writeFileSync(join(repo, "b.txt"), "second file\n");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-q", "-m", "c1"]);

    writeFileSync(join(repo, "a.txt"), "first file, edited\n");
    mkdirSync(join(repo, "c"), { recursive: true });
    writeFileSync(join(repo, "c/deep.txt"), "nested\n"); // new subtree
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-q", "-m", "c2"]);

    writeFileSync(join(repo, "b.txt"), "second file, edited\n");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-q", "-m", "c3"]);

    // Undeltified full pack of every reachable object.
    const revList = runGit(repo, ["rev-list", "--objects", "--all"]);
    const expectedShas = new Set(
      new TextDecoder()
        .decode(revList)
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => l.split(" ")[0]),
    );

    const res = Bun.spawnSync(
      ["git", "pack-objects", "--stdout"],
      { cwd: repo, stdin: revList, stdout: "pipe", stderr: "pipe" },
    );
    if (res.exitCode !== 0) {
      throw new Error(`pack-objects failed: ${res.stderr.toString()}`);
    }
    const pack = new Uint8Array(res.stdout);

    const objects = await readPack(pack);
    assertEquals(objects.length, expectedShas.size);
    const gotShas = new Set(objects.map((o) => o.sha));
    assertEquals(gotShas, expectedShas);
    await verifyAgainstRepo(repo, objects);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("readPack resolves OFS_DELTA from a repacked (deltified) pack", async () => {
  if (!GIT) return;
  const repo = mkRepo();
  try {
    const big = Array.from({ length: 600 }, (_, i) => `line ${i} lorem ipsum dolor sit amet\n`).join("");
    writeFileSync(join(repo, "big.txt"), big);
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-q", "-m", "v1"]);

    const edited = big.replace("line 5 ", "line 5 CHANGED ").replace("line 400 ", "line 400 CHANGED ");
    writeFileSync(join(repo, "big.txt"), edited);
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-q", "-m", "v2"]);

    // Force delta compression into a single pack, then read it from disk.
    runGit(repo, ["repack", "-a", "-d", "-f", "--window=250", "--depth=250"]);

    const packDir = join(repo, ".git", "objects", "pack");
    const packName = readdirSync(packDir).find((f) => f.endsWith(".pack"));
    assert(packName !== undefined, "a .pack file exists after repack");
    const idxName = packName!.replace(/\.pack$/, ".idx");

    // Confirm the pack actually contains deltas (chain length line present).
    const verify = new TextDecoder().decode(
      runGit(repo, ["verify-pack", "-v", join(packDir, idxName)]),
    );
    assert(verify.includes("chain length"), "repack produced delta chains");

    const pack = new Uint8Array(readFileSync(join(packDir, packName!)));
    const objects = await readPack(pack);
    assert(objects.length >= 6, "expected commits + trees + blobs");
    await verifyAgainstRepo(repo, objects);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("readPack resolves a real thin pack via resolveExternalBase", async () => {
  if (!GIT) return;
  const repo = mkRepo();
  try {
    const big = Array.from({ length: 800 }, (_, i) => `row ${i} the five boxing wizards jump quickly\n`).join("");
    writeFileSync(join(repo, "data.txt"), big);
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-q", "-m", "base"]);
    const oldTip = new TextDecoder().decode(runGit(repo, ["rev-parse", "HEAD"])).trim();

    const edited = big.replace("row 10 ", "row 10 EDITED ");
    writeFileSync(join(repo, "data.txt"), edited);
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-q", "-m", "next"]);
    const newTip = new TextDecoder().decode(runGit(repo, ["rev-parse", "HEAD"])).trim();

    // Objects reachable from newTip but not oldTip; --thin lets pack-objects
    // emit REF_DELTA against objects reachable from oldTip (external bases).
    const revs = new TextEncoder().encode(`${newTip}\n^${oldTip}\n`);
    const res = Bun.spawnSync(
      ["git", "pack-objects", "--thin", "--stdout", "--revs", "--delta-base-offset"],
      { cwd: repo, stdin: revs, stdout: "pipe", stderr: "pipe" },
    );
    if (res.exitCode !== 0) {
      throw new Error(`thin pack-objects failed: ${res.stderr.toString()}`);
    }
    const pack = new Uint8Array(res.stdout);

    let externalCalls = 0;
    const objects = await readPack(pack, {
      resolveExternalBase: async (sha) => {
        externalCalls++;
        const type = catFileType(repo, sha);
        return catFileContent(repo, type, sha);
      },
    });

    // The pack must be non-empty and every object must validate against the repo.
    assert(objects.length >= 1, "thin pack has objects");
    await verifyAgainstRepo(repo, objects);
    // A thin pack of a single-line edit to a large file should reference an
    // external base at least once.
    assert(externalCalls >= 1, "resolveExternalBase was exercised (thin pack)");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
