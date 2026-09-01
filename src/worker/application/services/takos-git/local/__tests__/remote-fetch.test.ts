import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createInMemoryObjectStore } from "../../../../../local-platform/in-memory-r2.ts";
import {
  getObject,
  getRawObject,
  putBlob,
  putCommit,
  putTree,
} from "../core/object-store.ts";
import { writePack } from "../core/pack.ts";
import {
  pktLineString,
  PKT_FLUSH,
} from "../core/pack-common.ts";
import { concatBytes } from "../core/sha1.ts";
import {
  fetchRemoteRepository,
  ingestObjects,
} from "../remote-fetch.ts";

function bytesToBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

describe("worker-native remote fetch client", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  let baseUrl = "";
  let blobSha = "";
  let treeSha = "";
  let commitSha = "";
  const requests: Array<{ method: string; pathname: string }> = [];

  beforeAll(async () => {
    const source = createInMemoryObjectStore();
    blobSha = await putBlob(
      source,
      new TextEncoder().encode("remote hi\n"),
    );
    treeSha = await putTree(source, [
      { mode: "100644", name: "README.md", sha: blobSha },
    ]);
    commitSha = await putCommit(source, {
      tree: treeSha,
      parents: [],
      author: {
        name: "T",
        email: "t@e.com",
        timestamp: 1700000000,
        tzOffset: "+0000",
      },
      committer: {
        name: "T",
        email: "t@e.com",
        timestamp: 1700000000,
        tzOffset: "+0000",
      },
      message: "init\n",
    });

    const objects = await Promise.all(
      [blobSha, treeSha, commitSha].map((sha) => getObject(source, sha)),
    );
    if (objects.some((object) => object === null)) {
      throw new Error("synthetic remote fixture is incomplete");
    }
    const pack = await writePack(
      objects.map((object) => ({
        type: object!.type,
        content: object!.content,
      })),
    );
    const advertisement = concatBytes(
      pktLineString("# service=git-upload-pack\n"),
      PKT_FLUSH,
      pktLineString(
        `${commitSha} HEAD\0symref=HEAD:refs/heads/main object-format=sha1\n`,
      ),
      pktLineString(`${commitSha} refs/heads/main\n`),
      PKT_FLUSH,
    );
    const uploadPackResponse = concatBytes(pktLineString("NAK\n"), pack);

    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        const url = new URL(request.url);
        requests.push({ method: request.method, pathname: url.pathname });

        if (
          request.method === "GET" &&
          url.pathname === "/git/alice/demo.git/info/refs" &&
          url.searchParams.get("service") === "git-upload-pack"
        ) {
          return new Response(bytesToBody(advertisement), {
            headers: {
              "content-type":
                "application/x-git-upload-pack-advertisement",
            },
          });
        }

        if (
          request.method === "POST" &&
          url.pathname === "/git/alice/demo.git/git-upload-pack"
        ) {
          const body = new TextDecoder().decode(await request.arrayBuffer());
          if (!body.includes(`want ${commitSha}`)) {
            return new Response("missing fixture want", { status: 400 });
          }
          return new Response(bytesToBody(uploadPackResponse), {
            headers: {
              "content-type": "application/x-git-upload-pack-result",
            },
          });
        }

        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://127.0.0.1:${server.port}/git/alice/demo.git`;
  });

  afterAll(() => {
    server?.stop(true);
  });

  test("parses refs, unpacks a synthetic remote pack, and ingests objects", async () => {
    const result = await fetchRemoteRepository({
      url: baseUrl,
      allowPrivateHosts: true,
    });

    expect(result.defaultBranch).toBe("main");
    expect(result.refs).toEqual([
      { name: "refs/heads/main", target: commitSha },
    ]);
    expect(new Set(result.objects.map((object) => object.sha))).toEqual(
      new Set([blobSha, treeSha, commitSha]),
    );
    expect(requests).toEqual([
      { method: "GET", pathname: "/git/alice/demo.git/info/refs" },
      { method: "POST", pathname: "/git/alice/demo.git/git-upload-pack" },
    ]);

    const destination = createInMemoryObjectStore();
    const written = await ingestObjects(destination, result.objects);
    expect(written).toBe(result.objects.length);
    const rawBlob = await getRawObject(destination, blobSha);
    expect(rawBlob).not.toBeNull();
    expect(new TextDecoder().decode(rawBlob!)).toContain("remote hi\n");
  });

  test("rejects private/loopback IP-literal hosts (SSRF guard)", async () => {
    await expect(
      fetchRemoteRepository({ url: "http://127.0.0.1:1/git/x/y.git" }),
    ).rejects.toThrow(/private|loopback|blocked/i);
  });
});
