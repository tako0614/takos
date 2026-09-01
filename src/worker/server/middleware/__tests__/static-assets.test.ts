import { describe, expect, test } from "bun:test";

import type { Env } from "../../../shared/types/index.ts";
import { webApp } from "../../../web.ts";

describe("static assets reserved paths", () => {
  test("mounted Git quarantine cannot be shadowed by static GET or POST assets", async () => {
    let assetFetches = 0;
    const platform = {
      source: "workers",
      bindings: {},
      config: {
        adminDomain: "takos.test",
        tenantBaseDomain: "tenant.takos.test",
        environment: "development",
      },
      services: {
        assets: {
          binding: {
            async fetch() {
              assetFetches += 1;
              return new Response("shadowed", {
                status: 200,
                headers: { "content-type": "application/javascript" },
              });
            },
          },
        },
      },
    } as unknown as NonNullable<Env["PLATFORM"]>;
    const env = { ENVIRONMENT: "development", PLATFORM: platform } as Env;

    const advertisement = await webApp.request(
      "/git/alice/demo.git/info/refs?service=git-upload-pack",
      undefined,
      env,
    );
    expect(advertisement.status).toBe(503);
    expect(advertisement.headers.get("cache-control")).toBe("no-store");
    expect(await advertisement.json()).toMatchObject({
      code: "git_compatibility_quarantined",
    });

    let bodyPulls = 0;
    const uploadPackRequest = new Request(
      "http://takos.test/git/alice/demo.git/git-upload-pack",
      {
        method: "POST",
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            bodyPulls += 1;
            controller.enqueue(new Uint8Array([0, 0, 0, 0]));
            controller.close();
          },
        }, { highWaterMark: 0 }),
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );
    const uploadPack = await webApp.request(uploadPackRequest, undefined, env);
    expect(uploadPack.status).toBe(503);
    expect(uploadPack.headers.get("cache-control")).toBe("no-store");
    expect(await uploadPack.json()).toMatchObject({
      code: "git_compatibility_quarantined",
    });
    expect(uploadPackRequest.bodyUsed).toBe(false);
    expect(bodyPulls).toBe(0);
    expect(assetFetches).toBe(0);
  });
});
