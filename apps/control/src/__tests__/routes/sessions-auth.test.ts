import { authenticateServiceRequest } from "@/routes/sessions/auth";

import { assert, assertEquals, assertObjectMatch } from "jsr:@std/assert";

Deno.test("authenticateServiceRequest - accepts X-Takos-Internal requests with session headers", async () => {
  const payload = await authenticateServiceRequest({
    req: {
      header(name: string): string | undefined {
        if (name === "X-Takos-Internal") return "1";
        if (name === "X-Takos-Session-Id") return "sess_123";
        if (name === "X-Takos-Space-Id") return "space_123";
        return undefined;
      },
    },
  } as never);

  assert(payload !== null);
  assertObjectMatch(payload, {
    session_id: "sess_123",
    space_id: "space_123",
    sub: "service",
  });
});
Deno.test("authenticateServiceRequest - rejects requests without X-Takos-Internal header", async () => {
  const payload = await authenticateServiceRequest({
    req: {
      header(name: string): string | undefined {
        if (name === "Authorization") return "Bearer some-token";
        return undefined;
      },
    },
  } as never);

  assertEquals(payload, null);
});
Deno.test("authenticateServiceRequest - rejects legacy shared-secret headers", async () => {
  const payload = await authenticateServiceRequest({
    req: {
      header(name: string): string | undefined {
        if (name === "X-Service-Token") {
          return "legacy-token";
        }
        return undefined;
      },
    },
  } as never);

  assertEquals(payload, null);
});
