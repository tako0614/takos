import { describe, expect, test } from "bun:test";
import { buildForwardedRequest } from "../worker.ts";

describe("local executor forwarding authentication", () => {
  test("overwrites caller authorization with the configured bridge bearer", async () => {
    const forwarded = buildForwardedRequest(
      "http://agent-proof-runtime:8790/base/",
      new Request("https://executor/dispatch?attempt=1", {
        method: "POST",
        headers: {
          authorization: "Bearer caller-controlled",
          "content-type": "application/json",
        },
        body: JSON.stringify({ runId: "run-proof" }),
      }),
      " proof-dispatch-secret ",
    );

    expect(forwarded.url).toBe(
      "http://agent-proof-runtime:8790/base/dispatch?attempt=1",
    );
    expect(forwarded.method).toBe("POST");
    expect(forwarded.headers.get("authorization")).toBe(
      "Bearer proof-dispatch-secret",
    );
    expect(await forwarded.json()).toEqual({ runId: "run-proof" });
  });

  test("preserves the request when no bridge bearer is configured", () => {
    const forwarded = buildForwardedRequest(
      "http://executor.internal",
      new Request("https://executor/dispatch", {
        headers: { authorization: "Bearer existing" },
      }),
    );

    expect(forwarded.headers.get("authorization")).toBe("Bearer existing");
  });
});
