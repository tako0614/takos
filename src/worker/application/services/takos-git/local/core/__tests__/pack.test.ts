import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writePack } from "../pack.ts";
import {
  encodeCommitContent,
  encodeTreeContent,
  hashCommit,
  hashObject,
} from "../object.ts";
import { encodePackObjectHeader, parsePktLines, pktLineString } from "../pack-common.ts";
import type { GitSignature } from "../../git-objects.ts";

function gitAvailable(): boolean {
  const r = spawnSync("git", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

const HAS_GIT = gitAvailable();
const sig: GitSignature = {
  name: "Takos Test",
  email: "test@example.com",
  timestamp: 1700000000,
  tzOffset: "+0000",
};

describe("pack-common encoding", () => {
  test("object header round-trips type and size bits", () => {
    // blob (3) size 5 -> single byte: (3<<4)|5 = 0x35
    expect(Array.from(encodePackObjectHeader(3, 5))).toEqual([0x35]);
    // size spilling into continuation bytes
    const h = encodePackObjectHeader(2, 0x1234);
    expect(h[0] & 0x80).toBe(0x80); // continuation set
    expect((h[0] >> 4) & 0x07).toBe(2); // type preserved
  });

  test("pkt-line framing and parse", () => {
    const line = pktLineString("want abc\n");
    // "want abc\n" is 9 bytes + 4 header = 13 = 0x000d
    expect(new TextDecoder().decode(line.subarray(0, 4))).toBe("000d");
    const parsed = parsePktLines(line);
    expect(parsed).toHaveLength(1);
    expect(new TextDecoder().decode(parsed[0].payload!)).toBe("want abc\n");
  });

  test("parses flush-pkt as null payload", () => {
    const parsed = parsePktLines(new TextEncoder().encode("0000"));
    expect(parsed).toEqual([{ payload: null }]);
  });
});

describe("writePack (validated against real git)", () => {
  let dir = "";

  beforeAll(() => {
    if (!HAS_GIT) return;
    dir = mkdtempSync(join(tmpdir(), "takos-pack-"));
    spawnSync("git", ["init", "-q", dir], { stdio: "ignore" });
    spawnSync("git", ["-C", dir, "config", "user.email", "t@e.com"]);
    spawnSync("git", ["-C", dir, "config", "user.name", "t"]);
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("git unpack-objects accepts the pack and SHAs match git's", async () => {
    if (!HAS_GIT) {
      console.warn("git not available; skipping real-git pack validation");
      return;
    }

    const blobContent = new TextEncoder().encode("hello from takos pack\n");
    const blobSha = await hashObject("blob", blobContent);

    const treeEntries = [
      { mode: "100644", name: "hello.txt", sha: blobSha },
    ];
    const treeContent = encodeTreeContent(treeEntries);
    const treeSha = await hashObject("tree", treeContent);

    const commit = {
      tree: treeSha,
      parents: [] as string[],
      author: sig,
      committer: sig,
      message: "initial\n",
    };
    const commitContent = encodeCommitContent(commit);
    const commitSha = await hashCommit(commit);

    const pack = await writePack([
      { type: "blob", content: blobContent },
      { type: "tree", content: treeContent },
      { type: "commit", content: commitContent },
    ]);

    const packPath = join(dir, "takos.pack");
    writeFileSync(packPath, pack);

    // git unpack-objects reads a pack from stdin, recomputes every object id,
    // and stores loose objects. If our encoding or SHA differs from git's, the
    // subsequent cat-file lookups by our SHA fail.
    const unpack = spawnSync("git", ["-C", dir, "unpack-objects", "-q"], {
      input: pack,
    });
    expect(unpack.status).toBe(0);

    const catBlob = spawnSync("git", ["-C", dir, "cat-file", "-p", blobSha]);
    expect(catBlob.status).toBe(0);
    expect(catBlob.stdout.toString()).toBe("hello from takos pack\n");

    const typeCommit = spawnSync("git", ["-C", dir, "cat-file", "-t", commitSha]);
    expect(typeCommit.stdout.toString().trim()).toBe("commit");

    const lsTree = spawnSync("git", ["-C", dir, "ls-tree", treeSha]);
    expect(lsTree.stdout.toString()).toContain("hello.txt");
  });

  test("git index-pack verifies the pack trailer and structure", async () => {
    if (!HAS_GIT) return;

    const blobContent = new TextEncoder().encode("second object set\n");
    const blobSha = await hashObject("blob", blobContent);
    const treeContent = encodeTreeContent([
      { mode: "100644", name: "a", sha: blobSha },
    ]);

    const pack = await writePack([
      { type: "blob", content: blobContent },
      { type: "tree", content: treeContent },
    ]);

    const packPath = join(dir, "verify.pack");
    writeFileSync(packPath, pack);
    // index-pack validates the SHA-1 trailer and every object header/zlib stream.
    const idx = spawnSync("git", ["index-pack", "-v", packPath], {
      cwd: dir,
      stdio: "ignore",
    });
    expect(idx.status).toBe(0);
  });
});
