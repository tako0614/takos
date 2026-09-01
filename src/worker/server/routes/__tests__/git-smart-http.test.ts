import { describe, expect, test } from "bun:test";

import type { Env } from "../../../shared/types/index.ts";
import gitSmartHttp from "../git-smart-http.ts";

const QUARANTINE_RESPONSE = {
  error:
    "Takos built-in Git compatibility is quarantined pending an explicit migration; use the installed takos-git source.git.smart_http Interface",
  code: "git_compatibility_quarantined",
};

function guardedEnv(): { env: Env; reads: string[] } {
  const reads: string[] = [];
  const env = new Proxy({} as Env, {
    get(_target, property) {
      const binding = String(property);
      reads.push(binding);
      throw new Error(
        `quarantined Git upload-pack must not access binding ${binding}`,
      );
    },
  });
  return { env, reads };
}

async function expectQuarantined(response: Response): Promise<void> {
  expect(response.status).toBe(503);
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(QUARANTINE_RESPONSE);
}

describe("git smart HTTP compatibility quarantine", () => {
  test("upload-pack advertisement is uniform before repository lookup or auth", async () => {
    const { env, reads } = guardedEnv();
    const requests = [
      "/git/alice/demo.git/info/refs?service=git-upload-pack",
      "/git/alice/private.git/info/refs?service=git-upload-pack",
      "/git/unknown/missing.git/info/refs?service=git-upload-pack",
    ];

    for (const path of requests) {
      const response = await gitSmartHttp.request(
        path,
        {
          headers: {
            authorization: `Basic ${btoa("git:untrusted-token")}`,
          },
        },
        env,
      );
      await expectQuarantined(response);
    }

    expect(reads).toEqual([]);
  });

  test("upload-pack POST is uniform without consuming its body or bindings", async () => {
    const { env, reads } = guardedEnv();

    for (const path of [
      "/git/alice/demo.git/git-upload-pack",
      "/git/alice/private.git/git-upload-pack",
      "/git/unknown/missing.git/git-upload-pack",
    ]) {
      let bodyPulls = 0;
      const request = new Request(`http://localhost${path}`, {
        method: "POST",
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            bodyPulls += 1;
            controller.enqueue(new Uint8Array([0, 0, 0, 0]));
            controller.close();
          },
        }, { highWaterMark: 0 }),
        duplex: "half",
      } as RequestInit & { duplex: "half" });

      const response = await gitSmartHttp.request(request, undefined, env);
      await expectQuarantined(response);
      expect(request.bodyUsed).toBe(false);
      expect(bodyPulls).toBe(0);
    }

    expect(reads).toEqual([]);
  });

  test("receive-pack advertisement remains explicitly disabled", async () => {
    const { env, reads } = guardedEnv();
    const response = await gitSmartHttp.request(
      "/git/alice/demo.git/info/refs?service=git-receive-pack",
      {},
      env,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error:
        "push is unavailable on the Takos compatibility endpoint; use the installed takos-git source.git.smart_http Interface",
      code: "git_push_disabled",
    });
    expect(reads).toEqual([]);
  });

  test("receive-pack POST remains explicitly disabled", async () => {
    const { env, reads } = guardedEnv();
    const response = await gitSmartHttp.request(
      "/git/alice/demo.git/git-receive-pack",
      { method: "POST", body: new Uint8Array([0]) },
      env,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error:
        "push is unavailable on the Takos compatibility endpoint; use the installed takos-git source.git.smart_http Interface",
      code: "git_push_disabled",
    });
    expect(reads).toEqual([]);
  });

  test("invalid info/refs service remains a 400", async () => {
    const { env, reads } = guardedEnv();
    const response = await gitSmartHttp.request(
      "/git/alice/demo.git/info/refs?service=git-archive",
      {},
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "info/refs requires ?service=git-upload-pack",
      code: "git_smart_http_service_required",
    });
    expect(reads).toEqual([]);
  });
});
