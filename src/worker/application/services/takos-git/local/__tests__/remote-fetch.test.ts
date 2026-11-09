import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryObjectStore } from "../../../../../local-platform/in-memory-r2.ts";
import { getRawObject } from "../core/object-store.ts";
import { fetchRemoteRepository, ingestObjects } from "../remote-fetch.ts";

const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_DATE: "2023-11-14T22:13:20Z",
  GIT_COMMITTER_DATE: "2023-11-14T22:13:20Z",
};

function git(args: string[]): string {
  const result = spawnSync("git", args, { env: gitEnv, encoding: "utf8" });
  if (result.status !== 0) throw Error("git fixture failed: " + result.stderr);
  return result.stdout.trim();
}

function seedServer() {
  const root = mkdtempSync(join(tmpdir(), "takos-remote-reference-"));
  const seed = join(root, "seed");
  git(["init", "-q", "-b", "main", seed]);
  git(["-C", seed, "config", "user.name", "T"]);
  git(["-C", seed, "config", "user.email", "t@example.invalid"]);
  writeFileSync(join(seed, "README.md"), "remote hi\n");
  git(["-C", seed, "add", "README.md"]);
  git(["-C", seed, "commit", "-q", "-m", "init"]);
  git(["clone", "--bare", "-q", seed, join(root, "demo.git")]);
  return {
    root,
    commitSha: git(["-C", seed, "rev-parse", "HEAD"]),
    treeSha: git(["-C", seed, "rev-parse", "HEAD^{tree}"]),
    blobSha: git(["-C", seed, "rev-parse", "HEAD:README.md"]),
  };
}

// Exercise the actual smart-HTTP client against standard Git's CGI backend,
// rather than reopening Takos's retired Worker-native hosting route.
async function gitHttpBackend(request: Request, root: string): Promise<Response> {
  const url = new URL(request.url);
  const body = new Uint8Array(await request.arrayBuffer());
  const proc = Bun.spawn(["git", "http-backend"], {
    env: {
      ...gitEnv,
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: "1",
      PATH_INFO: url.pathname,
      QUERY_STRING: url.search.slice(1),
      REQUEST_METHOD: request.method,
      CONTENT_TYPE: request.headers.get("Content-Type") ?? "",
      CONTENT_LENGTH: String(body.byteLength),
      HTTP_GIT_PROTOCOL: request.headers.get("Git-Protocol") ?? "",
      HTTP_CONTENT_ENCODING: request.headers.get("Content-Encoding") ?? "",
      REMOTE_ADDR: "127.0.0.1",
    },
    stdin: body,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, stderr, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw Error("git http-backend failed: " + stderr);
  const bytes = Buffer.from(output);
  const split = bytes.indexOf("\r\n\r\n");
  if (split < 0) throw Error("git http-backend omitted CGI headers");
  const headers = new Headers();
  let status = 200;
  for (const line of bytes.subarray(0, split).toString("utf8").split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) throw Error("invalid CGI header");
    const name = line.slice(0, colon);
    const value = line.slice(colon + 1).trim();
    if (name.toLowerCase() === "status") status = Number.parseInt(value, 10);
    else headers.append(name, value);
  }
  return new Response(bytes.subarray(split + 4), { status, headers });
}

describe("worker-native remote fetch (loopback against standard Git)", () => {
  let seeded: ReturnType<typeof seedServer>;
  let server: ReturnType<typeof Bun.serve> | null = null;
  let baseUrl = "";

  beforeAll(() => {
    seeded = seedServer();
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) => gitHttpBackend(request, seeded.root),
    });
    baseUrl = `http://127.0.0.1:${server.port}/demo.git`;
  });

  afterAll(() => {
    server?.stop(true);
    if (seeded) rmSync(seeded.root, { recursive: true, force: true });
  });

  test("real git clone over HTTP against the standard Git backend", async () => {
    const dir = mkdtempSync(join(tmpdir(), "takos-httpclone-"));
    try {
      // Use async Bun.spawn (not spawnSync): the serve route runs in THIS
      // process's event loop, so a blocking spawnSync would deadlock (git waits
      // on the server, the server can't run while the loop is blocked).
      const proc = Bun.spawn(["git", "clone", "-q", baseUrl, dir], {
        env: gitEnv,
        stderr: "pipe",
      });
      const timer = setTimeout(() => proc.kill(), 15000);
      const code = await proc.exited;
      clearTimeout(timer);
      if (code !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`git clone failed (code=${code}): ${stderr}`);
      }
      expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("remote hi\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fetchRemoteRepository parses refs and unpacks objects", async () => {
    const result = await fetchRemoteRepository({
      url: baseUrl,
      allowPrivateHosts: true,
    });

    expect(result.defaultBranch).toBe("main");
    expect(result.refs).toEqual([
      { name: "refs/heads/main", target: seeded.commitSha },
    ]);

    const shas = new Set(result.objects.map((o) => o.sha));
    expect(shas.has(seeded.commitSha)).toBe(true);
    expect(shas.has(seeded.treeSha)).toBe(true);
    expect(shas.has(seeded.blobSha)).toBe(true);

    // Ingest into a fresh store and confirm the blob is retrievable.
    const dest = createInMemoryObjectStore();
    const written = await ingestObjects(dest, result.objects);
    expect(written).toBe(result.objects.length);
    const raw = await getRawObject(dest, seeded.blobSha);
    expect(raw).not.toBeNull();
    expect(new TextDecoder().decode(raw!)).toContain("remote hi\n");
  });

  test("rejects private/loopback IP-literal hosts (SSRF guard)", async () => {
    await expect(
      fetchRemoteRepository({ url: "http://127.0.0.1:1/git/x/y.git" }),
    ).rejects.toThrow(/private|loopback|blocked/i);
  });
});
