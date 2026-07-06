import { test } from "bun:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");

test("ensure-vectorize-index forwards Takosumi billing context to compat API", async () => {
  const requests: Array<{
    method: string;
    pathname: string;
    headers: Headers;
    body: unknown;
  }> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body =
        request.method === "POST" ? await request.json() : undefined;
      requests.push({
        method: request.method,
        pathname: url.pathname,
        headers: new Headers(request.headers),
        body,
      });
      if (
        request.method === "POST" &&
        url.pathname ===
          "/client/v4/accounts/ts_acc_takosumi_cloud/vectorize/v2/indexes"
      ) {
        return Response.json({
          success: true,
          errors: [],
          messages: [],
          result: body,
        });
      }
      if (
        request.method === "GET" &&
        url.pathname ===
          "/client/v4/accounts/ts_acc_takosumi_cloud/vectorize/v2/indexes/takos-test-embeddings"
      ) {
        return Response.json({
          success: true,
          errors: [],
          messages: [],
          result: {
            name: "takos-test-embeddings",
            config: {
              dimensions: 768,
              metric: "cosine",
            },
          },
        });
      }
      return Response.json(
        { success: false, errors: [{ message: "unexpected request" }] },
        { status: 404 },
      );
    },
  });

  try {
    const proc = Bun.spawn(
      [
        "bun",
        "scripts/control/ensure-vectorize-index.mjs",
        "takos-test-embeddings",
        "--dimensions",
        "768",
        "--metric",
        "cosine",
        "--account-id",
        "ts_acc_takosumi_cloud",
      ],
      {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          TAKOS_CLOUDFLARE_API_BASE_URL: `http://127.0.0.1:${server.port}/client/v4`,
          CLOUDFLARE_API_TOKEN: "test-token",
          TAKOSUMI_RELEASE_CONTEXT_JSON: JSON.stringify({
            kind: "takosumi.release-context@v1",
            workspaceId: "space_test",
            installation: {
              id: "inst_test",
            },
          }),
        },
      },
    );
    const [status, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    assert.equal(
      status,
      0,
      `${stdout}\n${stderr}`.trim(),
    );
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.method, "POST");
    assert.equal(requests[1]?.method, "GET");
    for (const request of requests) {
      assert.equal(
        request.headers.get("x-takosumi-cloud-billing-workspace-id"),
        "space_test",
      );
      assert.equal(
        request.headers.get("x-takosumi-cloud-billing-installation-id"),
        "inst_test",
      );
      assert.equal(request.headers.get("authorization"), "Bearer test-token");
    }
  } finally {
    server.stop(true);
  }
});
