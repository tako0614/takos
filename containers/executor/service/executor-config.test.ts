import { describe, expect, test } from "bun:test";

import {
  buildRuntimeStartPayload,
  createExecutorApp,
} from "./executor-config.ts";

const logger = {
  info() {},
  warn() {},
  error() {},
};

describe("managed executor dispatch", () => {
  test("uses the dispatch control URL when the container has no static URL", () => {
    const payload = buildRuntimeStartPayload(
      {
        runId: "run_1",
        serviceId: "service_1",
        workerId: "worker_1",
        controlRpcToken: "token_1",
        controlRpcBaseUrl: "https://app.example.test/",
      },
      {},
    );

    expect(payload.controlRpcBaseUrl).toBe("https://app.example.test/");
  });

  test("accepts a provider-managed start payload without static container env", async () => {
    let acceptedControlUrl: string | undefined;
    const app = createExecutorApp({
      logger,
      runtimeConfig: {},
      executeRunInContainer: async (payload) => {
        acceptedControlUrl = payload.controlRpcBaseUrl;
      },
    });

    const response = await app.request("http://executor/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: "run_1",
        serviceId: "service_1",
        workerId: "worker_1",
        controlRpcToken: "token_1",
        controlRpcBaseUrl: "https://app.example.test",
      }),
    });

    expect(response.status).toBe(202);
    await Promise.resolve();
    expect(acceptedControlUrl).toBe("https://app.example.test");
  });
});
