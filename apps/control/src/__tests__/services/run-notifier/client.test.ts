import { buildRunNotifierEmitRequest } from "@/services/run-notifier/client";
import { buildRunNotifierEmitPayload } from "@/services/run-notifier/run-notifier-payload";

import { assertEquals } from "jsr:@std/assert";

Deno.test("run-notifier-client helper - builds a POST request for /emit", async () => {
  const payload = buildRunNotifierEmitPayload(
    "run-1",
    "run.failed",
    { status: "failed" },
    10,
  );
  const request: Request = buildRunNotifierEmitRequest(payload);

  assertEquals(request.method, "POST");
  assertEquals(request.url, "https://internal.do/emit");
  assertEquals(request.headers.get("Content-Type"), "application/json");
  assertEquals(await request.json(), payload);
});
