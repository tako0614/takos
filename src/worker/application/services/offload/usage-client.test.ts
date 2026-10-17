import { expect, test } from "bun:test";
import type { Env } from "../../../shared/types/index.ts";
import { emitRunUsageEvent } from "./usage-client.ts";

function fixture(response: Response) {
  let captured: Request | null = null;
  const env = {
    TAKOS_OFFLOAD: {},
    RUN_NOTIFIER: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (request: Request) => {
          captured = request;
          return response;
        },
      }),
    },
  } as unknown as Env;
  return { env, request: () => captured };
}

const usage = {
  runId: "run-1", meterType: "tokens", units: 3,
  requestId: "source-usage-1",
};

test("usage client sends a caller-stable request ID and accepts a durable receipt", async () => {
  const { env, request } = fixture(Response.json({ success: true }));
  await emitRunUsageEvent(env, usage);
  expect(await request()!.json()).toMatchObject({
    runId: "run-1", meter_type: "tokens", units: 3,
    request_id: "source-usage-1",
  });
});

test("usage client surfaces HTTP and logical rejection", async () => {
  const rejected = fixture(Response.json({ success: false }, { status: 503 }));
  await expect(emitRunUsageEvent(rejected.env, usage)).rejects.toThrow("503");

  const logical = fixture(Response.json({ success: false }));
  await expect(emitRunUsageEvent(logical.env, usage)).rejects.toThrow("not accepted");
});
